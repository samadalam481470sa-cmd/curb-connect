import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import sharp from 'sharp';

const uploadFormName = /^Upload jobsite (?:photo|media)$/;
const savedControlName = /^Saved (?:photo|media)$/;

function launchCameraProfile(
  profile: string,
  baseURL: string | undefined,
  browserSettings: TestInfo['project']['use'],
) {
  return chromium.launchPersistentContext(profile, {
    baseURL: baseURL ?? 'http://localhost:3000',
    viewport: browserSettings.viewport,
    isMobile: browserSettings.isMobile,
    hasTouch: browserSettings.hasTouch,
    userAgent: browserSettings.userAgent,
    executablePath: process.env.E2E_CHROMIUM_PATH,
    permissions: ['camera', 'microphone'],
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });
}

async function preparePhotoProject(page: Page, baseURL: string | undefined) {
  const headers = { origin: new URL(baseURL ?? 'http://localhost:3000').origin };
  await page.goto('/v1/auth/login/dev?returnTo=%2Fenterprise%2Ffield');
  await page.waitForURL('**/enterprise/field');
  await expect(page.getByRole('heading', { name: 'Field Execution', exact: true })).toBeVisible({
    timeout: 15_000,
  });
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

async function openMediaProject(
  page: Page,
  { projectId, path }: { projectId: string; path: string },
) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('combobox', { name: 'Commercial project' }).selectOption(projectId);
  const open = page.getByRole('link', { name: 'Open jobsite media' });
  await expect(open).toHaveAttribute('href', path);
  await open.click();
  await page.waitForURL('**' + path);
  await expect(page.getByRole('heading', { name: 'Jobsite media' })).toBeVisible();
}

test('resumes a private jobsite photo from the parts already received', async ({
  page,
  baseURL,
}) => {
  test.skip(process.env.E2E_ENTERPRISE_DEV !== '1', 'Requires the seeded development company.');
  test.setTimeout(75_000);
  const { projectId, path, apiPath, restore } = await preparePhotoProject(page, baseURL);
  try {
    await openMediaProject(page, { projectId, path });
    await expect(page.getByText('This project has no uploaded photos.')).toBeVisible();

    const photo = await sharp(randomBytes(768 * 768 * 3), {
      raw: { width: 768, height: 768, channels: 3 },
    })
      .png()
      .toBuffer();
    const upload = page.getByRole('form', { name: uploadFormName });
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
    await expect(upload.getByRole('combobox', { name: savedControlName })).toContainText(
      'site-progress.png',
    );
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
  const launch = () => launchCameraProfile(profile, baseURL, testInfo.project.use);
  let context: BrowserContext | undefined;
  let fixture: Awaited<ReturnType<typeof preparePhotoProject>> | undefined;
  try {
    context = await launch();
    const page = context.pages()[0] ?? (await context.newPage());
    fixture = await preparePhotoProject(page, baseURL);
    await openMediaProject(page, fixture);
    const form = page.getByRole('form', { name: uploadFormName });
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
    const selected = form.getByRole('combobox', { name: savedControlName });
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
    const recovered = restarted.getByRole('form', { name: uploadFormName });
    await expect(recovered.getByRole('combobox', { name: savedControlName })).toHaveValue(
      captureId,
    );
    await expect(recovered.getByRole('combobox', { name: savedControlName })).toContainText(
      filename,
    );
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
    await expect(recovered.getByRole('combobox', { name: savedControlName })).toHaveCount(0);
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

test('records, discards, and recovers an attached jobsite video after restart', async ({
  baseURL,
}, testInfo) => {
  test.skip(
    process.env.E2E_ENTERPRISE_DEV !== '1' || process.env.FIELDPRO_E2E_JOBSITE_RECORDING !== '1',
    'Requires the development project and private video setup.',
  );
  test.setTimeout(100_000);
  const profile = await mkdtemp(join(tmpdir(), 'fieldpro-jobsite-record-'));
  const launch = () => launchCameraProfile(profile, baseURL, testInfo.project.use);
  let context: BrowserContext | undefined;
  let fixture: Awaited<ReturnType<typeof preparePhotoProject>> | undefined;
  try {
    context = await launch();
    const page = context.pages()[0] ?? (await context.newPage());
    fixture = await preparePhotoProject(page, baseURL);
    await openMediaProject(page, fixture);
    const form = page.getByRole('form', { name: 'Upload jobsite media' });
    const camera = form.getByRole('group', { name: 'Record jobsite video' });
    const preview = camera.getByLabel('Recorded video preview');
    await expect(camera.getByText(/Up to 60 s and 25 MiB/)).toBeVisible();

    async function record() {
      await camera.getByRole('button', { name: 'Open video camera' }).click();
      await camera.getByRole('button', { name: 'Start recording' }).click();
      await expect(camera.getByText(/Recording · [1-9] s/)).toBeVisible();
      await camera.getByRole('button', { name: 'Stop recording' }).click();
      await expect(preview).toBeVisible();
    }

    await record();
    await camera.getByRole('button', { name: 'Discard video' }).click();
    await expect(preview).toHaveCount(0);
    await expect(form.getByRole('combobox', { name: 'Saved media', exact: true })).toHaveCount(0);
    const afterDiscard = await page.request.get(fixture.apiPath);
    expect(afterDiscard.status()).toBe(200);
    expect((await afterDiscard.json()).items).toEqual([]);

    await camera.getByRole('checkbox', { name: 'Include microphone audio' }).check();
    await context.setOffline(true);
    await record();
    const captured = await preview.evaluate(async (element) => {
      const video = element as HTMLVideoElement;
      const response = await fetch(video.src);
      const bytes = await response.arrayBuffer();
      const fingerprint = await crypto.subtle.digest('SHA-256', bytes);
      return {
        bytes: bytes.byteLength,
        sha256: Array.from(new Uint8Array(fingerprint), (value) =>
          value.toString(16).padStart(2, '0'),
        ).join(''),
      };
    });
    expect(captured.bytes).toBeGreaterThan(0);
    await camera.getByRole('button', { name: 'Attach video' }).click();
    const queue = form.getByRole('combobox', { name: 'Saved media', exact: true });
    await expect(queue).toBeVisible();
    await expect(
      form.getByText('Offline. This video will stay on this device until you upload it.'),
    ).toBeVisible();
    await expect(form.getByRole('button', { name: 'Upload video' })).toBeDisabled();
    const captureId = await queue.inputValue();
    const filename = await queue.locator('option:checked').textContent();
    if (!filename) throw new Error('No queued video filename.');
    expect(await inspectStoredPhotoRecords(page, fixture.projectId, filename)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: expect.stringContaining('/' + captureId + '/file'),
          ivBytes: 12,
          containsFilename: false,
          cipherBytes: captured.bytes + 16,
        }),
      ]),
    );

    await context.close();
    context = undefined;
    context = await launch();
    const restarted = context.pages()[0] ?? (await context.newPage());
    await restarted.goto(fixture.path);
    const recovered = restarted.getByRole('form', { name: 'Upload jobsite media' });
    await expect(recovered.getByRole('combobox', { name: 'Saved media', exact: true })).toHaveValue(
      captureId,
    );
    const registration = restarted.waitForRequest(
      (request) => request.method() === 'POST' && request.url().endsWith('/upload-sessions'),
    );
    await recovered.getByRole('button', { name: 'Upload video' }).click();
    const manifest = (await registration).postDataJSON();
    expect(manifest).toMatchObject({
      localCaptureId: captureId,
      sha256: captured.sha256,
      byteSize: captured.bytes,
    });
    expect(manifest.durationMs).toBeGreaterThanOrEqual(1000);
    expect(manifest.durationMs).toBeLessThan(60000);
    await expect(restarted.getByText(filename + ' uploaded for scanning.')).toBeVisible();
    const list = await restarted.request.get(fixture.apiPath);
    expect(list.status()).toBe(200);
    expect((await list.json()).items).toMatchObject([
      {
        filename,
        sha256: captured.sha256,
        byteSize: captured.bytes,
        declaredDurationMs: manifest.durationMs,
      },
    ]);
    await expect(recovered.getByRole('combobox', { name: 'Saved media', exact: true })).toHaveCount(
      0,
    );
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

test('edits and searches a literal jobsite caption while preserving a stale draft', async ({
  page,
  baseURL,
}) => {
  test.skip(process.env.E2E_ENTERPRISE_DEV !== '1', 'Requires the seeded development company.');
  test.setTimeout(75_000);
  const fixture = await preparePhotoProject(page, baseURL);
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  try {
    await openMediaProject(page, fixture);
    const photo = await sharp({
      create: { width: 12, height: 12, channels: 3, background: '#477F98' },
    })
      .png()
      .toBuffer();
    const upload = page.getByRole('form', { name: uploadFormName });
    await upload.getByLabel('Jobsite photo').setInputFiles({
      name: 'caption-fixture.png',
      mimeType: 'image/png',
      buffer: photo,
    });
    await upload.getByRole('button', { name: 'Upload photo', exact: true }).click();
    await expect(page.getByText('caption-fixture.png uploaded for scanning.')).toBeVisible();

    const photos = page.getByRole('region', { name: 'Project photos' });
    const card = photos.getByRole('listitem').filter({ hasText: 'caption-fixture.png' });
    await card.getByRole('button', { name: 'Add caption', exact: true }).click();
    const editor = card.getByRole('form', { name: 'Jobsite media caption' });
    const literal = '<em>Check frame at the north wall.</em>';
    await editor.getByRole('textbox', { name: 'Caption', exact: true }).fill(literal);
    await editor
      .getByRole('textbox', { name: 'Tags', exact: true })
      .fill('Framing, safety, FRAMING');
    await editor.getByRole('button', { name: 'Save caption', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(card.locator('.enterprise-jobsite-caption')).toHaveText(literal);
    await expect(card.locator('em')).toHaveCount(0);
    await expect(card.getByText('Tags · framing, safety', { exact: true })).toBeVisible();

    const search = page.getByRole('search', { name: 'Search project media' });
    const searchbox = search.getByRole('searchbox', { name: 'Search captions or tags' });
    await searchbox.fill('unmatched');
    await search.getByRole('button', { name: 'Search media', exact: true }).click();
    await expect(photos.getByText('No photos match your search.')).toBeVisible();
    await searchbox.fill('SAFETY');
    await search.getByRole('button', { name: 'Search media', exact: true }).click();
    await expect(card.getByText(literal, { exact: true })).toBeVisible();
    await search.getByRole('button', { name: 'Clear media search' }).click();

    await card.getByRole('button', { name: 'Edit caption', exact: true }).click();
    const kept = 'Confirm the north frame after inspection.';
    const input = editor.getByRole('textbox', { name: 'Caption', exact: true });
    await input.fill(kept);
    const assets = await page.request.get(fixture.apiPath);
    expect(assets.status()).toBe(200);
    const assetId = (await assets.json()).items[0].id as string;
    const captionPath = fixture.apiPath + '/' + assetId + '/caption';
    const intervening = await page.request.put(captionPath, {
      headers: { origin, 'if-match': '"1"' },
      data: {
        caption: 'Reviewed the north frame.',
        tags: ['inspection'],
        clientRequestId: randomUUID(),
      },
    });
    expect(intervening.status(), await intervening.text()).toBe(200);
    await editor.getByRole('button', { name: 'Save caption', exact: true }).click();
    await expect(
      editor.getByText('Another edit saved revision 2 while this form was open.'),
    ).toBeVisible();
    await expect(editor.getByText('Reviewed the north frame.')).toBeVisible();
    await expect(input).toHaveValue(kept);
    await editor.getByRole('button', { name: 'Use revision 2 as the basis for my edit' }).click();
    const acknowledged = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' && new URL(response.url()).pathname === captionPath,
    );
    await editor.getByRole('button', { name: 'Save caption', exact: true }).click();
    const receipt = await acknowledged;
    expect(receipt.status(), await receipt.text()).toBe(200);
    await expect(editor).toHaveCount(0);
    await expect(card.locator('.enterprise-jobsite-caption')).toHaveText(kept);
    const current = await page.request.get(captionPath);
    expect(current.status()).toBe(200);
    expect(await current.json()).toMatchObject({
      revision: 3,
      caption: kept,
      tags: ['framing', 'safety'],
    });
  } finally {
    await fixture.restore(page);
  }
});
