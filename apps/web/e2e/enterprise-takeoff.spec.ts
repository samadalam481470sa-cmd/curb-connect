import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { pdfFromPages } from '../../api/test/fixtures/plan-pdf';

test('opens a prior private plan revision, renders the selected sheet, and restores zoom', async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.E2E_ENTERPRISE_DEV !== '1',
    'Requires the seeded local development identity provider.',
  );
  const origin = new URL(baseURL ?? 'http://localhost:3000').origin;
  await page.goto('/v1/auth/login/dev?returnTo=%2Fenterprise%2Ftakeoff');
  const me = await page.request.get('/v1/me');
  expect(me.status()).toBe(200);
  expect((await me.json()).user.email).toBe('demo-roof-owner@example.test');

  const headers = { origin };
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

  async function create(path: string, data: object, revision?: number) {
    const requestHeaders =
      revision === undefined ? headers : { ...headers, 'if-match': '"' + revision + '"' };
    const result = await page.request.post(path, { headers: requestHeaders, data });
    expect(result.status(), await result.text()).toBe(201);
    return result.json();
  }

  try {
    const project = await create('/v1/enterprise/projects', {
      name: 'Takeoff viewer browser fixture ' + randomUUID(),
      originalContractMinor: 10000000,
    });
    const root = '/v1/enterprise/projects/' + project.id;
    const original = await create(root + '/documents', {
      title: 'Original canopy drawings',
      category: 'plans',
      filename: 'issue-a.pdf',
      contentBase64: Buffer.from(
        pdfFromPages([
          { width: 1224, height: 792 },
          { width: 612, height: 792, rotation: 90 },
        ]),
      ).toString('base64'),
      clientRequestId: randomUUID(),
    });
    await create(
      root + '/documents/' + original.documentSetId + '/versions',
      {
        filename: 'issue-b.pdf',
        contentBase64: Buffer.from(pdfFromPages([{ width: 600, height: 600 }])).toString('base64'),
        revisionNote: 'Replacement revision with a different page count.',
        clientRequestId: randomUUID(),
      },
      1,
    );
    await create(root + '/takeoff/plan-sets', {
      title: 'Canopy review drawings',
      revisionLabel: 'Issue A',
      versionIds: [original.id],
      clientRequestId: randomUUID(),
    });

    await page.goto('/enterprise/takeoff');
    await page.getByRole('combobox', { name: /^Commercial project/ }).selectOption(project.id);
    await page.getByRole('button', { name: /^Canopy review drawings/ }).click();
    await page.getByRole('button', { name: 'Open sheet 2' }).click();
    const viewer = page.getByRole('region', { name: 'Plan sheet viewer' });
    await expect(
      viewer.getByText('Issue A · Original canopy drawings · Vault version 1'),
    ).toBeVisible();
    const canvas = viewer.getByRole('img', { name: 'Rendered drawing for sheet 2' });
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    expect(
      await canvas.evaluate((element) => {
        if (!(element instanceof HTMLCanvasElement)) return false;
        const pixels = element
          .getContext('2d')
          ?.getImageData(0, 0, element.width, element.height).data;
        if (!pixels) return false;
        for (let i = 0; i < pixels.length; i += 4) {
          if ((pixels[i] ?? 255) < 245 && (pixels[i + 3] ?? 0) > 0) return true;
        }
        return false;
      }),
    ).toBe(true);

    await viewer.getByRole('button', { name: 'Fit sheet' }).click();
    await viewer.getByRole('button', { name: 'Zoom in' }).click();
    await expect(viewer.getByLabel('View zoom')).toHaveText('125% of fit');
    await expect(canvas).toBeVisible();
    const viewport = viewer.getByLabel('Drawing viewport for sheet 2');
    const scrollKey = await viewport.evaluate((element) =>
      element.scrollHeight > element.clientHeight ? 'ArrowDown' : 'ArrowRight',
    );
    await viewport.press(scrollKey);
    await expect
      .poll(() => viewport.evaluate((element) => Math.max(element.scrollTop, element.scrollLeft)))
      .toBeGreaterThan(0);
    const thumbnails = viewer.getByRole('navigation', { name: 'Sheets in this PDF' });
    await expect(thumbnails.locator('canvas:not([hidden])').first()).toBeVisible();
    const ratio = async () =>
      canvas.evaluate((element) =>
        element instanceof HTMLCanvasElement ? element.width / element.height : 0,
      );
    await expect.poll(ratio).toBeGreaterThan(1);
    await viewer.getByRole('button', { name: 'Rotate clockwise' }).click();
    await expect(canvas).toBeVisible();
    await expect.poll(ratio).toBeLessThan(1);
    await thumbnails.getByRole('button', { name: 'Sheet 1' }).click();
    await expect(viewer.getByRole('img', { name: 'Rendered drawing for sheet 1' })).toBeVisible();
    await viewer.getByRole('button', { name: 'Close sheet' }).click();
    await expect(page.getByRole('button', { name: 'Open sheet 2' })).toBeFocused();
    await page.getByRole('button', { name: 'Open sheet 2' }).click();
    await expect(viewer.getByLabel('View zoom')).toHaveText('125% of fit');
  } finally {
    if (!wasEnabled) {
      await page.request.put('/v1/enterprise/status', { headers, data: { enabled: false } });
    }
  }
});
