import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

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
