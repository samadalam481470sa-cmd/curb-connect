import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { chooseDevIdentity } from './dev-identity';

const leads = '/enterprise/sales/leads';

test('approves a priced estimate and downloads its matching customer proposal PDF', async ({
  page,
  baseURL,
}) => {
  test.skip(process.env.E2E_ENTERPRISE_DEV !== '1', 'Requires the seeded development company.');
  test.setTimeout(150_000);
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  async function post(path: string, data: object, status: number, revision?: number) {
    const response = await page.request.post('/v1' + path, {
      headers: { origin, ...(revision === undefined ? {} : { 'if-match': String(revision) }) },
      data,
    });
    expect(response.status(), await response.text()).toBe(status);
    return response.json();
  }
  async function get(path: string) {
    const response = await page.request.get('/v1' + path);
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  }
  async function toggle(enabled: boolean) {
    const response = await page.request.put('/v1/enterprise/status', {
      headers: { origin },
      data: { enabled },
    });
    expect(response.status(), await response.text()).toBe(200);
  }

  await page.goto('/v1/auth/login/dev?returnTo=%2Fenterprise');
  if (process.env.FIELDPRO_E2E_EVIDENCE_ACTORS === '1')
    await chooseDevIdentity(page, 'demo-roof-owner');
  await page.waitForURL('**/enterprise');
  await expect(page.getByRole('heading', { name: 'Commercial Construction Suite' })).toBeVisible();
  const suite = await get('/enterprise/status');
  if (!suite.enabled) await toggle(true);
  try {
    const token = randomUUID();
    const name = 'Proposal buyer ' + token;
    const email = 'proposal-' + token + '@example.test';
    const buyer = await post('/customers', { displayName: name, kind: 'person' }, 201);
    const contact = await post(
      '/customers/' + buyer.id + '/contacts',
      { displayName: name, email },
      201,
    );
    const source = await post(leads + '/sources', { name: 'Proposal source ' + token }, 201);
    const option = await post(
      '/home-sales/options',
      { category: 'structural', name: 'Entry option ' + token },
      201,
    );
    const intake = { name, email, contactMethod: 'email', consent: {}, sourceId: source.id };
    const preview = await post(leads + '/preview', intake, 200);
    const lead = await post(
      leads,
      { ...intake, previewFingerprint: preview.previewFingerprint, clientRequestId: randomUUID() },
      201,
      0,
    );
    const opportunity = '/enterprise/sales/opportunities/' + lead.id;
    await post(
      leads + '/' + lead.id + '/interactions',
      {
        channel: 'meeting',
        outcome: 'contacted',
        notes: 'Keep these staff notes private.',
        occurredAt: new Date(Date.now() - 60_000).toISOString(),
        clientRequestId: randomUUID(),
      },
      201,
      1,
    );
    async function advance(key: string, base: number) {
      const view = await get(opportunity);
      const target = view.possibleTransitions.find(
        ({ stage }: { stage: { key: string } }) => stage.key === key,
      );
      expect(target).toBeTruthy();
      await post(
        opportunity + '/stage',
        { targetStageId: target.stage.id, clientRequestId: randomUUID() },
        201,
        base,
      );
    }
    await advance('qualified', 2);
    await post(
      opportunity + '/estimate',
      {
        title: 'Fixture proposal estimate',
        currency: 'USD',
        optionIds: [option.id],
        questionnaire: { requirements: 'Provide an accessible entry.' },
        clientRequestId: randomUUID(),
      },
      201,
      3,
    );
    await advance('estimating', 4);

    await page.goto(opportunity + '/estimate/pricing');
    const form = page.getByRole('form', { name: 'Review sales estimate pricing' });
    await form.getByLabel('Base sell amount').fill('240000');
    await form.getByLabel('Tax amount').fill('100');
    await form
      .getByLabel('Included scope, one item per line')
      .fill('Install the accessible entry.');
    await form.getByLabel('Excluded scope, one item per line').fill('Exclude final landscaping.');
    await form.getByRole('button', { name: 'Add allowance' }).click();
    await form.getByLabel('Allowance description').fill('Fixtures');
    await form.getByLabel('Allowance amount').fill('3500');
    await form.getByRole('button', { name: 'Review estimate total' }).click();
    await expect(form.getByText('Selected options need approved pricing.')).toBeVisible();
    await expect(form.getByRole('button', { name: 'Approve estimate pricing' })).toBeDisabled();
    await form.getByLabel(option.name + ' price').fill('5500');
    await form.getByRole('button', { name: 'Review estimate total' }).click();
    const reviewed = form.getByRole('region', { name: 'Reviewed estimate total' });
    await expect(reviewed.getByText('$249,100.00', { exact: true })).toBeVisible();
    await form.getByLabel('Pricing approval reason').fill('Reviewed buyer scope and pricing.');
    await form.getByRole('button', { name: 'Approve estimate pricing' }).click();
    await expect(
      page.getByRole('heading', { name: 'Approved estimate · Revision 6' }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Open sales proposal' }).click();
    await page.getByRole('link', { name: 'Approve proposal templates' }).click();
    const template = page.getByRole('form', { name: 'Approve proposal template' });
    const templateName = 'Proposal terms ' + token;
    await template.getByLabel('Template name').fill(templateName);
    await template
      .getByLabel('Proposal terms, one item per line')
      .fill('Changes require approval.');
    await template.getByLabel('Payment terms, one item per line').fill('Invoice on completion.');
    await template.getByLabel('Tax treatment').fill('Tax appears separately.');
    await template.getByLabel('Approval reason').fill('Reviewed buyer wording.');
    await template.getByRole('button', { name: 'Approve proposal template' }).click();
    await expect(page.getByText('Approved ' + templateName + ' revision 1.')).toBeVisible();

    await page.goto(opportunity + '/proposal');
    const generate = page.getByRole('form', { name: 'Generate sales proposal' });
    await generate
      .getByRole('combobox', { name: 'Buyer contact', exact: true })
      .selectOption(contact.id);
    await generate
      .getByRole('combobox', { name: 'Approved proposal template', exact: true })
      .selectOption({ label: templateName + ' · Revision 1' });
    await generate.getByLabel('Valid through').fill('2099-04-01');
    await generate.getByRole('button', { name: 'Generate proposal PDF' }).click();
    const receipt = page.getByRole('region', { name: 'Approved sales proposal' });
    await expect(receipt.getByText('$249,100.00', { exact: true })).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      receipt.getByRole('link', { name: 'Download proposal PDF' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^PROP-.+\.pdf$/);
    const file = await download.path();
    if (!file) throw new Error('The generated proposal PDF was not downloaded.');
    expect((await readFile(file)).subarray(0, 4).toString()).toBe('%PDF');
    await page.reload();
    await expect(receipt.getByText('$249,100.00', { exact: true })).toBeVisible();
    await test.step('weights approved revenue and preserves the user preference after reload', async () => {
      await page.goto(opportunity);
      const probability = page.getByRole('region', { name: 'Opportunity forecast probability' });
      await probability.getByRole('button', { name: 'Record forecast probability' }).click();
      await probability.getByLabel('Probability (%)').fill('25.50');
      await probability.getByLabel('Reason').fill('Buyer confirmed financing.');
      await probability.getByRole('button', { name: 'Save probability' }).click();
      await expect(probability.getByText('25.5% · Revision 1')).toBeVisible();

      await page.goto('/enterprise/sales/pipeline?stage=estimating&sourceId=' + source.id);
      const revenue = page.getByRole('region', { name: 'Projected sales revenue' });
      const setting = revenue.getByRole('checkbox', { name: 'Show projected revenue' });
      await expect(setting).toBeChecked();
      await expect(revenue.getByText('$63,520.50', { exact: true })).toBeVisible();
      await setting.click();
      await expect(setting).not.toBeChecked();
      await expect(revenue.getByText('$63,520.50', { exact: true })).toHaveCount(0);
      await page.reload();
      await expect(setting).not.toBeChecked();
      await setting.click();
      await expect(setting).toBeChecked();
      await expect(revenue.getByText('$63,520.50', { exact: true })).toBeVisible();
    });
    await test.step('filters the pipeline by exact approved value and preserves the scoped address', async () => {
      await page.locator('summary').filter({ hasText: /^Filters/ }).click();
      const filters = page.getByRole('form', { name: 'Filter sales pipeline' });
      await filters.getByLabel('Minimum approved value').fill('249100');
      await filters.getByLabel('Maximum approved value').fill('249100');
      await filters.getByRole('button', { name: 'Apply filters' }).click();
      await expect(page).toHaveURL(/minValueMinor=24910000/);
      await expect(page.getByText('Approved value $249,100.00', { exact: true })).toBeVisible();
      const link = page.getByRole('link', { name: 'Export sales report' });
      await expect(link).toHaveAttribute('href', /maxValueMinor=24910000/);
      await page.reload();
      await expect(page.getByText('Approved value $249,100.00', { exact: true })).toBeVisible();
    });
    await test.step('saves the visible columns, filters and ordering in a named Sales view', async () => {
      await page.getByText('Columns', { exact: true }).click();
      const picker = page.getByRole('form', { name: 'Choose sales pipeline columns' });
      await picker.getByRole('checkbox', { name: 'Approved value' }).uncheck();
      await picker.getByRole('button', { name: 'Apply columns' }).click();
      await expect(page).toHaveURL(/columns=/);
      await expect(page.getByText('Approved value $249,100.00', { exact: true })).toHaveCount(0);
      await page.getByText('Saved views', { exact: true }).click();
      await page.getByRole('button', { name: 'Save current view' }).click();
      const viewForm = page.getByRole('form', { name: 'Save sales pipeline view' });
      await viewForm.getByLabel('View name').fill('Proposal review ' + token);
      await viewForm.getByLabel('Visibility').selectOption('company');
      await viewForm.getByRole('button', { name: 'Save view' }).click();
      await expect(page).toHaveURL(/view=/);
      await expect(page.getByText('Saved views · Proposal review ' + token)).toBeVisible();
      await page.reload();
      await expect(page.getByText('Saved views · Proposal review ' + token)).toBeVisible();
      await expect(page.getByText('Approved value $249,100.00', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Export sales report' })).toHaveAttribute(
        'href',
        /maxValueMinor=24910000/,
      );
      await page.goto('/enterprise/sales/pipeline?view=' + randomUUID());
      await expect(
        page.getByText('The saved view is unavailable. Showing the default pipeline.'),
      ).toBeVisible();
    });
  } finally {
    if (!suite.enabled) await toggle(false);
  }
});
