import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { chooseDevIdentity } from './dev-identity';

test('records source and consent after review and preserves a possible match on cancellation', async ({
  page,
  baseURL,
}) => {
  test.skip(process.env.E2E_ENTERPRISE_DEV !== '1', 'Requires the seeded development company.');
  test.setTimeout(75_000);
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  await page.goto('/v1/auth/login/dev?returnTo=%2Fenterprise');
  if (process.env.FIELDPRO_E2E_EVIDENCE_ACTORS === '1')
    await chooseDevIdentity(page, 'demo-roof-owner');
  await page.waitForURL('**/enterprise');
  await expect(page.getByRole('heading', { name: 'Commercial Construction Suite' })).toBeVisible();

  const status = await page.request.get('/v1/enterprise/status');
  expect(status.status(), await status.text()).toBe(200);
  const enabled = (await status.json()).enabled === true;
  async function toggleSuite(value: boolean) {
    const result = await page.request.put('/v1/enterprise/status', {
      headers: { origin },
      data: { enabled: value },
    });
    expect(result.status(), await result.text()).toBe(200);
  }

  try {
    if (!enabled) await toggleSuite(true);
    const identity = randomUUID();
    const sourceName = 'Fixture website ' + identity;
    const leadName = 'Fixture sales inquiry ' + identity;
    const email = 'fixture-' + identity + '@example.test';
    const createdCommunity = await page.request.post('/v1/land-management/communities', {
      headers: { origin },
      data: { name: 'Fixture community ' + identity },
    });
    expect(createdCommunity.status(), await createdCommunity.text()).toBe(201);
    const community = await createdCommunity.json();
    await page
      .getByRole('navigation', { name: 'Enterprise Suite modules' })
      .getByRole('link', { name: 'Sales leads', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Sales leads', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Add lead source' }).click();
    const source = page.getByRole('form', { name: 'Add lead source' });
    await source.getByLabel('Lead source name').fill(sourceName);
    await source.getByRole('button', { name: 'Save source' }).click();
    await expect(source).toHaveCount(0);

    await page.getByRole('button', { name: 'Create lead', exact: true }).click();
    const form = page.getByRole('form', { name: 'Create sales lead' });
    await form.getByLabel('Lead source').selectOption({ label: sourceName });
    await form.getByLabel('Lead name').fill(leadName);
    await form.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
    await form.getByLabel('Preferred contact method').selectOption('email');
    await form.getByLabel('Desired community').selectOption(community.id);
    await form.getByLabel('Inquiry email consent').selectOption('granted');
    await form.getByLabel('Marketing email consent').selectOption('declined');
    await form.getByLabel('Inbound form event reference').fill('fixture:' + identity);
    await form.getByRole('button', { name: 'Review lead' }).click();
    const review = form.getByRole('region', { name: 'Lead intake review' });
    await expect(review.getByText('Inquiry contact email')).toBeVisible();
    await expect(review.getByText('Marketing contact restricted')).toBeVisible();
    await form.getByRole('button', { name: 'Save lead' }).click();
    await expect(page.getByText('Lead saved for ' + leadName + '. Revision 1.')).toBeVisible();

    await page.reload();
    const list = page.getByRole('region', { name: 'Recorded leads' });
    const saved = list.getByRole('listitem').filter({ hasText: leadName });
    await expect(saved).toHaveCount(1);
    await expect(saved).toContainText(community.name);
    await expect(saved).toContainText('Marketing contact restricted');
    await page.getByRole('button', { name: 'Create lead', exact: true }).click();
    await form.getByLabel('Lead name').fill('Possible second inquiry');
    await form.getByLabel('Lead source').selectOption({ label: sourceName });
    await form.getByRole('textbox', { name: 'Email', exact: true }).fill(email.toUpperCase());
    await form.getByRole('button', { name: 'Review lead' }).click();
    await expect(review.getByRole('heading', { name: 'Possible duplicate records' })).toBeVisible();
    await expect(review.getByText(leadName, { exact: true })).toBeVisible();
    await review.getByRole('button', { name: 'Compare ' + leadName }).click();
    const comparison = form.getByRole('region', { name: 'Duplicate lead comparison' });
    await expect(comparison.getByText('Matched email.')).toBeVisible();
    await expect(comparison.getByText('marketing email · declined')).toBeVisible();
    await expect(comparison.getByRole('link', { name: 'Open existing lead' })).toBeVisible();
    await expect(form.getByRole('button', { name: 'Save lead' })).toBeDisabled();
    await form.getByRole('button', { name: 'Cancel lead' }).click();
    await expect(form).toHaveCount(0);
    await expect(saved).toHaveCount(1);
    await expect(list.getByText('Possible second inquiry')).toHaveCount(0);
    await test.step('records and restores the company warning with durable history', async () => {
      await page.getByRole('link', { name: 'Duplicate warning settings' }).click();
      const settings = page.getByRole('region', { name: 'Company duplicate warning' });
      const history = page.getByRole('region', { name: 'Duplicate warning history' });
      await settings.getByRole('button', { name: 'Review turning off' }).click();
      await settings.getByLabel('Reason').fill('Review recorded website requests.');
      await settings.getByRole('button', { name: 'Save duplicate warning' }).click();
      await expect(settings.getByRole('status')).toHaveText(/^Off · Revision /);
      await page.reload();
      await expect(settings.getByRole('status')).toHaveText(/^Off · Revision /);
      await expect(history.getByText('Review recorded website requests.').first()).toBeVisible();
      await settings.getByRole('button', { name: 'Review turning on' }).click();
      await settings.getByLabel('Reason').fill('Resume duplicate review in intake.');
      await settings.getByRole('button', { name: 'Save duplicate warning' }).click();
      await expect(settings.getByRole('status')).toHaveText(/^On · Revision /);
    });
  } finally {
    if (!enabled) await toggleSuite(false);
  }
});

test('sets territory coverage and assigns a lead to the eligible salesperson', async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(
    process.env.E2E_ENTERPRISE_DEV !== '1' || process.env.FIELDPRO_E2E_EVIDENCE_ACTORS !== '1',
    'Requires two synthetic members of the same development company.',
  );
  test.setTimeout(95_000);
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const repContext = await browser.newContext({ baseURL: origin });
  const repPage = await repContext.newPage();

  async function login(target: typeof page, identity: string) {
    await target.goto('/v1/auth/login/dev?returnTo=%2Fenterprise');
    await chooseDevIdentity(target, identity);
    await target.waitForURL('**/enterprise');
    await expect(
      target.getByRole('heading', { name: 'Commercial Construction Suite' }),
    ).toBeVisible();
  }

  async function api(
    method: string,
    path: string,
    status: number,
    data?: object,
    revision?: number,
  ) {
    const result = await page.request.fetch('/v1' + path, {
      method,
      data,
      headers: {
        origin,
        ...(revision === undefined ? {} : { 'if-match': String(revision) }),
      },
    });
    expect(result.status(), await result.text()).toBe(status);
    return result.json();
  }

  const restores: (() => Promise<void>)[] = [];
  try {
    await login(page, 'demo-roof-owner');
    const suite = await api('GET', '/enterprise/status', 200);
    if (!suite.enabled) {
      await api('PUT', '/enterprise/status', 200, { enabled: true });
      restores.push(async () => {
        await api('PUT', '/enterprise/status', 200, { enabled: false });
      });
    }
    const team = await api('GET', '/team/members?limit=100&status=active', 200);
    const member = (
      team.items as { id: string; email: string; role: string; revision: number }[]
    ).find(({ email }) => email === 'demo-roof-estimator@example.test');
    if (!member) throw new Error('The synthetic salesperson fixture is unavailable.');
    if (member.role !== 'salesperson') {
      const updated = await api(
        'PATCH',
        '/team/members/' + member.id,
        200,
        { role: 'salesperson' },
        member.revision,
      );
      restores.push(async () => {
        await api(
          'PATCH',
          '/team/members/' + member.id,
          200,
          { role: member.role },
          updated.revision,
        );
      });
    }
    await login(repPage, 'demo-roof-estimator');

    const id = randomUUID();
    const leadName = 'Assignment fixture lead ' + id;
    const community = await api('POST', '/land-management/communities', 201, {
      name: 'Assignment fixture community ' + id,
    });
    const source = await api('POST', '/enterprise/sales/leads/sources', 201, {
      name: 'Assignment fixture source ' + id,
    });
    const input = {
      name: leadName,
      sourceId: source.id,
      communityId: community.id,
      contactMethod: 'none',
      consent: {},
    };
    const preview = await api('POST', '/enterprise/sales/leads/preview', 200, input);
    const created = await api(
      'POST',
      '/enterprise/sales/leads',
      201,
      {
        ...input,
        previewFingerprint: preview.previewFingerprint,
        clientRequestId: randomUUID(),
      },
      0,
    );

    await repPage.goto('/enterprise/sales/leads');
    await expect(repPage.getByRole('heading', { name: 'Sales leads', exact: true })).toBeVisible();
    await expect(repPage.getByText(leadName, { exact: true })).toHaveCount(0);

    await page.goto('/enterprise/sales/leads');
    const record = page.getByRole('listitem').filter({ hasText: leadName });
    await record.getByRole('link', { name: 'Manage lead owner' }).click();
    const owner = page.getByRole('region', { name: 'Lead owner' });
    await expect(owner.getByText('Unassigned · Revision 1')).toBeVisible();
    await expect(owner.getByRole('button', { name: 'Assign lead' })).toBeDisabled();
    await owner.getByRole('link', { name: 'Manage sales territories and round robin' }).click();
    const territory = page.getByRole('form', { name: 'Save sales territory' });
    await territory.getByLabel('Salesperson').selectOption(member.id);
    await territory.getByLabel('Community').selectOption(community.id);
    await territory.getByLabel('Maximum assigned leads').fill('1000');
    await territory.getByLabel('Territory reason').fill('Approved synthetic community coverage.');
    await territory.getByRole('button', { name: 'Save territory' }).click();
    await expect(page.getByText(/Territory saved for /)).toBeVisible();

    await page.goto('/enterprise/sales/leads/' + created.id + '/assignments');
    const assignment = page.getByRole('form', { name: 'Assign sales lead' });
    await assignment
      .getByRole('combobox', { name: 'Salesperson', exact: true })
      .selectOption(member.id);
    await assignment
      .getByLabel('Assignment reason')
      .fill('Manager assigned the available territory salesperson.');
    await assignment.getByRole('button', { name: 'Assign lead' }).click();
    await expect(owner.getByText(/Assigned to .*\./)).toBeVisible();
    const history = page.getByRole('region', { name: 'Assignment history' });
    await expect(
      history.getByText('Manager assigned the available territory salesperson.'),
    ).toBeVisible();
    await page.reload();
    await expect(owner.getByText(/Revision 2/)).toBeVisible();

    await repPage.reload();
    const repRecord = repPage.getByRole('listitem').filter({ hasText: leadName });
    await expect(repRecord).toContainText('Revision 2');
    await expect(repRecord.getByRole('link', { name: 'Manage lead owner' })).toHaveCount(0);
  } finally {
    await repContext.close();
    for (const restore of restores.reverse()) await restore();
  }
});
