import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { pdfFromPages } from '../../api/test/fixtures/plan-pdf';

test('creates a blank commercial estimate and preserves approved quantities on the project route', async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.E2E_ENTERPRISE_DEV !== '1',
    'Requires the seeded local development identity provider.',
  );
  test.setTimeout(60_000);
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const headers = { origin };
  await page.goto('/v1/auth/login/dev?returnTo=%2Fenterprise%2Festimating');
  await page.waitForURL('**/enterprise/estimating');
  const status = await page.request.get('/v1/enterprise/status');
  expect(status.status()).toBe(200);
  const wasEnabled = (await status.json()).enabled === true;
  if (!wasEnabled) {
    const enabled = await page.request.put('/v1/enterprise/status', {
      headers,
      data: { enabled: true },
    });
    expect(enabled.status()).toBe(200);
  }
  try {
    const projectResponse = await page.request.post('/v1/enterprise/projects', {
      headers,
      data: { name: 'Estimate browser fixture ' + randomUUID(), originalContractMinor: 250_000 },
    });
    expect(projectResponse.status(), await projectResponse.text()).toBe(201);
    const project = await projectResponse.json();
    await page.reload();
    await page.getByRole('combobox', { name: /^Commercial project/ }).selectOption(project.id);
    await page.getByRole('link', { name: 'Open project estimate workspace' }).click();
    await expect(page).toHaveURL(new RegExp('/enterprise/projects/' + project.id + '/estimate$'));
    const workspace = page.getByRole('region', { name: 'Commercial estimates' });
    await expect(workspace.getByText('No estimates for this project yet.')).toBeVisible();
    await workspace.getByLabel('Estimate title').fill('Canopy quantity schedule');
    await workspace.getByLabel('Currency code').fill('CAD');
    await workspace.getByLabel('Quantity decimal places').fill('4');
    await workspace.getByRole('button', { name: 'Create blank draft' }).click();

    const detail = workspace.getByRole('region', { name: 'Estimate detail' });
    await expect(detail.getByRole('heading', { name: 'Canopy quantity schedule' })).toBeVisible();
    await expect(
      detail.getByText('Draft · Revision 1 · CAD · 4 quantity decimal places'),
    ).toBeVisible();
    await detail.getByLabel('Line description').fill('Canopy decking');
    await detail.getByLabel('Measurement unit').selectOption('sq_yd');
    await detail.getByLabel('Manual quantity (optional)').fill('12.5000');
    await detail.getByRole('button', { name: 'Add estimate line' }).click();
    await expect(detail.getByRole('row', { name: /Canopy decking.*12\.5.*sq yd/ })).toBeVisible();

    await detail
      .getByLabel('Quantity approval reason')
      .fill('Checked the recorded canopy quantity.');
    await detail.getByRole('button', { name: 'Approve quantity revision' }).click();
    await expect(detail.getByText(/Approved quantity revision · Revision 1/)).toBeVisible();
    await expect(detail.getByRole('button', { name: 'Add estimate line' })).toHaveCount(0);
    await page.reload();
    await expect(
      detail.getByText('Approval reason · Checked the recorded canopy quantity.'),
    ).toBeVisible();
    await expect(detail.getByRole('row', { name: /Canopy decking.*12\.5.*sq yd/ })).toBeVisible();
  } finally {
    if (!wasEnabled)
      await page.request.put('/v1/enterprise/status', { headers, data: { enabled: false } });
  }
});

test('imports a current approved takeoff from the estimate and applies each mapping once', async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.E2E_ENTERPRISE_DEV !== '1',
    'Requires the seeded local development identity provider.',
  );
  test.setTimeout(60_000);
  const headers = { origin: new URL(baseURL ?? 'http://localhost:3000').origin };
  await page.goto('/v1/auth/login/dev?returnTo=%2Fenterprise%2Festimating');
  await page.waitForURL('**/enterprise/estimating');
  const status = await page.request.get('/v1/enterprise/status');
  expect(status.status()).toBe(200);
  const wasEnabled = (await status.json()).enabled === true;
  if (!wasEnabled) {
    const activated = await page.request.put('/v1/enterprise/status', {
      headers,
      data: { enabled: true },
    });
    expect(activated.status()).toBe(200);
  }
  async function create(path: string, data: object, revision?: number) {
    const response = await page.request.post(path, {
      headers: revision === undefined ? headers : { ...headers, 'if-match': '"' + revision + '"' },
      data,
    });
    expect(response.status(), await response.text()).toBe(201);
    return response.json();
  }
  try {
    const project = await create('/v1/enterprise/projects', {
      name: 'Approved import browser fixture ' + randomUUID(),
      originalContractMinor: 100000,
    });
    const root = '/v1/enterprise/projects/' + project.id;
    const drawing = await create(root + '/documents', {
      title: 'Canopy measurement drawing',
      filename: 'canopy-reviewed.pdf',
      category: 'plans',
      contentBase64: Buffer.from(pdfFromPages([{ width: 600, height: 600 }])).toString('base64'),
      clientRequestId: randomUUID(),
    });
    const takeoff = await create(root + '/takeoff/plan-sets', {
      title: 'Canopy transfer drawings',
      revisionLabel: 'B',
      versionIds: [drawing.id],
      clientRequestId: randomUUID(),
    });
    const planPath = root + '/takeoff/plan-sets/' + takeoff.id;
    const plan = await page.request.get(planPath);
    expect(plan.status()).toBe(200);
    const sheet = planPath + '/sheets/' + (await plan.json()).sheets[0].id;
    async function approveArea(scaleRevision: number, height: number) {
      const calibration = await create(
        sheet + '/calibration',
        {
          pointA: { x: 0, y: 0 },
          pointB: { x: 100, y: 0 },
          knownLength: 10,
          unit: 'ft',
          verification: { pointA: { x: 0, y: 10 }, pointB: { x: 250, y: 10 }, knownLength: 25 },
          clientRequestId: randomUUID(),
        },
        scaleRevision,
      );
      const area = await create(sheet + '/areas', {
        calibrationId: calibration.id,
        holes: [],
        exterior: [
          { x: 10, y: 20 },
          { x: 110, y: 20 },
          { x: 110, y: 20 + height },
          { x: 10, y: 20 + height },
        ],
        clientRequestId: randomUUID(),
      });
      const reviews = sheet + '/measurements/area/' + area.id + '/reviews';
      const review = await create(
        reviews,
        {
          note: 'Compare the exterior against the current drawing.',
          clientRequestId: randomUUID(),
        },
        1,
      );
      const approval = await page.request.post(reviews + '/' + review.id + '/decide', {
        headers: { ...headers, 'if-match': '"1"' },
        data: { decision: 'approved', note: 'Confirmed the area and check measurement.' },
      });
      expect(approval.status(), await approval.text()).toBe(200);
      return review;
    }
    const stale = await approveArea(0, 80);
    const active = await approveArea(1, 120);
    const draft = await create(root + '/estimates', {
      title: 'Canopy material takeoff',
      currency: 'USD',
      quantityPrecision: 4,
      clientRequestId: randomUUID(),
    });
    const estimate = root + '/estimates/' + draft.id;
    await create(
      estimate + '/lines',
      {
        description: 'Canopy covering',
        unit: 'sq_yd',
        quantity: null,
        clientRequestId: randomUUID(),
      },
      1,
    );

    await page.goto('/enterprise/projects/' + project.id + '/estimate');
    const detail = page.getByRole('region', { name: 'Estimate detail' });
    await detail.getByText('Import takeoff quantities', { exact: true }).click();
    const importPanel = detail.getByRole('region', { name: 'Import reviewed takeoff quantities' });
    const dropdown = importPanel.getByLabel('Approved takeoff measurement');
    await expect(dropdown.getByRole('option', { name: /120 sq ft/ })).toHaveCount(1);
    await expect(dropdown.locator('option[value="' + stale.id + '"]')).toHaveCount(0);
    await dropdown.selectOption(active.id);
    const transfer = importPanel.getByRole('region', { name: 'Transfer takeoff quantity' });
    await transfer.getByRole('checkbox', { name: /Canopy covering/ }).check();
    await transfer.getByRole('button', { name: 'Preview quantity transfer' }).click();
    await expect(transfer.getByText(/Before rounding · 13\.3333333333/)).toBeVisible();
    await expect(transfer.getByText('Quantity to save · 13.3333 sq yd')).toBeVisible();
    await transfer.getByRole('button', { name: 'Confirm quantity transfer' }).click();
    await expect(
      detail.getByRole('row', { name: /Canopy covering.*13\.3333.*Reviewed takeoff/ }),
    ).toBeVisible();

    await transfer.getByRole('checkbox', { name: /Canopy covering/ }).check();
    await transfer.getByRole('button', { name: 'Preview quantity transfer' }).click();
    await expect(transfer.getByText('This reviewed quantity is already linked.')).toBeVisible();
    await transfer.getByRole('button', { name: 'Confirm quantity transfer' }).click();
    await expect(transfer.getByText('This reviewed quantity was already linked.')).toBeVisible();
    const saved = await page.request.get(estimate);
    expect(saved.status()).toBe(200);
    expect(await saved.json()).toMatchObject({
      revision: 3,
      lines: [{ quantity: '13.3333', sourceReviewId: active.id }],
    });
  } finally {
    if (!wasEnabled)
      await page.request.put('/v1/enterprise/status', { headers, data: { enabled: false } });
  }
});
