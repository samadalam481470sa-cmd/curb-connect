import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';

test('resumes a private jobsite photo from the parts already received', async ({
  page,
  baseURL,
}) => {
  test.skip(process.env.E2E_ENTERPRISE_DEV !== '1', 'Requires the seeded development company.');
  test.setTimeout(75_000);
  const headers = { origin: new URL(baseURL ?? 'http://localhost:3000').origin };
  await page.goto('/v1/auth/login/dev?returnTo=%2Fenterprise%2Ffield');
  await page.waitForURL('**/enterprise/field');
  const ready = await page.request.get('/v1/me');
  expect(ready.status(), await ready.text()).toBe(200);
  expect((await ready.json()).user.email).toBe('demo-roof-owner@example.test');
  const suitePath = '/v1/enterprise/status';
  const flagPath = '/v1/flags/enterprise.jobsite_media';
  const suite = await page.request.get(suitePath);
  expect(suite.status()).toBe(200);
  const wasSuite = (await suite.json()).enabled;
  const flags = await page.request.get('/v1/flags');
  expect(flags.status()).toBe(200);
  const wasFlag = (await flags.json()).flags['enterprise.jobsite_media'];

  async function changeSuite(enabled: boolean) {
    const result = await page.request.put(suitePath, { headers, data: { enabled } });
    expect(result.status(), await result.text()).toBe(200);
  }

  async function changeFlag(enabled: boolean) {
    const result = await page.request.put(flagPath, {
      headers,
      data: { enabled, rolloutNote: 'Private browser fixture.' },
    });
    expect(result.status(), await result.text()).toBe(200);
  }

  try {
    if (!wasSuite) await changeSuite(true);
    if (!wasFlag) await changeFlag(true);
    const newProject = await page.request.post('/v1/enterprise/projects', {
      headers,
      data: { name: 'Jobsite photo browser ' + randomUUID(), originalContractMinor: 0 },
    });
    expect(newProject.status(), await newProject.text()).toBe(201);
    const project = await newProject.json();
    const path = '/enterprise/projects/' + project.id + '/media';
    const apiPath = '/v1' + path;
    await page.reload();
    await page.getByRole('combobox', { name: 'Commercial project' }).selectOption(project.id);
    const open = page.getByRole('link', { name: 'Open jobsite media' });
    await expect(open).toHaveAttribute('href', path);
    await open.click();
    await page.waitForURL('**' + path);
    await expect(page.getByRole('heading', { name: 'Jobsite media' })).toBeVisible();
    await expect(page.getByText('This project has no uploaded photos.')).toBeVisible();

    const photo = await sharp(randomBytes(768 * 768 * 3), {
      raw: { width: 768, height: 768, channels: 3 },
    })
      .png()
      .toBuffer();
    const upload = page.getByRole('form', { name: 'Upload jobsite photo' });
    await upload.getByLabel('Jobsite photo').setInputFiles({
      name: 'site-progress.png',
      mimeType: 'image/png',
      buffer: photo,
    });
    const attempts: number[] = [];
    await page.route('**' + apiPath + '/upload-sessions/*/parts/*', async (route) => {
      const index = Number(new URL(route.request().url()).pathname.split('/').at(-1));
      attempts.push(index);
      if (attempts.length === 2) await route.abort('failed');
      else await route.continue();
    });
    await upload.getByRole('button', { name: 'Upload photo' }).click();
    await expect(upload.getByRole('alert')).toContainText('offline or the server is unreachable');
    await expect(upload.getByText('1 of 2 parts uploaded')).toBeVisible();
    const interrupted = await page.request.get(apiPath);
    expect((await interrupted.json()).items).toEqual([]);

    await upload.getByRole('button', { name: 'Retry upload' }).click();
    await expect(page.getByText('site-progress.png uploaded for scanning.')).toBeVisible();
    expect(attempts).toEqual([0, 1, 1]);
    const saved = await page.request.get(apiPath);
    expect(saved.status()).toBe(200);
    const { items } = await saved.json();
    expect(items).toMatchObject([{ filename: 'site-progress.png', scanState: 'pending' }]);
    const refused = await page.request.get(apiPath + '/' + items[0].id + '/original');
    expect(refused.status()).toBe(409);

    await page.reload();
    const library = page.getByRole('region', { name: 'Project photos' });
    await expect(library.getByText('site-progress.png')).toBeVisible();
    await expect(library.getByText('Awaiting scan')).toBeVisible();
    await expect(library.getByRole('link', { name: 'Download original' })).toHaveCount(0);
  } finally {
    if (!wasFlag) await changeFlag(false);
    if (!wasSuite) await changeSuite(false);
  }
});
