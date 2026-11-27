import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { chooseDevIdentity } from './dev-identity';

const leads = '/enterprise/sales/leads';
const policy = '/enterprise/sales/assignment-settings/follow-up-reminders';

test('logs an internal conversation and keeps the follow-up task with reminders off', async ({
  page,
  baseURL,
}) => {
  test.skip(process.env.E2E_ENTERPRISE_DEV !== '1', 'Requires the seeded development company.');
  test.setTimeout(90_000);
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
  const original = await api('GET', policy, 200);
  try {
    if (!original.enabled)
      await api(
        'PUT',
        policy,
        200,
        {
          enabled: true,
          reason: 'Enable synthetic reminder verification.',
          clientRequestId: randomUUID(),
        },
        original.revision,
      );
    const name = 'Interaction fixture ' + randomUUID();
    const source = await api('POST', leads + '/sources', 201, { name });
    const input = { name, sourceId: source.id, contactMethod: 'none', consent: {} };
    const reviewed = await api('POST', leads + '/preview', 200, input);
    const lead = await api(
      'POST',
      leads,
      201,
      {
        ...input,
        clientRequestId: randomUUID(),
        previewFingerprint: reviewed.previewFingerprint,
      },
      0,
    );

    await page.goto(leads);
    await page
      .getByRole('listitem')
      .filter({ hasText: name })
      .getByRole('link', { name: 'Lead interactions' })
      .click();
    const address = leads + '/' + lead.id + '/interactions';
    await expect(page).toHaveURL(origin + address);
    const timeline = page.getByRole('region', { name: 'Interaction timeline' });
    await expect(
      timeline.getByText('No interactions have been recorded for this lead.'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Log interaction' }).click();
    const form = page.getByRole('form', { name: 'Log sales interaction' });
    await form.getByRole('combobox', { name: 'Channel', exact: true }).selectOption('meeting');
    await form.getByLabel('Occurred at').fill('2026-06-12T10:15');
    await form
      .getByRole('combobox', { name: 'Outcome', exact: true })
      .selectOption('follow_up_requested');
    await form.getByRole('combobox', { name: 'Conversation', exact: true }).selectOption('new');
    await form.getByLabel('Conversation title').fill('Fixture buyer review');
    await form
      .getByLabel('Internal interaction notes')
      .fill('Buyer will review the selections with their agent.');
    await form.getByLabel('Follow-up due').fill('2099-08-02T10:15');
    await form.getByRole('button', { name: 'Save interaction' }).click();
    await expect(page.getByText('Interaction and follow-up saved.')).toBeVisible();
    await expect(timeline.getByText('Conversation · Fixture buyer review')).toBeVisible();
    await expect(timeline.getByText('In-app reminder requested', { exact: false })).toBeVisible();

    await page.goto('/enterprise/sales/assignment-settings');
    const setting = page.getByRole('region', { name: 'Follow-up reminder policy' });
    await setting.getByLabel('Create internal follow-up reminders').uncheck();
    await setting
      .getByLabel('Reminder policy reason')
      .fill('Use manual follow-ups for the synthetic company.');
    await setting.getByRole('button', { name: 'Save follow-up policy' }).click();
    await expect(setting.getByText('Follow-up reminders turned off.')).toBeVisible();
    await page.reload();
    await expect(setting.getByText(/Off · Revision/).first()).toBeVisible();

    await page.goto(address);
    await page.getByRole('button', { name: 'Log interaction' }).click();
    await form.getByRole('combobox', { name: 'Channel', exact: true }).selectOption('email');
    await form.getByLabel('Occurred at').fill('2026-05-10T08:05');
    await form
      .getByRole('combobox', { name: 'Conversation', exact: true })
      .selectOption({ label: 'Fixture buyer review' });
    await form.getByLabel('Internal interaction notes').fill('Earlier email about finish options.');
    await form.getByLabel('Follow-up due').fill('2099-08-02T11:15');
    await form.getByRole('button', { name: 'Save interaction' }).click();
    await expect(timeline.getByText('Earlier email about finish options.')).toBeVisible();
    await expect(timeline.getByText('Reminder off', { exact: false })).toBeVisible();
    await expect(timeline.getByRole('listitem').first()).toContainText(
      'Buyer will review the selections',
    );
    await page.reload();
    await expect(timeline.getByRole('listitem')).toHaveCount(2);
  } finally {
    const current = await api('GET', policy, 200);
    if (current.enabled !== original.enabled)
      await api(
        'PUT',
        policy,
        200,
        {
          enabled: original.enabled,
          reason: 'Restore prior synthetic reminder setting.',
          clientRequestId: randomUUID(),
        },
        current.revision,
      );
    if (!suite.enabled) await api('PUT', '/enterprise/status', 200, { enabled: false });
  }
});
