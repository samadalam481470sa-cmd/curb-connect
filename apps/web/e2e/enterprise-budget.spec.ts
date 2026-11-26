import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { chooseDevIdentity } from './dev-identity';

test('opens a project budget from Costing, drills into saved lines, and reopens its approved baseline', async ({
  page,
  baseURL,
}) => {
  test.skip(process.env.E2E_ENTERPRISE_DEV !== '1', 'Requires the seeded local identity provider.');
  test.setTimeout(100_000);
  const headers = { origin: new URL(baseURL ?? 'http://localhost:3000').origin };
  await page.goto('/v1/auth/login/dev?returnTo=%2Fenterprise%2Fcosting');
  if (process.env.FIELDPRO_E2E_EVIDENCE_ACTORS === '1')
    await chooseDevIdentity(page, 'demo-roof-owner');
  await page.waitForURL('**/enterprise/costing');
  const me = await page.request.get('/v1/me');
  expect(me.status(), await me.text()).toBe(200);
  expect((await me.json()).user.email).toBe('demo-roof-owner@example.test');
  const suitePath = '/v1/enterprise/status';
  const prior = await page.request.get(suitePath);
  expect(prior.status(), await prior.text()).toBe(200);
  const wasEnabled = (await prior.json()).enabled === true;

  async function enable(enabled: boolean) {
    const response = await page.request.put(suitePath, { headers, data: { enabled } });
    expect(response.status(), await response.text()).toBe(200);
  }

  try {
    if (!wasEnabled) await enable(true);
    const projectName = 'Budget browser project ' + randomUUID();
    const created = await page.request.post('/v1/enterprise/projects', {
      headers,
      data: { name: projectName, originalContractMinor: 149_000 },
    });
    expect(created.status(), await created.text()).toBe(201);
    const projectId = (await created.json()).id as string;
    const path = '/enterprise/projects/' + projectId + '/budget';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('combobox', { name: 'Commercial project' }).selectOption(projectId);
    await expect(
      page.getByRole('heading', { name: 'Schedule of Values · preliminary progress billing' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Open project budget' }).click();
    await expect(page).toHaveURL(new RegExp(path + '$'));
    await expect(page.getByRole('heading', { name: 'Project budget', exact: true })).toBeVisible();
    await expect(page.getByText(projectName, { exact: true })).toBeVisible();
    await expect(page.getByText('This project has no budget baseline.')).toBeVisible();
    const baseline = page.getByRole('region', { name: 'Budget baseline' });
    await baseline.getByRole('button', { name: 'Create baseline' }).click();
    const initial = baseline.getByRole('form', { name: 'Create draft baseline' });
    await initial.getByLabel('Currency').fill('USD');
    await initial.getByRole('button', { name: 'Create draft baseline' }).click();
    await expect(baseline.getByText('Draft · Revision 1')).toBeVisible();

    async function code(value: string, label: string) {
      await baseline.getByRole('button', { name: 'Add project cost code' }).click();
      const form = baseline.getByRole('form', { name: 'Save cost code' });
      await form.getByLabel('Cost code', { exact: true }).fill(value);
      await form.getByLabel('Cost code label').fill(label);
      await form.getByRole('button', { name: 'Save cost code' }).click();
      await expect(form).toHaveCount(0);
      await expect(
        page
          .getByRole('combobox', { name: 'Filter cost code' })
          .getByRole('option', { name: value + ' · ' + label }),
      ).toHaveCount(1);
    }

    await code('03-30', 'Concrete');
    await code('06-10', 'Framing');

    async function addLine(category: string, description: string, amount: string) {
      await baseline.getByRole('button', { name: 'Add budget line' }).click();
      const form = baseline.getByRole('form', { name: 'Save budget line' });
      await form.getByLabel('Cost code').selectOption({ label: category });
      await form.getByLabel('Description').fill(description);
      await form.getByLabel('Amount (USD)').fill(amount);
      await form.getByLabel('Project phase').fill('Structure');
      await form.getByLabel('Funding source').fill('Base contract');
      await form.getByRole('button', { name: 'Save budget line' }).click();
      await expect(form).toHaveCount(0);
    }

    await addLine('03-30 · Concrete', 'Concrete cover', '1234.56');
    await expect(baseline.getByText('Draft · Revision 2')).toBeVisible();
    await addLine('06-10 · Framing', 'Framing materials', '200.50');
    await expect(baseline.getByText('$1,435.06', { exact: true })).toBeVisible();
    await baseline.getByRole('link', { name: 'View budget source lines' }).click();
    const source = page.getByRole('region', { name: 'Budget source lines' });
    const concrete = source.getByRole('listitem').filter({ hasText: 'Concrete cover' });
    await concrete.getByText('Source details', { exact: true }).click();
    await expect(concrete.getByText('Base contract', { exact: true })).toBeVisible();
    await expect(concrete.getByText('$1,234.56', { exact: true })).toBeVisible();
    await page
      .getByRole('combobox', { name: 'Filter cost code' })
      .selectOption({ label: '03-30 · Concrete' });
    await expect(source.getByRole('listitem')).toHaveCount(1);
    await expect(source.getByText('Framing materials', { exact: true })).toHaveCount(0);
    await expect(baseline.getByText('$1,435.06', { exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Filter cost code' }).selectOption('');

    await baseline.getByRole('button', { name: 'Review baseline approval' }).click();
    const approval = baseline.getByRole('form', { name: 'Approve baseline' });
    await approval.getByLabel('Approval reason').fill('Checked the cost-code allowances.');
    await approval.getByRole('button', { name: 'Approve baseline', exact: true }).click();
    await expect(baseline.getByText('Approved · Revision 4')).toBeVisible();
    await expect(baseline.getByRole('button', { name: 'Add budget line' })).toHaveCount(0);

    const date = page.getByLabel('As of', { exact: true });
    const today = await date.inputValue();
    const priorDate = new Date(today + 'T00:00:00.000Z');
    priorDate.setUTCDate(priorDate.getUTCDate() - 1);
    await date.fill(priorDate.toISOString().slice(0, 10));
    await expect(baseline.getByText('There is no baseline for this date.')).toBeVisible();
    await page.getByRole('button', { name: 'Show current budget' }).click();
    await expect(baseline.getByText('Approved · Revision 4')).toBeVisible();
    await expect(baseline.getByText('Checked the cost-code allowances.')).toBeVisible();
    await expect(source.getByRole('listitem')).toHaveCount(2);
  } finally {
    if (!wasEnabled) await enable(false);
  }
});
