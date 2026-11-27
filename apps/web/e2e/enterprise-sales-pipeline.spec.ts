import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { chooseDevIdentity } from './dev-identity';

const leads = '/enterprise/sales/leads';
const pipeline = '/enterprise/sales/pipeline';

test('reviews a competing activity revision and advances the scoped pipeline stage', async ({
  page,
  baseURL,
}) => {
  test.skip(process.env.E2E_ENTERPRISE_DEV !== '1', 'Requires the seeded development company.');
  test.setTimeout(95_000);
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;

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
      headers: { origin, ...(revision === undefined ? {} : { 'if-match': String(revision) }) },
    });
    expect(result.status(), await result.text()).toBe(status);
    return result.json();
  }

  await page.goto('/v1/auth/login/dev?returnTo=%2Fenterprise');
  if (process.env.FIELDPRO_E2E_EVIDENCE_ACTORS === '1')
    await chooseDevIdentity(page, 'demo-roof-owner');
  await page.waitForURL('**/enterprise');
  await expect(page.getByRole('heading', { name: 'Commercial Construction Suite' })).toBeVisible();
  const suite = await api('GET', '/enterprise/status', 200);
  if (!suite.enabled) await api('PUT', '/enterprise/status', 200, { enabled: true });
  try {
    const name = 'Pipeline fixture ' + randomUUID();
    const source = await api('POST', leads + '/sources', 201, { name });
    const input = { name, sourceId: source.id, contactMethod: 'none', consent: {} };
    const reviewed = await api('POST', leads + '/preview', 200, input);
    const lead = await api(
      'POST',
      leads,
      201,
      { ...input, clientRequestId: randomUUID(), previewFingerprint: reviewed.previewFingerprint },
      0,
    );
    const address = '/enterprise/sales/opportunities/' + lead.id;

    await page.goto(leads);
    await page.getByRole('link', { name: 'Open Sales pipeline' }).click();
    const opportunities = page.getByRole('region', { name: 'Pipeline opportunities' });
    await opportunities.getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(origin + address);
    await expect(page.getByRole('heading', { name: 'New · Revision 1' })).toBeVisible();
    await page.getByRole('button', { name: 'Advance stage' }).click();
    const form = page.getByRole('form', { name: 'Advance opportunity stage' });
    const picker = form.getByRole('combobox', { name: 'Next stage', exact: true });
    await expect(picker.getByRole('option', { name: 'Attempting contact' })).toHaveJSProperty(
      'disabled',
      true,
    );
    await form.getByRole('button', { name: 'Cancel stage change' }).click();

    const activityPath = leads + '/' + lead.id + '/interactions';
    const occurredAt = new Date(Date.now() - 60_000).toISOString();
    const nextAt = new Date(Date.now() + 86400_000 * 30).toISOString();
    await api(
      'POST',
      activityPath,
      201,
      {
        channel: 'call',
        outcome: 'contacted',
        occurredAt,
        nextAt,
        notes: 'Buyer scheduled the next call.',
        clientRequestId: randomUUID(),
      },
      1,
    );
    await page.reload();
    await expect(page.getByRole('heading', { name: 'New · Revision 2' })).toBeVisible();
    await page.getByRole('button', { name: 'Advance stage' }).click();
    await picker.selectOption({ label: 'Attempting contact' });
    await form.getByLabel('Stage reason').fill('Next call is scheduled.');
    await api(
      'POST',
      activityPath,
      201,
      {
        channel: 'email',
        outcome: 'contacted',
        occurredAt,
        notes: 'Additional communication recorded by another tab.',
        clientRequestId: randomUUID(),
      },
      2,
    );
    await form.getByRole('button', { name: 'Save stage' }).click();
    await expect(form.getByText('Revision 2 was New. Revision 3 is New.')).toBeVisible();
    await expect(form.getByLabel('Stage reason')).toHaveValue('Next call is scheduled.');
    await expect(form.getByRole('button', { name: 'Save stage' })).toBeDisabled();
    await form.getByRole('button', { name: 'Use current stage revision' }).click();
    await form.getByRole('button', { name: 'Save stage' }).click();
    await expect(page.getByText('Moved to Attempting contact.')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Attempting contact · Revision 4' }),
    ).toBeVisible();

    const drawer = page.getByRole('button', { name: 'Activity and exceptions' });
    if (await drawer.isVisible()) await drawer.click();
    const history = page.getByRole('region', { name: 'Stage history' });
    await expect(history.getByText('New to Attempting contact')).toBeVisible();
    await expect(history.getByText(/Time in New \d+ seconds/)).toBeVisible();

    await page.goto(pipeline + '?stage=attempting_contact');
    const row = opportunities.getByRole('listitem').filter({ hasText: name });
    await expect(row).toContainText('Attempting contact · Revision 4');
    await expect(row.getByText('Next activity', { exact: false })).toBeVisible();
  } finally {
    if (!suite.enabled) await api('PUT', '/enterprise/status', 200, { enabled: false });
  }
});
