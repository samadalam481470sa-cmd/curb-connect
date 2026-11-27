import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { chooseDevIdentity } from './dev-identity';

const leads = '/enterprise/sales/leads';

test('opens the qualified estimate with pinned selections and the current lot status', async ({
  page,
  baseURL,
}) => {
  test.skip(process.env.E2E_ENTERPRISE_DEV !== '1', 'Requires the seeded development company.');
  test.setTimeout(110_000);
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
    const fixture = randomUUID();
    const name = 'Estimate buyer ' + fixture;
    const plan = await api('POST', '/studio-houses', 201, {
      name: 'Fixture ranch ' + fixture,
      source: 'ai',
      brief: 'Approved fixture ranch',
      spec: {
        lengthFt: 52,
        widthFt: 34,
        stories: 1,
        bedrooms: 3,
        bathrooms: 2,
        garage: 'two_car',
        wallHeightFt: 9,
        roofPitch: 6,
      },
      settings: {},
    });
    const community = await api('POST', '/land-management/communities', 201, {
      name: 'Estimate community ' + fixture,
    });
    const lot = await api('POST', '/land-management/communities/' + community.id + '/lots', 201, {
      lotNumber: 'E-17',
      priceMinor: 4_500_000,
    });
    const option = await api('POST', '/home-sales/options', 201, {
      name: 'Fixture quartz ' + fixture,
      category: 'finish',
      priceMinor: 125_000,
    });
    const template = await api('POST', '/estimate-templates', 201, {
      name: 'Fixture template ' + fixture,
      budgetLines: [{ costCode: '06', label: 'Framing allowance', budgetMinor: 400_000 }],
    });
    const source = await api('POST', leads + '/sources', 201, { name });
    const input = {
      name,
      sourceId: source.id,
      communityId: community.id,
      contactMethod: 'email',
      consent: {},
    };
    const preview = await api('POST', leads + '/preview', 200, input);
    const lead = await api(
      'POST',
      leads,
      201,
      { ...input, clientRequestId: randomUUID(), previewFingerprint: preview.previewFingerprint },
      0,
    );
    const opportunity = '/enterprise/sales/opportunities/' + lead.id;
    await api(
      'POST',
      leads + '/' + lead.id + '/interactions',
      201,
      {
        channel: 'meeting',
        outcome: 'contacted',
        notes: 'Buyer confirmed the draft scope.',
        occurredAt: new Date(Date.now() - 60_000).toISOString(),
        clientRequestId: randomUUID(),
      },
      1,
    );
    const stage = await api('GET', opportunity, 200);
    const qualified = stage.possibleTransitions.find(
      ({ stage }: { stage: { key: string } }) => stage.key === 'qualified',
    );
    expect(qualified).toBeTruthy();
    await api(
      'POST',
      opportunity + '/stage',
      201,
      { targetStageId: qualified.stage.id, clientRequestId: randomUUID() },
      2,
    );

    await page.goto(opportunity);
    await page.getByRole('link', { name: 'Create sales estimate' }).click();
    await page.getByRole('link', { name: 'Review estimate templates' }).click();
    const approval = page.getByRole('form', { name: 'Approve sales template revision' });
    await approval
      .getByRole('combobox', { name: 'Source template', exact: true })
      .selectOption(template.id);
    await approval.getByLabel('Default labor assumptions').fill('Use a two-person framing crew.');
    await approval.getByLabel('Approval reason').fill('Approve synthetic estimate assumptions.');
    await approval.getByRole('button', { name: 'Approve template revision' }).click();
    await expect(page.getByText('Approved ' + template.name + ' revision 1.')).toBeVisible();

    await page.goto(opportunity + '/estimate');
    const form = page.getByRole('form', { name: 'Create sales estimate' });
    await form.getByLabel('Estimate title').fill('Fixture preconstruction draft');
    await form.getByRole('combobox', { name: 'House plan', exact: true }).selectOption(plan.id);
    await form.getByRole('combobox', { name: 'Desired lot', exact: true }).selectOption(lot.id);
    await expect(form.getByText(/Lot hold applies/)).toBeVisible();
    await form
      .getByRole('combobox', { name: 'Approved estimate template', exact: true })
      .selectOption({ label: template.name + ' · Revision 1' });
    await form.getByRole('checkbox', { name: new RegExp(option.name) }).check();
    await form
      .getByLabel('Buyer scope requirements')
      .fill('Accessible entry and quartz countertops.');
    await form.getByLabel('Target budget').fill('360000');
    await form.getByRole('button', { name: 'Create estimate draft' }).click();

    const draft = page.getByRole('region', { name: 'Saved sales estimate draft' });
    await expect(draft.getByText(name + ' · Revision 3')).toBeVisible();
    await expect(draft.getByText('E-17 · Current status held')).toBeVisible();
    await expect(draft.getByText('Use a two-person framing crew.')).toBeVisible();
    await expect(draft.getByText('$1,250.00', { exact: true }).first()).toBeVisible();
    expect((await api('GET', '/land-management/lots/' + lot.id, 200)).lot.status).toBe('held');
    await api('PATCH', '/land-management/lots/' + lot.id, 200, { status: 'available' });
    await api('PATCH', '/home-sales/options/' + option.id, 200, { priceMinor: 350_000 });
    await page.reload();
    await expect(draft.getByText('E-17 · Current status available')).toBeVisible();
    await expect(draft.getByText('$1,250.00', { exact: true }).first()).toBeVisible();
  } finally {
    if (!suite.enabled) await api('PUT', '/enterprise/status', 200, { enabled: false });
  }
});
