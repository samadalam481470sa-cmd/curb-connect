import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { chooseDevIdentity } from './dev-identity';

test('publishes the approved homeowner contract total and revokes the guest link', async ({
  page,
  browser,
  baseURL,
}) => {
  test.skip(process.env.E2E_ENTERPRISE_DEV !== '1', 'Requires the seeded development company.');
  test.setTimeout(75_000);
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const headers = { origin };
  await page.goto('/v1/auth/login/dev?returnTo=%2Fenterprise');
  if (process.env.FIELDPRO_E2E_EVIDENCE_ACTORS === '1')
    await chooseDevIdentity(page, 'demo-roof-owner');
  await page.waitForURL('**/enterprise');
  await expect(page.getByRole('heading', { name: 'Commercial Construction Suite' })).toBeVisible();

  async function create(path: string, data: object, status = 201) {
    const result = await page.request.post('/v1' + path, { headers, data });
    expect(result.status(), await result.text()).toBe(status);
    return result.json();
  }

  const mediaFlag = '/v1/flags/enterprise.jobsite_media';
  const suitePath = '/v1/enterprise/status';
  const flags = await page.request.get('/v1/flags');
  const suite = await page.request.get(suitePath);
  expect(flags.status(), await flags.text()).toBe(200);
  expect(suite.status(), await suite.text()).toBe(200);
  const wasMediaEnabled = (await flags.json()).flags['enterprise.jobsite_media'] === true;
  const wasSuiteEnabled = (await suite.json()).enabled === true;
  async function enable(path: string, enabled: boolean) {
    const result = await page.request.put(path, {
      headers,
      data:
        path === mediaFlag ? { enabled, rolloutNote: 'Synthetic browser fixture.' } : { enabled },
    });
    expect(result.status(), await result.text()).toBe(200);
  }

  const guest = await browser.newContext({ baseURL: origin, locale: 'en-US' });
  try {
    if (!wasSuiteEnabled) await enable(suitePath, true);
    if (!wasMediaEnabled) await enable(mediaFlag, true);
    const project = await create('/enterprise/projects', {
      name: 'Homeowner visibility ' + randomUUID(),
      originalContractMinor: 2_000_000,
    });
    const customer = await create('/customers', { kind: 'person', displayName: 'Fixture buyer' });
    const contact = await create('/customers/' + customer.id + '/contacts', {
      displayName: 'Fixture homeowner',
      isPrimary: true,
    });
    const projectPath = '/enterprise/projects/' + project.id;
    const assignment = await page.request.put(
      '/v1' + projectPath + '/media/homeowner-shares/recipients/' + contact.id,
      {
        headers: { ...headers, 'if-match': '"0"' },
        data: {
          active: true,
          reason: 'Synthetic project assignment',
          clientRequestId: randomUUID(),
        },
      },
    );
    expect(assignment.status(), await assignment.text()).toBe(200);
    const proposal = await create('/proposals', {
      customerId: customer.id,
      contactId: contact.id,
      title: 'Fixture signed agreement',
      options: [
        {
          key: 'base',
          kind: 'package',
          label: 'Base construction scope',
          amountMinor: 2_000_000,
          isDefault: true,
        },
      ],
    });
    await create(
      '/proposals/' + proposal.id + '/accept',
      {
        versionId: proposal.currentVersion.id,
        packageOptionId: proposal.currentVersion.options[0].id,
        createJob: false,
      },
      200,
    );

    await page.goto(projectPath + '/financials');
    await page.getByRole('link', { name: 'Homeowner finance visibility' }).click();
    await expect(page.getByRole('heading', { name: 'Homeowner finance visibility' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Current finance visibility' })).toContainText(
      'Off · Project default',
    );
    const form = page.getByRole('form', { name: 'Publish homeowner finance visibility' });
    await form.getByLabel('Accepted project proposal').selectOption(proposal.currentVersion.id);
    await expect(form.getByLabel('Include approved internal posted cost')).not.toBeChecked();
    await expect(form.getByLabel('Include approved forecast margin')).not.toBeChecked();
    await form.getByRole('button', { name: 'Preview allowed figures' }).click();
    const preview = form.getByRole('region', { name: 'Homeowner finance preview' });
    await expect(preview).toContainText('$20,000.00');
    await form.getByLabel('Reason').fill('Signed agreement authorizes the accepted total.');
    const publish = form.getByRole('button', { name: 'Publish homeowner finance link' });
    await expect(publish).toBeDisabled();
    await form.getByLabel('The accepted contract permits sharing these selected figures').check();
    await publish.click();
    await expect(page.getByText('Finance link published.')).toBeVisible();
    const share = page.getByRole('link', { name: 'Open current homeowner link' });
    await expect(share).toHaveAttribute('href', /\/portal\/homeowner\/projects\/.+\/financials#t=/);
    const url = new URL((await share.getAttribute('href'))!);
    const publicPage = await guest.newPage();
    await publicPage.goto(url.pathname + url.hash);
    await expect(
      publicPage.getByRole('heading', { name: 'Shared project financials' }),
    ).toBeVisible();
    await expect(publicPage.getByText('Accepted contract total')).toBeVisible();
    await expect(publicPage.getByText('$20,000.00', { exact: true })).toBeVisible();
    await expect(publicPage.getByText('Approved posted project cost')).toHaveCount(0);
    await expect(publicPage.getByText('Approved forecast margin')).toHaveCount(0);

    await page.getByRole('button', { name: 'Turn off homeowner finance visibility' }).click();
    const closing = page.getByRole('form', { name: 'Turn off finance visibility' });
    await closing.getByLabel('Reason').fill('Synthetic project verification complete.');
    await closing.getByRole('button', { name: 'Save visibility off' }).click();
    await expect(page.getByText('Homeowner finance visibility turned off.')).toBeVisible();
    await publicPage.reload();
    await expect(publicPage.locator('main.js-public').getByRole('alert')).toContainText(
      'This project finance link is unavailable.',
    );
    await expect(publicPage.getByText('$20,000.00', { exact: true })).toHaveCount(0);
  } finally {
    await guest.close();
    if (!wasMediaEnabled) await enable(mediaFlag, false);
    if (!wasSuiteEnabled) await enable(suitePath, false);
  }
});
