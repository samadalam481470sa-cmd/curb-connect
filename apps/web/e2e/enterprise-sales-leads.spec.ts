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
    await expect(form.getByRole('button', { name: 'Save lead' })).toBeDisabled();
    await form.getByRole('button', { name: 'Cancel lead' }).click();
    await expect(form).toHaveCount(0);
    await expect(saved).toHaveCount(1);
    await expect(list.getByText('Possible second inquiry')).toHaveCount(0);
  } finally {
    if (!enabled) await toggleSuite(false);
  }
});
