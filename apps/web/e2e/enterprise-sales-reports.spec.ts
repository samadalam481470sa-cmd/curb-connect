import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { chooseDevIdentity } from './dev-identity';

const leads = '/enterprise/sales/leads';
const pipeline = '/enterprise/sales/pipeline';

test('exports the selected Sales pipeline and downloads only the consented contacts', async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.E2E_ENTERPRISE_DEV !== '1' ||
      process.env.E2E_ENTERPRISE_SALES_REPORT_WORKER !== '1',
    'Requires seeded development data and the Sales report worker.',
  );
  test.setTimeout(90_000);
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  async function api(
    method: string,
    route: string,
    status: number,
    data?: object,
    revision?: number,
  ) {
    const response = await page.request.fetch('/v1' + route, {
      method,
      data,
      headers: { origin, ...(revision === undefined ? {} : { 'if-match': String(revision) }) },
    });
    expect(response.status(), await response.text()).toBe(status);
    return response.json();
  }

  await page.goto('/v1/auth/login/dev?returnTo=%2Fenterprise');
  if (process.env.FIELDPRO_E2E_EVIDENCE_ACTORS === '1')
    await chooseDevIdentity(page, 'demo-roof-owner');
  await page.waitForURL('**/enterprise');
  const suite = await api('GET', '/enterprise/status', 200);
  if (!suite.enabled) await api('PUT', '/enterprise/status', 200, { enabled: true });

  const label = 'Report evidence ' + randomUUID().slice(0, 8);
  const source = await api('POST', leads + '/sources', 201, { name: label });
  const good = randomUUID() + '@consent.example';
  const excluded = randomUUID() + '@declined.example';
  for (const [suffix, email, consent] of [
    ['consented', good, 'granted'],
    ['declined', excluded, 'declined'],
  ]) {
    const input = {
      name: label + ' ' + suffix,
      email,
      sourceId: source.id,
      contactMethod: 'email',
      consent: { inquiry: { email: 'granted' }, marketing: { email: consent } },
    };
    const preview = await api('POST', leads + '/preview', 200, input);
    await api(
      'POST',
      leads,
      201,
      { ...input, clientRequestId: randomUUID(), previewFingerprint: preview.previewFingerprint },
      0,
    );
  }
  await page.goto(pipeline + '?stage=new');
  await page.getByRole('searchbox', { name: 'Search lead names' }).fill(label);
  await page.getByRole('button', { name: 'Search pipeline' }).click();
  await expect(page.getByRole('link', { name: 'New (2)', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Export sales report' }).click();

  const form = page.getByRole('region', { name: 'Review sales export' });
  await form.getByRole('checkbox', { name: 'Email', exact: true }).check();
  await form.getByRole('combobox', { name: 'Contact consent to use' }).selectOption('marketing');
  await form.getByRole('button', { name: 'Review export' }).click();
  await expect(
    form.getByText('2 rows match the selected pipeline.', { exact: true }),
  ).toBeVisible();
  await form.getByRole('button', { name: 'Queue export' }).click();
  await expect(
    form.getByText('Export queued. Check export history for the download.'),
  ).toBeVisible();

  const history = page.getByRole('region', { name: 'Prior sales exports' });
  const report = history.getByRole('listitem').filter({ hasText: 'CSV · 2 rows' }).first();
  const link = report.getByRole('link', { name: 'Download CSV' });
  await expect(link).toBeVisible({ timeout: 30_000 });
  const download = page.waitForEvent('download');
  await link.click();
  const saved = await download;
  const file = await saved.path();
  expect(file).toBeTruthy();
  const text = await readFile(file!, 'utf8');
  expect(text.trimEnd().split('\r\n')).toHaveLength(3);
  expect(text).toContain(label + ' consented');
  expect(text).toContain(label + ' declined');
  expect(text).toContain(good);
  expect(text).not.toContain(excluded);
  await page.reload();
  await expect(link).toBeVisible();
});
