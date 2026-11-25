import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import sharp from 'sharp';

async function preparePhotoProject(page: Page, baseURL: string | undefined) {
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
  const wasSuite = (await suite.json()).enabled === true;
  const flags = await page.request.get('/v1/flags');
  expect(flags.status()).toBe(200);
  const wasFlag = (await flags.json()).flags['enterprise.jobsite_media'] === true;

  async function changeSuite(activePage: Page, enabled: boolean) {
    const result = await activePage.request.put(suitePath, { headers, data: { enabled } });
    expect(result.status(), await result.text()).toBe(200);
  }

  async function changeFlag(activePage: Page, enabled: boolean) {
    const result = await activePage.request.put(flagPath, {
      headers,
      data: { enabled, rolloutNote: 'Private browser fixture.' },
    });
    expect(result.status(), await result.text()).toBe(200);
  }

  async function restore(activePage: Page) {
    if (!wasFlag) await changeFlag(activePage, false);
    if (!wasSuite) await changeSuite(activePage, false);
  }

  try {
    if (!wasSuite) await changeSuite(page, true);
    if (!wasFlag) await changeFlag(page, true);
    const newProject = await page.request.post('/v1/enterprise/projects', {
      headers,
      data: { name: 'Jobsite photo browser ' + randomUUID(), originalContractMinor: 0 },
    });
    expect(newProject.status(), await newProject.text()).toBe(201);
    const project = await newProject.json();
    const path = '/enterprise/projects/' + project.id + '/media';
    return { projectId: project.id as string, path, apiPath: '/v1' + path, restore };
  } catch (error) {
    await restore(page);
    throw error;
  }
}

test('resumes a private jobsite photo from the parts already received', async ({
  page,
  baseURL,
}) => {
  test.skip(process.env.E2E_ENTERPRISE_DEV !== '1', 'Requires the seeded development company.');
  test.setTimeout(75_000);
  const { projectId, path, apiPath, restore } = await preparePhotoProject(page, baseURL);
  try {
    await page.reload();
    await page.getByRole('combobox', { name: 'Commercial project' }).selectOption(projectId);
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
    await page.evaluate(() => {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        value: async () => {
          throw new DOMException('Fixture permission denial', 'NotAllowedError');
        },
      });
    });
    await upload.getByRole('button', { name: 'Open camera' }).click();
    await expect(upload.getByRole('alert')).toHaveText(
      'Camera permission was denied. Choose a photo instead.',
    );
    await upload.getByLabel('Jobsite photo').setInputFiles({
      name: 'site-progress.png',
      mimeType: 'image/png',
      buffer: photo,
    });
    await expect(upload.getByLabel('Saved photo')).toContainText('site-progress.png');
    const attempts: number[] = [];
    await page.route('**' + apiPath + '/upload-sessions/*/parts/*', async (route) => {
      const index = Number(new URL(route.request().url()).pathname.split('/').at(-1));
      attempts.push(index);
      if (attempts.length === 2) await route.abort('failed');
      else await route.continue();
    });
    await upload.getByRole('button', { name: 'Upload photo' }).click();
    await expect(
      upload.getByText('You appear to be offline or the server is unreachable.', { exact: false }),
    ).toBeVisible();
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
    await restore(page);
  }
});

async function inspectStoredPhotoRecords(page: Page, projectId: string, filename: string) {
  return page.evaluate(
    async ({ projectId, filename }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('fieldline-offline-jobsite-photos');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const store = database.transaction('drafts', 'readonly').objectStore('drafts');
        const records: {
          key: string;
          fields: string[];
          ivBytes: number;
          cipherBytes: number;
          containsFilename: boolean;
        }[] = [];
        await new Promise<void>((resolve, reject) => {
          const request = store.openCursor();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
              resolve();
              return;
            }
            const key = String(cursor.key);
            if (key.includes('/' + projectId + '/')) {
              const value = cursor.value;
              records.push({
                key,
                fields: Object.keys(value).sort(),
                ivBytes: value.iv.byteLength,
                cipherBytes: value.ciphertext.byteLength,
                containsFilename: new TextDecoder().decode(value.ciphertext).includes(filename),
              });
            }
            cursor.continue();
          };
        });
        return records;
      } finally {
        database.close();
      }
    },
    { projectId, filename },
  );
}

test('recovers an encrypted camera photo after a restart during an offline capture', async ({
  baseURL,
}, testInfo) => {
  test.skip(process.env.E2E_ENTERPRISE_DEV !== '1', 'Requires the seeded development company.');
  test.setTimeout(100_000);
  const profile = await mkdtemp(join(tmpdir(), 'fieldpro-jobsite-photo-'));
  const browserSettings = testInfo.project.use;
  const launch = () =>
    chromium.launchPersistentContext(profile, {
      baseURL: baseURL ?? 'http://localhost:3000',
      viewport: browserSettings.viewport,
      isMobile: browserSettings.isMobile,
      hasTouch: browserSettings.hasTouch,
      userAgent: browserSettings.userAgent,
      executablePath: process.env.E2E_CHROMIUM_PATH,
      permissions: ['camera'],
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    });
  let context: BrowserContext | undefined;
  let fixture: Awaited<ReturnType<typeof preparePhotoProject>> | undefined;
  try {
    context = await launch();
    const page = context.pages()[0] ?? (await context.newPage());
    fixture = await preparePhotoProject(page, baseURL);
    await page.goto(fixture.path);
    const form = page.getByRole('form', { name: 'Upload jobsite photo' });
    await expect(form.getByRole('button', { name: 'Open camera' })).toBeVisible();
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        original.call(
          this,
          (blob) => {
            if (blob) {
              void blob.arrayBuffer().then(async (bytes) => {
                const hash = await crypto.subtle.digest('SHA-256', bytes);
                document.documentElement.dataset.fixturePhotoHash = Array.from(
                  new Uint8Array(hash),
                  (value) => value.toString(16).padStart(2, '0'),
                ).join('');
                document.documentElement.dataset.fixturePhotoSize = String(bytes.byteLength);
              });
            }
            callback(blob);
          },
          type,
          quality,
        );
      };
    });
    await context.setOffline(true);
    await form.getByRole('button', { name: 'Open camera' }).click();
    await form.getByRole('button', { name: 'Capture photo', exact: true }).click();
    await expect(form.getByText(/jobsite-.*\.jpg saved on this device/)).toBeVisible();
    await expect(form.getByText(/Offline\. This photo will stay on this device/)).toBeVisible();
    await expect(form.getByRole('button', { name: 'Upload photo' })).toBeDisabled();
    const selected = form.getByLabel('Saved photo');
    const captureId = await selected.inputValue();
    const filename = await selected.locator('option:checked').textContent();
    if (!filename) throw new Error('The captured photo has no filename.');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-fixture-photo-hash', /^[a-f0-9]{64}$/);
    const sha256 = await html.getAttribute('data-fixture-photo-hash');
    const byteSize = Number(await html.getAttribute('data-fixture-photo-size'));
    expect(byteSize).toBeGreaterThan(0);
    const records = await inspectStoredPhotoRecords(page, fixture.projectId, filename);
    expect(records).toHaveLength(2);
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: expect.stringContaining('/' + captureId + '/file'),
          fields: ['ciphertext', 'iv'],
          ivBytes: 12,
          cipherBytes: byteSize + 16,
          containsFilename: false,
        }),
        expect.objectContaining({
          key: expect.stringContaining('/' + captureId + '/details'),
          fields: ['ciphertext', 'iv'],
          ivBytes: 12,
          containsFilename: false,
        }),
      ]),
    );

    await context.close();
    context = undefined;
    context = await launch();
    const restarted = context.pages()[0] ?? (await context.newPage());
    await restarted.goto(fixture.path);
    const recovered = restarted.getByRole('form', { name: 'Upload jobsite photo' });
    await expect(recovered.getByLabel('Saved photo')).toHaveValue(captureId);
    await expect(recovered.getByLabel('Saved photo')).toContainText(filename);
    const before = await restarted.request.get(fixture.apiPath);
    expect(before.status()).toBe(200);
    expect((await before.json()).items).toEqual([]);

    const registration = restarted.waitForRequest(
      (request) => request.method() === 'POST' && request.url().endsWith('/upload-sessions'),
    );
    await recovered.getByRole('button', { name: 'Upload photo' }).click();
    const manifest = (await registration).postDataJSON();
    expect(manifest).toMatchObject({ localCaptureId: captureId, sha256, byteSize });
    await expect(restarted.getByText(filename + ' uploaded for scanning.')).toBeVisible();
    const after = await restarted.request.get(fixture.apiPath);
    expect(after.status()).toBe(200);
    expect((await after.json()).items).toMatchObject([{ filename, sha256, byteSize }]);
    await expect(recovered.getByLabel('Saved photo')).toHaveCount(0);
    expect(await inspectStoredPhotoRecords(restarted, fixture.projectId, filename)).toEqual([]);
  } finally {
    try {
      if (fixture) {
        context ??= await launch();
        await context.setOffline(false);
        await fixture.restore(context.pages()[0] ?? (await context.newPage()));
      }
    } finally {
      await context?.close();
      await rm(profile, { recursive: true, force: true });
    }
  }
});

test('plays the processed jobsite video through the authorized project page', async ({
  page,
  baseURL,
}) => {
  const fixturePath = process.env.FIELDPRO_E2E_JOBSITE_VIDEO;
  test.skip(
    process.env.E2E_ENTERPRISE_DEV !== '1' || !fixturePath,
    'Requires the private video worker fixture.',
  );
  test.setTimeout(80_000);
  if (!fixturePath) throw new Error('The jobsite video fixture is missing.');
  const { path, apiPath, restore } = await preparePhotoProject(page, baseURL);
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
  try {
    const bytes = await readFile(fixturePath);
    const started = await page.request.post(apiPath + '/upload-sessions', {
      headers: { origin, 'if-match': '"0"' },
      data: {
        localCaptureId: randomUUID(),
        filename: 'playback-fixture.mp4',
        mimeType: 'video/mp4',
        byteSize: bytes.length,
        sha256: sha(bytes),
        capturedAt: new Date().toISOString(),
        durationMs: 2400,
      },
    });
    expect(started.status(), await started.text()).toBe(201);
    const session = await started.json();
    let revision = session.revision as number;
    const upload = apiPath + '/upload-sessions/' + session.id;
    for (let index = 0; index < session.totalParts; index++) {
      const part = bytes.subarray(index * session.partBytes, (index + 1) * session.partBytes);
      const put = await page.request.put(upload + '/parts/' + index, {
        headers: { origin, 'if-match': '"' + revision + '"' },
        data: { sha256: sha(part), contentBase64: part.toString('base64') },
      });
      expect(put.status(), await put.text()).toBe(200);
      revision = (await put.json()).revision;
    }
    const final = await page.request.post(upload + '/finalize', {
      headers: { origin, 'if-match': '"' + revision + '"' },
      data: { clientRequestId: randomUUID() },
    });
    expect(final.status(), await final.text()).toBe(201);
    await page.goto(path);
    const videos = page.getByRole('region', { name: 'Project videos' });
    await expect(videos.getByText('playback-fixture.mp4')).toBeVisible();
    const player = videos.getByLabel('Playback for playback-fixture.mp4');
    await expect(player).toBeVisible({ timeout: 45_000 });
    await player.evaluate(async (element) => {
      const video = element as HTMLVideoElement;
      video.muted = true;
      await video.play();
    });
    await expect
      .poll(() => player.evaluate((element) => (element as HTMLVideoElement).currentTime))
      .toBeGreaterThan(0.2);
    const duration = await player.evaluate((element) => (element as HTMLVideoElement).duration);
    expect(duration).toBeCloseTo(2.4, 1);
    const original = await page.request.get(apiPath + '/' + session.id + '/original');
    expect(original.status()).toBe(200);
    expect(sha(await original.body())).toBe(sha(bytes));
  } finally {
    await restore(page);
  }
});
