import { describe, expect, it } from 'vitest';
import { snapToCorner, snapToEdge, toGray, type GrayImage } from './edgeSnap';

/** Renders a scene with anti-aliased edges by supersampling `inside(x, y)`. */
function render(
  w: number,
  h: number,
  inside: (x: number, y: number) => boolean,
  opts: { fg?: number; bg?: number; noise?: number; seed?: number } = {},
): GrayImage {
  const fg = opts.fg ?? 0.95,
    bg = opts.bg ?? 0.25,
    noise = opts.noise ?? 0;
  let s = opts.seed ?? 7;
  const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hit++;
      const v = bg + (fg - bg) * (hit / 16) + (rand() * 2 - 1) * noise;
      gray[y * w + x] = Math.min(1, Math.max(0, v));
    }
  return { width: w, height: h, gray };
}

const W = 200,
  H = 160;
const px = (p: { x: number; y: number }) => ({ x: p.x * W, y: p.y * H });

describe('snapToCorner', () => {
  // Axis-aligned bright sheet with its top-left corner at (60.3, 50.7).
  const sheet = render(W, H, (x, y) => x >= 60.3 && x <= 140.6 && y >= 50.7 && y <= 110.2);

  it('moves an off-target tap onto the true corner within 1 px', () => {
    const tap = { x: 66 / W, y: 45 / H };
    const out = snapToCorner(sheet, tap, 20);
    expect(out.snapped).toBe(true);
    const p = px(out.point);
    expect(Math.hypot(p.x - 60.3, p.y - 50.7)).toBeLessThan(1);
  });

  it('finds each of the four corners', () => {
    const corners = [
      [60.3, 50.7],
      [140.6, 50.7],
      [140.6, 110.2],
      [60.3, 110.2],
    ] as const;
    for (const [cx, cy] of corners) {
      const out = snapToCorner(sheet, { x: (cx + 6) / W, y: (cy - 5) / H }, 18);
      const p = px(out.point);
      expect(Math.hypot(p.x - cx, p.y - cy)).toBeLessThan(1.2);
    }
  });

  it('finds the corner of a rotated, perspective-like quadrilateral', () => {
    const quad = [
      [50, 40],
      [150, 55],
      [140, 125],
      [45, 110],
    ] as const;
    const inside = (x: number, y: number) => {
      let sign = 0;
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = quad[i]!,
          [bx, by] = quad[(i + 1) % 4]!;
        const c = Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax));
        if (c === 0) continue;
        if (sign === 0) sign = c;
        else if (c !== sign) return false;
      }
      return true;
    };
    const img = render(W, H, inside, { noise: 0.02 });
    for (const [cx, cy] of quad) {
      const out = snapToCorner(img, { x: (cx + 5) / W, y: (cy + 4) / H }, 16);
      const p = px(out.point);
      expect(Math.hypot(p.x - cx, p.y - cy)).toBeLessThan(2);
    }
  });

  it('keeps the tap on a flat area with no corner', () => {
    const flat = render(W, H, () => false, { noise: 0.01 });
    const tap = { x: 0.5, y: 0.5 };
    expect(snapToCorner(flat, tap, 20)).toEqual({ point: tap, snapped: false, movedPx: 0 });
  });

  it('keeps the tap along a straight edge with no corner', () => {
    const edge = render(W, H, (x) => x > 100);
    const out = snapToCorner(edge, { x: 103 / W, y: 0.5 }, 15);
    expect(out.snapped).toBe(false);
  });

  it('handles taps at the very edge of the image', () => {
    expect(() => snapToCorner(sheet, { x: 0, y: 0 }, 20)).not.toThrow();
    expect(() => snapToCorner(sheet, { x: 1, y: 1 }, 20)).not.toThrow();
  });
});

describe('snapToEdge', () => {
  it('moves a tap across onto a vertical edge with sub-pixel accuracy', () => {
    const img = render(W, H, (x) => x >= 100.4);
    const out = snapToEdge(img, { x: 107 / W, y: 0.5 }, 15);
    expect(out.snapped).toBe(true);
    expect(Math.abs(px(out.point).x - 100.4)).toBeLessThan(0.6);
  });

  it('works on a diagonal curb line with mild noise', () => {
    // Line y = 0.5x + 30; bright below.
    const img = render(W, H, (x, y) => y > 0.5 * x + 30, { noise: 0.03 });
    const out = snapToEdge(img, { x: 100 / W, y: 86 / H }, 15);
    const p = px(out.point);
    const dist = Math.abs(0.5 * p.x - p.y + 30) / Math.hypot(0.5, 1);
    expect(out.snapped).toBe(true);
    expect(dist).toBeLessThan(1);
  });

  it('keeps the tap when there is only texture and no edge', () => {
    const img = render(W, H, () => false, { noise: 0.04 });
    expect(snapToEdge(img, { x: 0.5, y: 0.5 }, 15).snapped).toBe(false);
  });

  it('ignores edges outside the search radius', () => {
    const img = render(W, H, (x) => x >= 150);
    expect(snapToEdge(img, { x: 0.5, y: 0.5 }, 15).snapped).toBe(false);
  });
});

describe('toGray', () => {
  it('converts RGBA to luminance', () => {
    const g = toGray({ width: 2, height: 1, data: [255, 255, 255, 255, 0, 0, 0, 255] });
    expect(g.gray[0]).toBeCloseTo(1, 5);
    expect(g.gray[1]).toBeCloseTo(0, 5);
  });
});
