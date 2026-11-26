import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chromium,
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import sharp from 'sharp';

const uploadFormName = /^Upload jobsite (?:photo|media)$/;
const savedControlName = /^Saved (?:photo|media)$/;

async function chooseEvidenceIdentity(page: Page, subject: string) {
  const chooser = page.locator('form.pick');
  await expect(chooser.locator('button[name="sub"][value="' + subject + '"]')).toBeVisible();
  const action = await chooser.getAttribute('action');
  if (!action) throw new Error('The development identity form has no action.');
  const response = await page.request.post(new URL(action, page.url()).href, {
    form: { sub: subject },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(303);
  const resume = response.headers().location;
  if (!resume) throw new Error('The development identity provider did not resume authorization.');
  // Navigate explicitly because this dev form's CSP restricts cross-origin form redirects.
  await page.goto(new URL(resume, page.url()).href);
}

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
  if (process.env.FIELDPRO_E2E_EVIDENCE_ACTORS === '1')
    await chooseEvidenceIdentity(page, 'demo-roof-owner');
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

test('links one uploaded photo to both project schedule tasks', async ({ page, baseURL }) => {
  test.skip(process.env.E2E_ENTERPRISE_DEV !== '1', 'Requires the seeded development company.');
  test.setTimeout(75_000);
  const fixture = await preparePhotoProject(page, baseURL);
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  try {
    const schedule = fixture.apiPath.replace(/\/media$/, '/schedule/tasks');
    async function addTask(title: string) {
      const result = await page.request.post(schedule, {
        headers: { origin },
        data: {
          title,
          phase: 'Quality',
          startsOn: '2026-12-07',
          endsOn: '2026-12-08',
          predecessorId: null,
          lagDays: 0,
          progressPercent: 0,
          clientRequestId: randomUUID(),
        },
      });
      expect(result.status(), await result.text()).toBe(201);
      return (await result.json()).id as string;
    }
    const opening = await addTask('Check north opening');
    const frame = await addTask('Inspect north frame');
    await openMediaProject(page, fixture);
    const bytes = await sharp({
      create: { width: 12, height: 12, channels: 3, background: '#497F98' },
    })
      .png()
      .toBuffer();
    const upload = page.getByRole('form', { name: uploadFormName });
    await upload.getByLabel('Jobsite photo').setInputFiles({
      name: 'linked-fixture.png',
      mimeType: 'image/png',
      buffer: bytes,
    });
    await upload.getByRole('button', { name: 'Upload photo', exact: true }).click();
    await expect(page.getByText('linked-fixture.png uploaded for scanning.')).toBeVisible();

    const photos = page.getByRole('region', { name: 'Project photos' });
    const card = photos.getByRole('listitem').filter({ hasText: 'linked-fixture.png' });
    await card.getByText('Linked tasks', { exact: true }).click();
    const linkForm = card.getByRole('form', { name: 'Link media to task' });
    const picker = linkForm.getByRole('combobox', { name: 'Schedule task' });
    const results = card.getByRole('list', { name: 'Linked schedule tasks' });
    await picker.selectOption(opening);
    await linkForm.getByRole('button', { name: 'Link task', exact: true }).click();
    await expect(
      results.getByRole('listitem').filter({ hasText: 'Check north opening' }),
    ).toContainText('Reference');

    await picker.selectOption(frame);
    await linkForm.getByRole('checkbox', { name: 'Use as completion evidence' }).check();
    await linkForm.getByRole('button', { name: 'Link task', exact: true }).click();
    await expect(
      results.getByRole('listitem').filter({ hasText: 'Inspect north frame' }),
    ).toContainText('Completion evidence');
    await expect(results.getByRole('listitem')).toHaveCount(2);

    const listing = await page.request.get(fixture.apiPath);
    expect(listing.status()).toBe(200);
    const { items } = await listing.json();
    expect(items).toMatchObject([
      { filename: 'linked-fixture.png', sha256: createHash('sha256').update(bytes).digest('hex') },
    ]);
    const links = await page.request.get(fixture.apiPath + '/' + items[0].id + '/task-links');
    expect(links.status()).toBe(200);
    expect(await links.json()).toMatchObject({
      revision: 2,
      items: [
        { assetId: items[0].id, taskId: opening, evidenceType: 'reference' },
        { assetId: items[0].id, taskId: frame, evidenceType: 'completion_evidence' },
      ],
    });

    await page.reload();
    await card.getByText('Linked tasks', { exact: true }).click();
    await expect(results.getByRole('listitem')).toHaveCount(2);
    await expect(results.getByText('Check north opening', { exact: true })).toBeVisible();
    await expect(results.getByText('Inspect north frame', { exact: true })).toBeVisible();
  } finally {
    await fixture.restore(page);
  }
});

test('draws a private annotation and recovers a stale draft without altering the original', async ({
  page,
  baseURL,
  isMobile,
}) => {
  const paintFixture = process.env.FIELDPRO_E2E_ANNOTATION_PHOTO;
  test.skip(
    process.env.E2E_ENTERPRISE_DEV !== '1' || !paintFixture,
    'Requires the isolated photo scanner fixture.',
  );
  if (!paintFixture) throw new Error('The annotation photo fixture is missing.');
  test.setTimeout(90_000);
  const fixture = await preparePhotoProject(page, baseURL);
  try {
    await openMediaProject(page, fixture);
    const bytes = await readFile(paintFixture);
    const input = page.getByRole('form', { name: uploadFormName });
    const filename = 'inspection-annotation.png';
    await input
      .getByLabel('Jobsite photo')
      .setInputFiles({ name: filename, mimeType: 'image/png', buffer: bytes });
    await input.getByRole('button', { name: 'Upload photo', exact: true }).click();
    const card = page
      .getByRole('region', { name: 'Project photos' })
      .getByRole('listitem')
      .filter({ hasText: filename });
    const original = card.getByRole('link', { name: 'Download original' });
    await expect(original).toBeVisible({ timeout: 30_000 });
    const originalPath = await original.getAttribute('href');
    if (!originalPath) throw new Error('Original download is missing.');
    const annotationPath = originalPath.replace(/\/original$/, '/annotations');
    const originalRead = await page.request.get(originalPath);
    expect(originalRead.status()).toBe(200);
    expect(await originalRead.body()).toEqual(bytes);

    await card.getByText('Photo annotations', { exact: true }).click();
    await card.getByRole('button', { name: 'Annotate photo', exact: true }).click();
    const editor = card.getByRole('region', { name: 'Photo annotation editor' });
    const canvas = editor.getByLabel('Photo annotation canvas');
    await expect(canvas).toBeVisible();
    await expect(canvas).toHaveJSProperty('width', 640);
    const tools = editor.getByRole('combobox', { name: 'Annotation tool' });
    await tools.selectOption('redaction');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Photo canvas is unavailable.');
    const from = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 };
    const to = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.7 };
    if (isMobile) {
      const touch = await page.context().newCDPSession(page);
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to] });
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await touch.detach();
    } else {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 5 });
      await page.mouse.up();
    }
    await expect(editor.getByRole('list', { name: 'Draft annotation list' })).toContainText(
      'Redaction',
    );
    await tools.selectOption('note');
    await editor.getByLabel('Note text').fill('<opening> & check');
    await editor.getByText('Place by coordinates', { exact: true }).click();
    const coordinates = editor.getByRole('form', { name: 'Place annotation by coordinates' });
    await coordinates.getByLabel('Start X (%)').fill('5');
    await coordinates.getByLabel('Start Y (%)').fill('8');
    await coordinates.getByRole('button', { name: 'Add annotation' }).click();
    await editor.getByRole('button', { name: 'Save annotations', exact: true }).click();
    await expect(
      card.getByText('Saved photo annotation revision 1.', { exact: true }),
    ).toBeVisible();
    const result = card.getByRole('img', {
      name: 'Annotated ' + filename + ', revision 1',
      exact: true,
    });
    await expect(result).toHaveJSProperty('naturalWidth', 640);
    await expect(card.getByRole('list', { name: 'Saved annotations' })).toContainText(
      '<opening> & check',
    );
    const first = await page.request.get(annotationPath + '/1/image');
    expect(first.status()).toBe(200);
    const pixels = await sharp(await first.body())
      .ensureAlpha()
      .raw()
      .toBuffer();
    const center = (192 * 640 + 320) * 4;
    expect(Array.from(pixels.subarray(center, center + 4))).toEqual([0, 0, 0, 255]);

    await card.getByRole('button', { name: 'Edit annotations', exact: true }).click();
    await editor.getByRole('button', { name: 'Remove redaction 1' }).click();
    const intervening = await page.request.post(annotationPath, {
      headers: { origin: new URL(baseURL ?? 'http://localhost:3000').origin, 'if-match': '"1"' },
      data: {
        baseDerivativeVersion: 1,
        clientRequestId: randomUUID(),
        annotations: [{ kind: 'arrow', from: { x: 0.2, y: 0.2 }, to: { x: 0.6, y: 0.2 } }],
      },
    });
    expect(intervening.status(), await intervening.text()).toBe(201);
    await editor.getByRole('button', { name: 'Save annotations', exact: true }).click();
    await expect(
      editor.getByText('Another edit saved revision 2. Your draft is still available.'),
    ).toBeVisible();
    await editor.getByRole('button', { name: 'Copy draft annotations' }).click();
    await expect(editor.getByLabel('Draft annotations to copy')).toHaveValue(/<opening> & check/);
    await editor.getByRole('button', { name: 'Reload latest annotations' }).click();
    await expect(editor.getByRole('list', { name: 'Draft annotation list' })).toContainText(
      'Arrow',
    );
    await editor.getByRole('button', { name: 'Cancel annotation edit' }).click();

    await page.reload();
    await card.getByText('Photo annotations', { exact: true }).click();
    await expect(card.getByRole('list', { name: 'Saved annotations' })).toContainText('Arrow');
    await card.getByRole('combobox', { name: 'Annotation revision' }).selectOption('1');
    await expect(result).toHaveJSProperty('naturalWidth', 640);
    const originalAfter = await page.request.get(originalPath);
    expect(originalAfter.status()).toBe(200);
    expect(
      createHash('sha256')
        .update(await originalAfter.body())
        .digest('hex'),
    ).toBe(createHash('sha256').update(bytes).digest('hex'));
  } finally {
    await fixture.restore(page);
  }
});

type EvidenceFixture = Awaited<ReturnType<typeof preparePhotoProject>>;

async function openEvidenceActor(
  browser: Browser,
  contexts: BrowserContext[],
  baseURL: string,
  path: string,
  testInfo: TestInfo,
  subject: string,
) {
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = testInfo.project.use;
  const context = await browser.newContext({
    baseURL,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  });
  contexts.push(context);
  const actor = await context.newPage();
  await actor.goto('/v1/auth/login/dev?returnTo=' + encodeURIComponent(path));
  await chooseEvidenceIdentity(actor, subject);
  await actor.waitForURL('**' + path);
  await expect(actor.getByRole('heading', { name: 'Jobsite media', exact: true })).toBeVisible();
  const me = await actor.request.get('/v1/me');
  expect(me.status()).toBe(200);
  expect((await me.json()).user.email).toBe(subject + '@example.test');
  return actor;
}

async function createEvidenceTask(
  page: Page,
  fixture: EvidenceFixture,
  headers: { origin: string },
) {
  const roster = await page.request.get('/v1/team/members?status=active&limit=100');
  expect(roster.status()).toBe(200);
  const { items } = (await roster.json()) as {
    items: { id: string; email: string; role: string }[];
  };
  const crew = items.find((member) => member.email === 'demo-roof-crew_manager@example.test');
  const reviewer = items.find((member) => member.email === 'demo-roof-reviewer@example.test');
  if (!crew || !reviewer) throw new Error('The synthetic evidence team members are missing.');
  expect(crew.role).toBe('crew_manager');
  expect(reviewer.role).toBe('reviewer');

  for (const member of [crew, reviewer]) {
    const grant = await page.request.put(fixture.apiPath + '/grants/' + member.id, {
      headers: { ...headers, 'if-match': '"0"' },
      data: { active: true, reason: 'Browser evidence fixture.', clientRequestId: randomUUID() },
    });
    expect(grant.status(), await grant.text()).toBe(200);
  }
  const task = {
    title: 'Inspect framing evidence',
    phase: 'Quality',
    startsOn: '2026-12-07',
    endsOn: '2026-12-08',
    predecessorId: null,
    lagDays: 0,
    progressPercent: 0,
  };
  const tasksPath = fixture.apiPath.replace(/\/media$/, '/schedule/tasks');
  const scheduled = await page.request.post(tasksPath, {
    headers,
    data: { ...task, clientRequestId: randomUUID() },
  });
  expect(scheduled.status(), await scheduled.text()).toBe(201);
  const taskId = (await scheduled.json()).id as string;
  return { crew, reviewer, task, taskId, taskPath: tasksPath + '/' + taskId };
}

async function uploadTaskEvidence(
  contractor: Page,
  filename: string,
  bytes: Buffer,
  taskId: string,
  title: string,
) {
  const upload = contractor.getByRole('form', { name: uploadFormName });
  await upload
    .getByLabel('Jobsite photo')
    .setInputFiles({ name: filename, mimeType: 'image/png', buffer: bytes });
  await upload.getByRole('button', { name: 'Upload photo', exact: true }).click();
  await expect(contractor.getByText(filename + ' uploaded for scanning.')).toBeVisible();
  const photo = contractor
    .getByRole('region', { name: 'Project photos' })
    .getByRole('listitem')
    .filter({ hasText: filename });
  await photo.getByText('Linked tasks', { exact: true }).click();
  const link = photo.getByRole('form', { name: 'Link media to task' });
  await link.getByRole('combobox', { name: 'Schedule task' }).selectOption(taskId);
  await link.getByRole('checkbox', { name: 'Use as completion evidence' }).check();
  await link.getByRole('button', { name: 'Link task', exact: true }).click();
  await expect(photo.getByRole('list', { name: 'Linked schedule tasks' })).toContainText(title);
}

async function openTaskEvidence(page: Page, taskId: string) {
  await page.getByText('Task evidence', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Evidence task' }).selectOption(taskId);
}

async function submitEvidenceForm(page: Page, filename: string, note: string, revision: number) {
  const form = page.getByRole('form', { name: 'Submit task evidence' });
  const candidate = form.getByRole('checkbox', { name: filename });
  await expect(candidate).toBeEnabled({ timeout: 30_000 });
  await candidate.check();
  await form.getByLabel('Evidence note').fill(note);
  await form.getByRole('button', { name: 'Submit evidence', exact: true }).click();
  await expect(
    page.getByText('Evidence revision ' + revision + ' submitted for review.', { exact: true }),
  ).toBeVisible();
  await expect(form).toHaveCount(0);
}

test('assigns a contractor and submits one frozen evidence revision to the inspector', async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const file = process.env.FIELDPRO_E2E_ANNOTATION_PHOTO;
  test.skip(
    process.env.E2E_ENTERPRISE_DEV !== '1' ||
      process.env.FIELDPRO_E2E_EVIDENCE_ACTORS !== '1' ||
      !file,
    'Requires isolated seeded company actors and the scan fixture.',
  );
  if (!file) throw new Error('The evidence photo fixture is missing.');
  test.setTimeout(120_000);
  const fixture = await preparePhotoProject(page, baseURL);
  const contexts: BrowserContext[] = [];
  const appUrl = baseURL ?? 'http://localhost:3000';
  const headers = { origin: new URL(appUrl).origin };

  try {
    const { crew, reviewer, taskId, task } = await createEvidenceTask(page, fixture, headers);
    await openMediaProject(page, fixture);
    await page.getByText('Task evidence', { exact: true }).click();
    await page.getByRole('combobox', { name: 'Evidence task' }).selectOption(taskId);
    const assignment = page.getByRole('form', { name: 'Evidence assignment' });
    await assignment.getByRole('combobox', { name: 'Contractor' }).selectOption(crew.id);
    await assignment.getByRole('combobox', { name: 'Inspector' }).selectOption(reviewer.id);
    await assignment.getByRole('button', { name: 'Save evidence assignment' }).click();
    await expect(page.getByText('Evidence assignment saved.', { exact: true })).toBeVisible();

    const contractor = await openEvidenceActor(
      browser,
      contexts,
      appUrl,
      fixture.path,
      testInfo,
      'demo-roof-crew_manager',
    );
    const filename = 'north-frame-evidence.png';
    const bytes = await readFile(file);
    await uploadTaskEvidence(contractor, filename, bytes, taskId, task.title);

    await openTaskEvidence(contractor, taskId);
    await submitEvidenceForm(contractor, filename, 'North frame is ready for inspection.', 1);
    const submitted = contractor.getByRole('region', { name: 'Submitted evidence' });
    const original = await submitted
      .getByRole('link', { name: 'Download submitted original' })
      .getAttribute('href');
    if (!original) throw new Error('The evidence download is missing.');
    const downloaded = await contractor.request.get(original);
    expect(downloaded.status()).toBe(200);
    expect(await downloaded.body()).toEqual(bytes);

    const inspector = await openEvidenceActor(
      browser,
      contexts,
      appUrl,
      fixture.path,
      testInfo,
      'demo-roof-reviewer',
    );
    await openTaskEvidence(inspector, taskId);
    const review = inspector.getByRole('region', { name: 'Submitted evidence' });
    await expect(
      review.getByRole('heading', { name: 'Submitted evidence revision 1' }),
    ).toBeVisible();
    await expect(review.getByText('North frame is ready for inspection.')).toBeVisible();
    await expect(review.getByText(filename)).toBeVisible();
    await expect(inspector.getByRole('form', { name: 'Submit task evidence' })).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await fixture.restore(page);
  }
});

test('retains stale inspection findings and allows completion only after revised evidence is approved', async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const file = process.env.FIELDPRO_E2E_ANNOTATION_PHOTO;
  test.skip(
    process.env.E2E_ENTERPRISE_DEV !== '1' ||
      process.env.FIELDPRO_E2E_EVIDENCE_ACTORS !== '1' ||
      !file,
    'Requires isolated seeded company actors and the scan fixture.',
  );
  if (!file) throw new Error('The evidence photo fixture is missing.');
  test.setTimeout(120_000);
  const fixture = await preparePhotoProject(page, baseURL);
  const contexts: BrowserContext[] = [];
  const appUrl = baseURL ?? 'http://localhost:3000';
  const headers = { origin: new URL(appUrl).origin };

  try {
    const { crew, reviewer, taskId, task, taskPath } = await createEvidenceTask(
      page,
      fixture,
      headers,
    );
    const path = fixture.apiPath + '/evidence/tasks/' + taskId;
    const assignment = await page.request.put(path + '/assignment', {
      headers: { ...headers, 'if-match': '"0"' },
      data: {
        active: true,
        minimumMedia: 1,
        contractorMembershipId: crew.id,
        reviewerMembershipId: reviewer.id,
        clientRequestId: randomUUID(),
      },
    });
    expect(assignment.status(), await assignment.text()).toBe(200);
    const contractor = await openEvidenceActor(
      browser,
      contexts,
      appUrl,
      fixture.path,
      testInfo,
      'demo-roof-crew_manager',
    );
    const filename = 'completion-review-framing.png';
    await uploadTaskEvidence(contractor, filename, await readFile(file), taskId, task.title);
    await openTaskEvidence(contractor, taskId);
    await submitEvidenceForm(contractor, filename, 'Early framing evidence.', 1);
    const inspector = await openEvidenceActor(
      browser,
      contexts,
      appUrl,
      fixture.path,
      testInfo,
      'demo-roof-reviewer',
    );
    await openTaskEvidence(inspector, taskId);
    const submitted = inspector.getByRole('region', { name: 'Submitted evidence' });
    await submitted.getByRole('button', { name: 'Review submitted evidence' }).click();
    const editor = inspector.getByRole('form', { name: 'Decide task evidence' });
    const findings = 'Draft findings from the open browser.';
    await editor.getByRole('combobox', { name: 'Inspection decision' }).selectOption('approved');
    await editor.getByLabel('Inspection findings').fill(findings);

    const current = await inspector.request.get(path);
    expect(current.status()).toBe(200);
    const reviewId = (await current.json()).submission.review.id;
    const changed = await inspector.request.post(path + '/reviews/' + reviewId + '/decision', {
      headers: { ...headers, 'if-match': '"1"' },
      data: {
        decision: 'rejected',
        findings: 'Add the corrected framing evidence.',
        clientRequestId: randomUUID(),
      },
    });
    expect(changed.status(), await changed.text()).toBe(201);
    await editor.getByRole('button', { name: 'Record inspection decision' }).click();
    await expect(editor.getByText(/The evidence or decision changed/)).toBeVisible();
    await expect(editor.getByLabel('Inspection findings')).toHaveValue(findings);
    await expect(editor.getByRole('button', { name: 'Record inspection decision' })).toBeDisabled();
    await editor.getByRole('button', { name: 'Cancel decision draft' }).click();
    await expect(submitted.getByText('Rejected', { exact: true })).toBeVisible();

    async function completeTask() {
      const completed = { ...task, progressPercent: 100 };
      const requestHeaders = { ...headers, 'if-match': '"1"' };
      const preview = await page.request.post(taskPath + '/preview', {
        headers: requestHeaders,
        data: completed,
      });
      expect(preview.status(), await preview.text()).toBe(200);
      return page.request.patch(taskPath, {
        headers: requestHeaders,
        data: {
          task: completed,
          previewToken: (await preview.json()).token,
          reason: 'Field check complete.',
        },
      });
    }
    expect((await completeTask()).status()).toBe(409);

    await contractor.getByRole('button', { name: 'Refresh task evidence' }).click();
    await submitEvidenceForm(contractor, filename, 'Corrected framing evidence.', 2);
    await submitted.getByRole('button', { name: 'Refresh task evidence' }).click();
    await expect(
      submitted.getByRole('heading', { name: 'Submitted evidence revision 2' }),
    ).toBeVisible();
    await submitted.getByRole('button', { name: 'Review submitted evidence' }).click();
    await editor.getByRole('combobox', { name: 'Inspection decision' }).selectOption('approved');
    await editor
      .getByLabel('Inspection findings')
      .fill('Correction meets the inspection checklist.');
    await editor.getByRole('button', { name: 'Record inspection decision' }).click();
    await expect(submitted.getByText('Eligible for schedule completion')).toBeVisible();
    await expect(submitted.getByText('Correction meets the inspection checklist.')).toBeVisible();
    const completed = await completeTask();
    expect(completed.status(), await completed.text()).toBe(200);
    const schedule = await page.request.get(fixture.apiPath.replace(/\/media$/, '/schedule'));
    expect(schedule.status()).toBe(200);
    expect((await schedule.json()).items).toMatchObject([{ id: taskId, progressPercent: 100 }]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await fixture.restore(page);
  }
});

test('previews homeowner-safe pixels and invalidates approval after private redactions change', async ({
  page,
  baseURL,
}) => {
  const file = process.env.FIELDPRO_E2E_ANNOTATION_PHOTO;
  test.skip(
    process.env.E2E_ENTERPRISE_DEV !== '1' || !file,
    'Requires the isolated photo scanner fixture.',
  );
  if (!file) throw new Error('The homeowner preview fixture is missing.');
  test.setTimeout(90_000);
  const fixture = await preparePhotoProject(page, baseURL);
  const headers = { origin: new URL(baseURL ?? 'http://localhost:3000').origin };
  try {
    await openMediaProject(page, fixture);
    const filename = 'homeowner-preview-source.png';
    const bytes = await readFile(file);
    const upload = page.getByRole('form', { name: uploadFormName });
    await upload
      .getByLabel('Jobsite photo')
      .setInputFiles({ name: filename, mimeType: 'image/png', buffer: bytes });
    await upload.getByRole('button', { name: 'Upload photo', exact: true }).click();
    const card = page
      .getByRole('region', { name: 'Project photos' })
      .getByRole('listitem')
      .filter({ hasText: filename });
    const original = card.getByRole('link', { name: 'Download original' });
    await expect(original).toBeVisible({ timeout: 30_000 });
    const originalPath = await original.getAttribute('href');
    if (!originalPath) throw new Error('Original download is missing.');
    const asset = originalPath.replace(/\/original$/, '');
    async function savePrivateMarkup(revision: number) {
      const result = await page.request.post(asset + '/annotations', {
        headers: { ...headers, 'if-match': '"' + revision + '"' },
        data: {
          baseDerivativeVersion: revision,
          clientRequestId: randomUUID(),
          annotations: [
            { kind: 'redaction', from: { x: 0.2, y: 0.25 }, to: { x: 0.7, y: 0.7 } },
            { kind: 'note', at: { x: 0.05, y: 0.75 }, text: 'Private scheduling detail' },
            ...(revision === 1
              ? [{ kind: 'redaction', from: { x: 0.75, y: 0.05 }, to: { x: 0.95, y: 0.24 } }]
              : []),
          ],
        },
      });
      expect(result.status(), await result.text()).toBe(201);
    }
    await savePrivateMarkup(0);

    await card.getByText('Customer photo preview', { exact: true }).click();
    const controls = card.getByRole('region', { name: 'Customer photo preview controls' });
    await controls.getByRole('button', { name: 'Prepare customer preview', exact: true }).click();
    const image = controls.getByRole('img', { name: 'Customer photo preview, revision 1' });
    await expect(image).toHaveJSProperty('naturalWidth', 640);
    const imageSource = await image.getAttribute('src');
    if (!imageSource) throw new Error('The homeowner preview image is missing.');
    const savedPreview = await page.request.get(imageSource);
    expect(savedPreview.status()).toBe(200);
    const png = await savedPreview.body();
    const rgba = await sharp(png).ensureAlpha().raw().toBuffer();
    const redacted = (192 * 640 + 320) * 4;
    expect(Array.from(rgba.subarray(redacted, redacted + 4))).toEqual([0, 0, 0, 255]);
    const note = (Math.round(0.75 * 383) * 640 + Math.round(0.05 * 639)) * 4;
    expect(Array.from(rgba.subarray(note, note + 4))).toEqual([23, 70, 92, 255]);
    const form = controls.getByRole('form', { name: 'Approve customer photo preview' });
    const approve = form.getByRole('button', { name: 'Approve preview', exact: true });
    await form.getByLabel('Approval reason').fill('Checked the redacted homeowner image.');
    await expect(approve).toBeDisabled();
    await form
      .getByRole('checkbox', { name: 'I reviewed this image for homeowner visibility' })
      .check();
    await approve.click();
    await expect(controls.getByText('Approved for homeowner sharing')).toBeVisible();

    await savePrivateMarkup(1);
    await controls.getByRole('button', { name: 'Refresh preview status' }).click();
    await expect(controls.getByText('Prior approval', { exact: true })).toBeVisible();
    await expect(controls.getByText('Approved for homeowner sharing')).toHaveCount(0);
    await controls.getByRole('button', { name: 'Prepare customer preview', exact: true }).click();
    await expect(
      controls.getByRole('img', { name: 'Customer photo preview, revision 2' }),
    ).toHaveJSProperty('naturalWidth', 640);
    await expect(controls.getByText('2 opaque redactions')).toBeVisible();
    await expect(form).toBeVisible();
    await expect(approve).toBeDisabled();
    const unchanged = await page.request.get(originalPath);
    expect(unchanged.status()).toBe(200);
    expect(await unchanged.body()).toEqual(bytes);
  } finally {
    await fixture.restore(page);
  }
});

test('publishes a selected homeowner photo and withdraws its link from the public gallery', async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const file = process.env.FIELDPRO_E2E_ANNOTATION_PHOTO;
  test.skip(
    process.env.E2E_ENTERPRISE_DEV !== '1' || !file,
    'Requires the isolated photo scanner fixture.',
  );
  if (!file) throw new Error('The shared photo fixture is missing.');
  test.setTimeout(120_000);
  const fixture = await preparePhotoProject(page, baseURL);
  const base = baseURL ?? 'http://localhost:3000';
  const headers = { origin: new URL(base).origin };
  const bytes = await readFile(file);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const { viewport, isMobile, hasTouch, userAgent, deviceScaleFactor } = testInfo.project.use;
  const guestContext = await browser.newContext({
    baseURL: base,
    viewport,
    isMobile,
    hasTouch,
    userAgent,
    deviceScaleFactor,
  });

  async function prepare(filename: string) {
    const started = await page.request.post(fixture.apiPath + '/upload-sessions', {
      headers: { ...headers, 'if-match': '"0"' },
      data: {
        localCaptureId: randomUUID(),
        filename,
        mimeType: 'image/png',
        byteSize: bytes.length,
        sha256,
        capturedAt: '2026-11-20T15:00:00.000Z',
      },
    });
    expect(started.status(), await started.text()).toBe(201);
    const assetId = (await started.json()).id as string;
    const session = fixture.apiPath + '/upload-sessions/' + assetId;
    const uploaded = await page.request.put(session + '/parts/0', {
      headers: { ...headers, 'if-match': '"1"' },
      data: { sha256, contentBase64: bytes.toString('base64') },
    });
    expect(uploaded.status(), await uploaded.text()).toBe(200);
    const finalized = await page.request.post(session + '/finalize', {
      headers: { ...headers, 'if-match': '"2"' },
      data: { clientRequestId: randomUUID() },
    });
    expect(finalized.status(), await finalized.text()).toBe(201);

    await expect
      .poll(
        async () => {
          const response = await page.request.get(fixture.apiPath);
          if (!response.ok()) return 'unavailable';
          const result = (await response.json()).items.find(
            ({ id }: { id: string }) => id === assetId,
          );
          return result?.scanState;
        },
        { timeout: 25_000 },
      )
      .toBe('clean');
    const url = fixture.apiPath + '/' + assetId + '/customer-preview';
    const prepared = await page.request.post(url, {
      headers: { ...headers, 'if-match': '"0"' },
      data: { baseAnnotationRevision: 0, clientRequestId: randomUUID() },
    });
    expect(prepared.status(), await prepared.text()).toBe(201);
    const preview = (await prepared.json()) as { id: string; sha256: string };
    const approved = await page.request.post(url + '/' + preview.id + '/approve', {
      headers: { ...headers, 'if-match': '"1"' },
      data: {
        confirmedCustomerSafe: true,
        reason: 'Verified the gallery source.',
        clientRequestId: randomUUID(),
      },
    });
    expect(approved.status(), await approved.text()).toBe(201);
    return { assetId, previewId: preview.id, sha256: preview.sha256 };
  }

  try {
    const customerName = 'Gallery test customer ' + randomUUID().slice(0, 8);
    const customer = await page.request.post('/v1/customers', {
      headers,
      data: { kind: 'person', displayName: customerName },
    });
    expect(customer.status(), await customer.text()).toBe(201);
    const customerId = (await customer.json()).id as string;
    const contactName = 'Gallery fixture homeowner';
    const contact = await page.request.post('/v1/customers/' + customerId + '/contacts', {
      headers,
      data: { displayName: contactName, isPrimary: true },
    });
    expect(contact.status(), await contact.text()).toBe(201);
    const contactId = (await contact.json()).id as string;
    const selected = await prepare('selected-gallery.png');
    const other = await prepare('unselected-gallery.png');
    await openMediaProject(page, fixture);
    await page.getByText('Homeowner photo shares', { exact: true }).click();
    await page.getByText('Homeowner contact access', { exact: true }).click();
    const grant = page.getByRole('form', { name: 'Homeowner contact assignment' });
    await grant.getByRole('combobox', { name: 'CRM customer' }).selectOption(customerId);
    await grant.getByRole('combobox', { name: 'CRM contact' }).selectOption(contactId);
    await grant.getByLabel('Contact access reason').fill('Assign this homeowner to the project.');
    await grant.getByRole('button', { name: 'Grant gallery access' }).click();
    await expect(grant.getByText('Project gallery access granted')).toBeVisible();

    const publish = page.getByRole('form', { name: 'Publish homeowner gallery' });
    await publish.getByRole('combobox', { name: 'Homeowner recipient' }).selectOption(contactId);
    await publish
      .getByLabel('Expires at')
      .fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 16));
    await publish.getByRole('checkbox', { name: 'selected-gallery.png', exact: true }).check();
    await expect(
      publish.getByRole('checkbox', { name: 'unselected-gallery.png', exact: true }),
    ).not.toBeChecked();
    await publish.getByRole('button', { name: 'Publish gallery', exact: true }).click();
    const link = page
      .getByRole('region', { name: 'Published gallery link' })
      .getByLabel('Gallery link');
    await expect(link).toBeVisible();
    const url = new URL(await link.inputValue());
    expect(url.search).toBe('');
    const token = new URLSearchParams(url.hash.slice(1)).get('t');
    expect(token).toHaveLength(43);

    const visitor = await guestContext.newPage();
    const imagePath = '/v1' + url.pathname + '/images/' + selected.previewId;
    const delivered = visitor.waitForResponse(
      (response) => new URL(response.url()).pathname === imagePath,
    );
    await visitor.goto(url.pathname + url.hash);
    await expect(visitor.getByRole('heading', { name: 'Shared project photos' })).toBeVisible();
    await expect(visitor.getByText('Gallery for ' + contactName)).toBeVisible();
    const photo = visitor.getByRole('img', { name: 'Shared project photo', exact: true });
    await expect(photo).toHaveCount(1);
    await expect(photo).toHaveJSProperty('naturalWidth', 640);
    const response = await delivered;
    expect(response.status()).toBe(200);
    const displayed = await photo.evaluate(async (element: HTMLImageElement) => {
      const loaded = await fetch(element.currentSrc);
      return [...new Uint8Array(await loaded.arrayBuffer())];
    });
    expect(createHash('sha256').update(Buffer.from(displayed)).digest('hex')).toBe(selected.sha256);
    await expect(visitor.getByText('selected-gallery.png', { exact: true })).toHaveCount(0);
    for (const id of [selected.assetId, other.previewId]) {
      const blocked = await visitor.request.post('/v1' + url.pathname + '/images/' + id, {
        headers,
        data: { token },
      });
      expect(blocked.status()).toBe(404);
    }

    await page.getByRole('button', { name: 'Revoke this gallery' }).click();
    const withdraw = page.getByRole('form', { name: 'Revoke homeowner gallery' });
    await withdraw.getByLabel('Revocation reason').fill('Withdraw this customer link.');
    await withdraw.getByRole('button', { name: 'Confirm revocation' }).click();
    await expect(page.getByText('Homeowner gallery revoked.', { exact: true })).toBeVisible();
    await visitor.reload();
    await expect(
      visitor.getByRole('heading', { name: 'This photo link is unavailable' }),
    ).toBeVisible();
    await expect(photo).toHaveCount(0);
  } finally {
    await guestContext.close();
    await fixture.restore(page);
  }
});

test('queues and downloads a real ZIP and indexed PDF from project media', async ({
  page,
  baseURL,
}) => {
  const file = process.env.FIELDPRO_E2E_ANNOTATION_PHOTO;
  test.skip(
    process.env.E2E_ENTERPRISE_DEV !== '1' || !file,
    'Requires the isolated photo scanner and export worker.',
  );
  if (!file) throw new Error('The media export fixture is missing.');
  test.setTimeout(90_000);
  const fixture = await preparePhotoProject(page, baseURL);
  try {
    await openMediaProject(page, fixture);
    const filename = 'package-source.png';
    const bytes = await readFile(file);
    const upload = page.getByRole('form', { name: uploadFormName });
    await upload
      .getByLabel('Jobsite photo')
      .setInputFiles({ name: filename, mimeType: 'image/png', buffer: bytes });
    await upload.getByRole('button', { name: 'Upload photo', exact: true }).click();
    const photo = page
      .getByRole('region', { name: 'Project photos' })
      .getByRole('listitem')
      .filter({ hasText: filename });
    await expect(photo.getByRole('link', { name: 'Download original' })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByText('Media packages', { exact: true }).click();
    const form = page.getByRole('form', { name: 'Create media package' });
    const packages = page.getByRole('list', { name: 'Requested media packages' });

    async function createAndDownload(format: 'zip' | 'pdf', prefix: string) {
      const label = format.toUpperCase();
      await form.getByRole('combobox', { name: 'Package format' }).selectOption(format);
      await form.getByRole('combobox', { name: 'File versions' }).selectOption('original');
      await form.getByRole('checkbox', { name: filename, exact: true }).check();
      await form.getByRole('button', { name: 'Create package', exact: true }).click();
      await expect(page.getByText(label + ' package requested.', { exact: true })).toBeVisible();
      const row = packages.getByRole('listitem').filter({ hasText: label + ' package' });
      const save = row.getByRole('button', { name: 'Download ' + label + ' package', exact: true });
      await expect(save).toBeVisible({ timeout: 30_000 });
      const listener = page.waitForEvent('download');
      await save.click();
      const download = await listener;
      expect(download.suggestedFilename()).toMatch(
        new RegExp('^jobsite-media-[a-f0-9]{8}\\.' + format + '$'),
      );
      const downloadedPath = await download.path();
      if (!downloadedPath) throw new Error('The browser did not save the media package.');
      const content = await readFile(downloadedPath);
      expect(content.subarray(0, prefix.length).toString()).toBe(prefix);
      const request = await page.request.get(fixture.apiPath + '/exports');
      expect(request.status()).toBe(200);
      const entries = (await request.json()).items;
      const result = entries.find((item: { format: string }) => item.format === format);
      expect(result).toMatchObject({
        status: 'ready',
        selection: 'original',
        manifest: [{ name: filename, sha256: createHash('sha256').update(bytes).digest('hex') }],
        sha256: createHash('sha256').update(content).digest('hex'),
        byteSize: content.length,
      });
    }

    await createAndDownload('zip', 'PK');
    await createAndDownload('pdf', '%PDF-');
  } finally {
    await fixture.restore(page);
  }
});

test('shows project media activity in a desktop panel and tablet drawer with a phone capture shortcut', async ({
  page,
  baseURL,
  isMobile,
}) => {
  const file = process.env.FIELDPRO_E2E_ANNOTATION_PHOTO;
  test.skip(
    process.env.E2E_ENTERPRISE_DEV !== '1' || !file,
    'Requires the isolated photo scanner fixture.',
  );
  if (!file) throw new Error('The media activity photo fixture is missing.');
  test.setTimeout(90_000);
  const fixture = await preparePhotoProject(page, baseURL);
  try {
    await openMediaProject(page, fixture);
    const breadcrumb = page.getByRole('navigation', { name: 'Project media breadcrumb' });
    await expect(breadcrumb.getByRole('link', { name: 'Field Execution' })).toBeVisible();
    await expect(page.locator('.enterprise-hero')).toContainText('Summit Ridge Roofing');
    await expect(page.locator('.enterprise-hero')).toContainText('Jobsite photo browser');
    const panel = page.getByRole('complementary', { name: 'Project media activity' });
    await expect(panel).toBeVisible();

    const input = page.getByRole('form', { name: uploadFormName });
    const filename = 'activity-fixture.png';
    if (isMobile) {
      const sticky = page
        .locator('.enterprise-mobile-capture')
        .getByRole('link', { name: 'Capture media' });
      await expect(sticky).toBeVisible();
      const position = await sticky.boundingBox();
      const viewport = page.viewportSize();
      if (!position || !viewport) throw new Error('The phone capture action is missing.');
      expect(position.y + position.height).toBeLessThanOrEqual(viewport.height);
      await sticky.click();
      await expect(page).toHaveURL(/#jobsite-capture$/);
      await expect(input).toBeInViewport();
    } else {
      const workspace = await page.locator('.enterprise-jobsite-workspace').boundingBox();
      const detail = await panel.boundingBox();
      if (!workspace || !detail) throw new Error('The desktop media columns are missing.');
      expect(detail.x).toBeGreaterThan(workspace.x + workspace.width);
    }

    const bytes = await readFile(file);
    await input
      .getByLabel('Jobsite photo')
      .setInputFiles({ name: filename, mimeType: 'image/png', buffer: bytes });
    await input.getByRole('button', { name: 'Upload photo', exact: true }).click();
    const rows = panel
      .getByRole('list', { name: 'Recent media events' })
      .getByRole('listitem')
      .filter({ hasText: filename });
    await expect(rows.filter({ hasText: 'Upload received' })).toBeVisible();
    await expect(rows.filter({ hasText: 'Scan completed' })).toBeVisible({ timeout: 30_000 });
    const photo = page
      .getByRole('region', { name: 'Project photos' })
      .getByRole('listitem')
      .filter({ hasText: filename });
    await expect(photo.getByText('Revision 2', { exact: true })).toBeVisible();

    if (!isMobile) {
      await page.setViewportSize({ width: 900, height: 900 });
      await expect(panel).toBeHidden();
      const trigger = page.getByRole('button', { name: 'Activity and exceptions' });
      await trigger.click();
      const drawer = page.getByRole('dialog', { name: 'Activity and exceptions' });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole('list', { name: 'Recent media events' })).toContainText(
        filename,
      );
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
  } finally {
    await fixture.restore(page);
  }
});

test('opens the assigned current evidence from the media review queue', async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const file = process.env.FIELDPRO_E2E_ANNOTATION_PHOTO;
  test.skip(
    process.env.E2E_ENTERPRISE_DEV !== '1' ||
      process.env.FIELDPRO_E2E_EVIDENCE_ACTORS !== '1' ||
      !file,
    'Requires isolated seeded company actors and the scan fixture.',
  );
  if (!file) throw new Error('The review queue photo fixture is missing.');
  test.setTimeout(90_000);
  const fixture = await preparePhotoProject(page, baseURL);
  const contexts: BrowserContext[] = [];
  const appUrl = baseURL ?? 'http://localhost:3000';
  const headers = { origin: new URL(appUrl).origin };
  try {
    const { crew, reviewer, taskId, task } = await createEvidenceTask(page, fixture, headers);
    const assignment = await page.request.put(
      fixture.apiPath + '/evidence/tasks/' + taskId + '/assignment',
      {
        headers: { ...headers, 'if-match': '"0"' },
        data: {
          active: true,
          minimumMedia: 1,
          contractorMembershipId: crew.id,
          reviewerMembershipId: reviewer.id,
          clientRequestId: randomUUID(),
        },
      },
    );
    expect(assignment.status(), await assignment.text()).toBe(200);
    const contractor = await openEvidenceActor(
      browser,
      contexts,
      appUrl,
      fixture.path,
      testInfo,
      'demo-roof-crew_manager',
    );
    const filename = 'queue-framing-evidence.png';
    await uploadTaskEvidence(contractor, filename, await readFile(file), taskId, task.title);
    await openTaskEvidence(contractor, taskId);
    await submitEvidenceForm(contractor, filename, 'The frame is ready for assigned review.', 1);
    const loaded = await contractor.request.get(fixture.apiPath);
    expect(loaded.status()).toBe(200);
    const projectName = (await loaded.json()).projectName as string;

    await expect(contractor.getByRole('link', { name: 'Media review', exact: true })).toHaveCount(
      0,
    );
    await contractor.goto('/enterprise/media/review');
    await expect(
      contractor.getByText('Media reviews are unavailable for your account.'),
    ).toBeVisible();
    await expect(contractor.getByRole('list', { name: 'Current evidence reviews' })).toHaveCount(0);

    const inspector = await openEvidenceActor(
      browser,
      contexts,
      appUrl,
      fixture.path,
      testInfo,
      'demo-roof-reviewer',
    );
    await inspector
      .getByRole('navigation', { name: 'Project media actions' })
      .getByRole('link', { name: 'Media review' })
      .click();
    const queue = inspector.getByRole('region', { name: 'Evidence review queue' });
    await expect(queue.getByRole('combobox', { name: 'Review status' })).toHaveValue('pending');
    const assigned = queue.getByRole('listitem').filter({ hasText: projectName });
    await expect(assigned).toContainText('Awaiting review');
    await expect(assigned).toContainText('Evidence revision 1');
    await assigned.getByRole('link', { name: task.title, exact: true }).click();
    await expect(inspector).toHaveURL(new RegExp('evidenceTask=' + taskId + '#jobsite-evidence$'));
    const selected = inspector.getByRole('region', { name: 'Submitted evidence' });
    await expect(
      selected.getByRole('heading', { name: 'Submitted evidence revision 1' }),
    ).toBeVisible();
    await expect(selected.getByText('The frame is ready for assigned review.')).toBeVisible();
    await selected.getByRole('button', { name: 'Review submitted evidence' }).click();
    const editor = inspector.getByRole('form', { name: 'Decide task evidence' });
    await editor.getByRole('combobox', { name: 'Inspection decision' }).selectOption('approved');
    await editor.getByLabel('Inspection findings').fill('Approved from the evidence queue.');
    await editor.getByRole('button', { name: 'Record inspection decision' }).click();
    await expect(selected.getByText('Eligible for schedule completion')).toBeVisible();
    await inspector
      .getByRole('navigation', { name: 'Project media actions' })
      .getByRole('link', { name: 'Media review' })
      .click();
    await expect(assigned).toHaveCount(0);
    await queue.getByRole('combobox', { name: 'Review status' }).selectOption('all');
    await expect(assigned).toContainText('Approved');
    await expect(assigned).toContainText('Evidence revision 1');
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await fixture.restore(page);
  }
});

test('shows a contractor only their assigned job media and withdraws the portal after reassignment', async ({
  page,
  browser,
  baseURL,
}, testInfo) => {
  const file = process.env.FIELDPRO_E2E_ANNOTATION_PHOTO;
  test.skip(
    process.env.E2E_ENTERPRISE_DEV !== '1' ||
      process.env.FIELDPRO_E2E_EVIDENCE_ACTORS !== '1' ||
      !file,
    'Requires isolated seeded company actors and the scan fixture.',
  );
  if (!file) throw new Error('The contractor portal photo fixture is missing.');
  test.setTimeout(120_000);
  const fixture = await preparePhotoProject(page, baseURL);
  const contexts: BrowserContext[] = [];
  const appUrl = baseURL ?? 'http://localhost:3000';
  const headers = { origin: new URL(appUrl).origin };

  try {
    const { crew, reviewer, taskId, task } = await createEvidenceTask(page, fixture, headers);
    const assignmentPath = fixture.apiPath + '/evidence/tasks/' + taskId + '/assignment';
    async function assign(active: boolean, version: number) {
      const response = await page.request.put(assignmentPath, {
        headers: { ...headers, 'if-match': '"' + version + '"' },
        data: {
          active,
          reviewerMembershipId: reviewer.id,
          contractorMembershipId: crew.id,
          minimumMedia: 1,
          clientRequestId: randomUUID(),
        },
      });
      expect(response.status(), await response.text()).toBe(200);
    }
    await assign(true, 0);
    const contractor = await openEvidenceActor(
      browser,
      contexts,
      appUrl,
      fixture.path,
      testInfo,
      'demo-roof-crew_manager',
    );
    const bytes = await readFile(file);
    const filename = 'contractor-portal-evidence.png';
    await uploadTaskEvidence(contractor, filename, bytes, taskId, task.title);
    await openTaskEvidence(contractor, taskId);
    await submitEvidenceForm(
      contractor,
      filename,
      'Private note in the internal evidence record.',
      1,
    );

    await openMediaProject(page, fixture);
    const internal = 'internal-owner-photo.png';
    const form = page.getByRole('form', { name: uploadFormName });
    await form
      .getByLabel('Jobsite photo')
      .setInputFiles({ name: internal, mimeType: 'image/png', buffer: bytes });
    await form.getByRole('button', { name: 'Upload photo' }).click();
    await expect(page.getByText(internal, { exact: true }).first()).toBeVisible();

    const jobsPath = '/portal/contractor/jobs';
    const portalPath = jobsPath + '/' + fixture.projectId + '/media';
    await contractor.getByRole('link', { name: 'Assigned contractor jobs' }).click();
    await expect(contractor).toHaveURL(new RegExp(jobsPath + '$'));
    const assignedJobs = contractor.getByRole('list', { name: 'Assigned contractor jobs' });
    await assignedJobs.locator('a[href="' + portalPath + '"]').click();
    await expect(contractor).toHaveURL(new RegExp(portalPath + '$'));
    const main = contractor.getByRole('main');
    await expect(main.getByText('Summit Ridge Roofing')).toBeVisible();
    await expect(main.getByText('Job reference ' + fixture.projectId)).toBeVisible();
    const tasks = main.getByRole('region', { name: 'Assigned tasks' });
    await expect(tasks.getByText(task.title)).toBeVisible();
    await expect(tasks.getByText('Awaiting inspection')).toBeVisible();
    await expect(tasks.getByText('Evidence revision 1')).toBeVisible();
    await expect(main.getByText(internal)).toHaveCount(0);
    await expect(main.getByText('Private note in the internal evidence record.')).toHaveCount(0);

    const download = main.getByRole('link', { name: 'Download ' + filename });
    const href = await download.getAttribute('href');
    if (!href) throw new Error('The contractor download endpoint is missing.');
    const original = await contractor.request.get(href);
    expect(original.status()).toBe(200);
    expect(await original.body()).toEqual(bytes);
    await main.getByRole('link', { name: 'Assigned jobs' }).click();
    await expect(assignedJobs.locator('a[href="' + portalPath + '"]')).toBeVisible();
    await assign(false, 1);
    await contractor.goto(portalPath);
    await expect(main.getByText('This contractor media workspace is unavailable.')).toBeVisible();
    await expect(main.getByText(filename)).toHaveCount(0);
    expect((await contractor.request.get(href)).status()).toBe(404);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await fixture.restore(page);
  }
});
