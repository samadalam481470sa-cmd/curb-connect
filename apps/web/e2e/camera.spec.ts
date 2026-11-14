import { expect, test, type Page } from '@playwright/test';
import type * as EdgeSnap from '../src/features/curb/edgeSnap';

/**
 * Camera Measure across devices (run with playwright.camera.config.ts). Uses Chrome's fake
 * camera for the live path and synthetic perspective photos with a known true length for the
 * measuring path.
 */

type Pt = { x: number; y: number };

/** Draws a ground-plane scene through a pinhole camera and returns a PNG plus true points. */
async function makeScene(
  page: Page,
  opts: {
    refIn: [number, number];
    refAt?: [number, number];
    view: { h: number; pitch: number; yaw: number; cx: number; cy: number; fov: number };
    seed: number;
  },
) {
  return page.evaluate(({ refIn, refAt, view, seed }) => {
    const W = 1600,
      H = 1200;
    const pitch = (view.pitch * Math.PI) / 180,
      yaw = (view.yaw * Math.PI) / 180;
    const f = 0.5 / Math.tan(((view.fov / 2) * Math.PI) / 180);
    const project = (X: number, Y: number) => {
      const dx = X - view.cx,
        dy = Y - view.cy,
        dz = -view.h;
      const rx = Math.cos(yaw) * dx + Math.sin(yaw) * dy;
      const ry = -Math.sin(yaw) * dx + Math.cos(yaw) * dy;
      const fw = Math.cos(pitch) * ry - Math.sin(pitch) * dz;
      const dn = Math.sin(pitch) * ry + Math.cos(pitch) * dz;
      return { x: 0.5 + (f * rx) / fw, y: 0.5 - ((f * dn) / fw) * (W / H) };
    };
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d')!;
    // Asphalt-like noisy ground.
    let s = seed;
    const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const img = g.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const v = 70 + rand() * 30;
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v + 4;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const poly = (pts: [number, number][], fill: string) => {
      g.beginPath();
      pts.forEach(([X, Y], i) => {
        const p = project(X, Y);
        if (i === 0) g.moveTo(p.x * W, p.y * H);
        else g.lineTo(p.x * W, p.y * H);
      });
      g.closePath();
      g.fillStyle = fill;
      g.fill();
    };
    // Concrete curb region: X ≤ 5 and 2 ≤ Y ≤ 9, so its edges are Y = 2 and X = 5.
    poly(
      [
        [-6, 2],
        [5, 2],
        [5, 9],
        [-6, 9],
      ],
      '#b9b6ad',
    );
    const [w, h] = refIn;
    const [ox, oy] = refAt ?? [0, 0];
    const ref: [number, number][] = [
      [ox, oy],
      [ox + w / 12, oy],
      [ox + w / 12, oy + h / 12],
      [ox, oy + h / 12],
    ];
    poly(ref, '#f4f4f0');
    const curbWorld: [number, number][] = [
      [-1, 2],
      [5, 2],
      [5, 6],
    ];
    return {
      png: c.toDataURL('image/png'),
      corners: ref.map(([X, Y]) => project(X, Y)),
      curb: curbWorld.map(([X, Y]) => project(X, Y)),
      trueFt: 10,
    };
  }, opts);
}

async function tapAt(page: Page, _box: unknown, p: Pt, off: Pt, touch: boolean) {
  // Scroll the target into view (tall photos can extend past the screen), then re-read the box.
  let box = (await page.getByTestId('camera-photo').boundingBox())!;
  const vh = page.viewportSize()!.height;
  const targetY = box.y + p.y * box.height + off.y;
  if (targetY < 40 || targetY > vh - 40) {
    await page.evaluate((dy) => window.scrollBy(0, dy), targetY - vh / 2);
    box = (await page.getByTestId('camera-photo').boundingBox())!;
  }
  const x = box.x + p.x * box.width + off.x;
  const y = box.y + p.y * box.height + off.y;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

async function loadPhoto(page: Page, png: string) {
  const buffer = Buffer.from(png.split(',')[1]!, 'base64');
  await page
    .getByLabel('Take or choose a curb photo')
    .setInputFiles({ name: 'curb.png', mimeType: 'image/png', buffer });
  const surface = page.getByTestId('camera-photo');
  await expect(surface).toBeVisible();
  await surface.scrollIntoViewIfNeeded();
  // Wait for the image to lay out before reading its box.
  await expect.poll(async () => (await surface.boundingBox())?.height ?? 0).toBeGreaterThan(50);
  return (await surface.boundingBox())!;
}

const readFeet = async (page: Page) => {
  const text = (await page.getByTestId('camera-result').locator('strong').textContent()) ?? '';
  return Number(text.replace(/[^\d.]/g, ''));
};
const readRange = async (page: Page) => {
  const text = (await page.getByTestId('camera-accuracy').textContent()) ?? '';
  const m = /([\d.]+)–([\d.]+) ft/.exec(text)!;
  return [Number(m[1]), Number(m[2])] as const;
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open camera' })).toBeVisible();
});

test('layout fits the screen and buttons are tappable', async ({ page }) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  for (const name of ['Open camera', 'Take Photo / Choose Image']) {
    const box = await page.getByRole('button', { name }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(32);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
});

test('live camera opens, shows video, captures a frame and releases the camera', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Open camera' }).click();
  const video = page.getByLabel('Live rear camera preview');
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Capture frame' }).click();
  await expect(page.getByTestId('camera-photo')).toBeVisible();
  await expect(video).toHaveCount(0);
  const live = await page.evaluate(() =>
    [...document.querySelectorAll('video')].some(
      (v) => (v.srcObject as MediaStream | null)?.active,
    ),
  );
  expect(live).toBe(false);
});

test('camera can be closed and reopened', async ({ page }) => {
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Open camera' }).click();
    await expect(page.getByLabel('Live rear camera preview')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByLabel('Live rear camera preview')).toHaveCount(0);
  }
});

test('AR panel shows the right option for this device', async ({ page }, info) => {
  const ua = await page.evaluate(() => navigator.userAgent);
  if (/\biPhone\b/.test(ua)) {
    await expect(page.getByRole('button', { name: 'Native iPhone app required' })).toBeVisible();
  } else {
    await expect(
      page.getByText(/WebXR surface hit testing is unsupported|Start supported AR scan/).first(),
    ).toBeVisible();
  }
  info.annotations.push({ type: 'ua', description: ua });
});

const scenes = [
  {
    name: 'letter sheet, standing 45°',
    refIn: [8.5, 11] as [number, number],
    view: { h: 5, pitch: 45, yaw: 0, cx: 1, cy: -4, fov: 70 },
    tol: 0.05,
  },
  {
    name: 'tabloid sheet, rotated 30°',
    refIn: [11, 17] as [number, number],
    view: { h: 5.5, pitch: 38, yaw: 12, cx: 1.5, cy: -5.5, fov: 75 },
    tol: 0.04,
  },
  // 8 ft × 4 ft sheet lying on the asphalt in front of the curb (marked as 96 × 48 in).
  {
    name: 'plywood sheet, wide lens',
    refIn: [96, 48] as [number, number],
    refAt: [-5, -3] as [number, number],
    view: { h: 7, pitch: 42, yaw: -5, cx: 0.5, cy: -10, fov: 80 },
    tol: 0.03,
  },
];

for (const scene of scenes) {
  test(`measures a 10 ft curb from a perspective photo with rough taps (${scene.name})`, async ({
    page,
  }, info) => {
    const touch = Boolean(info.project.use.hasTouch);
    const data = await makeScene(page, {
      refIn: scene.refIn,
      refAt: scene.refAt,
      view: scene.view,
      seed: 11,
    });
    for (const p of [...data.corners, ...data.curb]) {
      expect(p.x).toBeGreaterThan(0.02);
      expect(p.x).toBeLessThan(0.98);
      expect(p.y).toBeGreaterThan(0.02);
      expect(p.y).toBeLessThan(0.98);
    }
    const box = await loadPhoto(page, data.png);
    // Pick the reference preset matching the sheet.
    const preset = scene.refIn[0] === 8.5 ? 'letter' : scene.refIn[0] === 11 ? 'tabloid' : 'osb';
    await page.getByLabel('Reference object').selectOption(preset);
    // The plywood is marked long side first, so swap the preset's 48 × 96 to 96 × 48.
    if (preset === 'osb') await page.getByRole('button', { name: 'Swap width/height' }).click();
    // Finger-like misses of 4–6 CSS px in varying directions.
    const offs: Pt[] = [
      { x: 5, y: -4 },
      { x: -4, y: 5 },
      { x: -5, y: -5 },
      { x: 4, y: 4 },
    ];
    for (let i = 0; i < 4; i++) await tapAt(page, box, data.corners[i]!, offs[i]!, touch);
    await expect(page.getByText('2. Curb path (0 points)')).toBeVisible();
    // Curb points: off the edge across it, but not at the inside corner direction.
    // Misses of 5 CSS px straight across the curb line (the part of a miss snapping can fix).
    const across = (a: Pt, b: Pt): Pt => {
      const dx = (b.x - a.x) * box.width,
        dy = (b.y - a.y) * box.height;
      const len = Math.hypot(dx, dy);
      return { x: (-dy / len) * 5, y: (dx / len) * 5 };
    };
    const curbOffs: Pt[] = [
      across(data.curb[0]!, data.curb[1]!),
      { x: 0, y: 0 },
      across(data.curb[1]!, data.curb[2]!),
    ];
    for (let i = 0; i < 3; i++) await tapAt(page, box, data.curb[i]!, curbOffs[i]!, touch);
    await expect(page.getByTestId('camera-result')).toBeVisible();
    const feet = await readFeet(page);
    const [low, high] = await readRange(page);
    const marks = await page.locator('[data-testid="camera-photo"] svg circle').evaluateAll((cs) =>
      cs.map((c) => ({
        x: Number(c.getAttribute('cx')) / 1000,
        y: Number(c.getAttribute('cy')) / 1000,
      })),
    );
    const errPx = marks.map((m, i) => {
      const t = [...data.corners, ...data.curb][i]!;
      return Math.round(Math.hypot((m.x - t.x) * 1600, (m.y - t.y) * 1200) * 10) / 10;
    });
    info.annotations.push({
      type: 'measured',
      description: `${feet} ft (range ${low}–${high}); point error px ${errPx.join(',')}`,
    });
    expect(Math.abs(feet - data.trueFt) / data.trueFt).toBeLessThan(scene.tol);
    // The reported range should contain the truth (small rounding slack).
    expect(low).toBeLessThanOrEqual(data.trueFt + 0.05);
    expect(high).toBeGreaterThanOrEqual(data.trueFt - 0.05);
    await page.getByRole('button', { name: 'Use length in curb estimate' }).click();
    await expect(page.getByTestId('applied')).toHaveText(String(Number(feet.toFixed(2))));
  });
}

test('dragging a point with the magnifier changes the length', async ({ page }) => {
  const data = await makeScene(page, { refIn: [11, 17], view: scenes[1]!.view, seed: 5 });
  const box = await loadPhoto(page, data.png);
  await page.getByLabel('Reference object').selectOption('tabloid');
  await page.getByRole('button', { name: 'Auto-snap on' }).click();
  for (const p of data.corners) await tapAt(page, box, p, { x: 0, y: 0 }, false);
  await tapAt(page, box, data.curb[0]!, { x: 0, y: 0 }, false);
  await tapAt(page, box, data.curb[1]!, { x: 0, y: 0 }, false);
  const before = await readFeet(page);
  let box2 = (await page.getByTestId('camera-photo').boundingBox())!;
  const ty = box2.y + data.curb[1]!.y * box2.height;
  await page.evaluate((dy) => window.scrollBy(0, dy), ty - page.viewportSize()!.height / 2);
  box2 = (await page.getByTestId('camera-photo').boundingBox())!;
  const start = {
    x: box2.x + data.curb[1]!.x * box2.width,
    y: box2.y + data.curb[1]!.y * box2.height,
  };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 40, start.y, { steps: 5 });
  await expect(page.locator('.cc-camera-loupe')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.cc-camera-loupe')).toHaveCount(0);
  await expect(page.getByText('2. Curb path (2 points)')).toBeVisible();
  expect(await readFeet(page)).toBeLessThan(before);
});

test('edge snapping moves a tap across the curb line, never along it', async ({ page }) => {
  const data = await makeScene(page, { refIn: [8.5, 11], view: scenes[0]!.view, seed: 3 });
  const result = await page.evaluate(
    async ({ png, curb }) => {
      const img = new Image();
      img.src = png;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const api = (window as unknown as { __curbSnap: typeof EdgeSnap }).__curbSnap;
      const gray = api.toGray(g.getImageData(0, 0, c.width, c.height));
      const t = curb[0]!;
      const errs: number[] = [];
      for (const off of [-20, -12, -6, 6, 12, 20]) {
        const o = api.snapToEdge(gray, { x: t.x, y: t.y + off / c.height }, 30);
        errs.push(Math.hypot((o.point.x - t.x) * c.width, (o.point.y - t.y) * c.height));
      }
      return errs;
    },
    { png: data.png, curb: data.curb },
  );
  for (const e of result) expect(e).toBeLessThan(2);
});
