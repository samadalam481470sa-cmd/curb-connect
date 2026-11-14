/**
 * Tap refinement for photo measurement. A finger tap lands several pixels away from the real
 * corner or edge. These helpers look in a small window around the tap and move the point onto
 * the strongest nearby corner (for the reference rectangle) or edge (for the curb line), with
 * sub-pixel refinement. If nothing clear is nearby, the tap is kept as-is.
 */
import type { Point2 } from './cameraMeasureMath';

export interface GrayImage {
  width: number;
  height: number;
  /** Luminance 0..1, row-major. */
  gray: Float32Array;
}

export interface SnapResult {
  point: Point2;
  snapped: boolean;
  /** Distance moved, in image pixels. */
  movedPx: number;
}

/** Converts RGBA pixels (canvas ImageData) to luminance. */
export function toGray(image: {
  width: number;
  height: number;
  data: ArrayLike<number>;
}): GrayImage {
  const { width, height, data } = image;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (0.2126 * data[p]! + 0.7152 * data[p + 1]! + 0.0722 * data[p + 2]!) / 255;
  }
  return { width, height, gray };
}

function window(img: GrayImage, cx: number, cy: number, radius: number, margin: number) {
  const x0 = Math.max(1, Math.floor(cx - radius - margin));
  const y0 = Math.max(1, Math.floor(cy - radius - margin));
  const x1 = Math.min(img.width - 2, Math.ceil(cx + radius + margin));
  const y1 = Math.min(img.height - 2, Math.ceil(cy + radius + margin));
  return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Sobel gradients for a rectangular region. */
function gradients(img: GrayImage, r: ReturnType<typeof window>) {
  const gx = new Float32Array(r.w * r.h);
  const gy = new Float32Array(r.w * r.h);
  const g = img.gray;
  const W = img.width;
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      const i = y * W + x;
      const tl = g[i - W - 1]!,
        tc = g[i - W]!,
        tr = g[i - W + 1]!;
      const ml = g[i - 1]!,
        mr = g[i + 1]!;
      const bl = g[i + W - 1]!,
        bc = g[i + W]!,
        br = g[i + W + 1]!;
      const k = (y - r.y0) * r.w + (x - r.x0);
      gx[k] = tr + 2 * mr + br - tl - 2 * ml - bl;
      gy[k] = bl + 2 * bc + br - tl - 2 * tc - tr;
    }
  }
  return { gx, gy };
}

/** Parabolic sub-pixel offset of a peak from three samples. */
function subpixel(left: number, mid: number, right: number): number {
  const denom = left - 2 * mid + right;
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-12) return 0;
  const off = (0.5 * (left - right)) / denom;
  return Math.max(-0.5, Math.min(0.5, off));
}

function finish(img: GrayImage, start: Point2, px: number, py: number): SnapResult {
  const point = { x: (px + 0.5) / img.width, y: (py + 0.5) / img.height };
  const movedPx = Math.hypot(px + 0.5 - start.x * img.width, py + 0.5 - start.y * img.height);
  return { point, snapped: true, movedPx };
}

const keep = (point: Point2): SnapResult => ({ point, snapped: false, movedPx: 0 });

/**
 * Moves a tap onto the strongest corner (Harris response) within `radiusPx` image pixels.
 * Used for the four corners of the reference rectangle.
 */
export function snapToCorner(img: GrayImage, tap: Point2, radiusPx: number): SnapResult {
  if (img.width < 8 || img.height < 8) return keep(tap);
  const cx = tap.x * img.width - 0.5;
  const cy = tap.y * img.height - 0.5;
  const half = 2; // 5×5 structure-tensor window
  const r = window(img, cx, cy, radiusPx, half + 1);
  if (r.w < 5 || r.h < 5) return keep(tap);
  const { gx, gy } = gradients(img, r);
  const resp = new Float32Array(r.w * r.h).fill(-Infinity);
  let best = -Infinity,
    bx = -1,
    by = -1,
    maxEdge = 0;
  for (let y = half; y < r.h - half; y++) {
    for (let x = half; x < r.w - half; x++) {
      let sxx = 0,
        syy = 0,
        sxy = 0;
      for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
          const k = (y + dy) * r.w + (x + dx);
          const a = gx[k]!,
            b = gy[k]!;
          sxx += a * a;
          syy += b * b;
          sxy += a * b;
        }
      }
      const det = sxx * syy - sxy * sxy;
      const tr = sxx + syy;
      const R = det - 0.04 * tr * tr;
      const k = y * r.w + x;
      resp[k] = R;
      maxEdge = Math.max(maxEdge, tr);
      const ix = r.x0 + x,
        iy = r.y0 + y;
      const d = Math.hypot(ix - cx, iy - cy);
      if (d > radiusPx) continue;
      // Prefer corners near the tap when two are similar.
      const score = R * (1 - 0.35 * (d / radiusPx));
      if (score > best) {
        best = score;
        bx = x;
        by = y;
      }
    }
  }
  // A real corner of a contrasting sheet gives a clear positive response.
  if (bx < 0 || best <= 0.02 || best < 0.0025 * maxEdge * maxEdge) return keep(tap);
  // Harris peaks sit a pixel or two inside the true corner. Refine with the gradient-orthogonality
  // method (Förstner / cornerSubPix): the corner q is where every nearby gradient g_i is
  // perpendicular to (q - p_i). Solve sum(g g^T) q = sum(g g^T p) a few times.
  let qx = bx,
    qy = by;
  const win = 5;
  for (let iter = 0; iter < 6; iter++) {
    let a = 0,
      b = 0,
      c = 0,
      bxSum = 0,
      bySum = 0;
    const x0 = Math.max(0, Math.round(qx) - win),
      x1 = Math.min(r.w - 1, Math.round(qx) + win);
    const y0 = Math.max(0, Math.round(qy) - win),
      y1 = Math.min(r.h - 1, Math.round(qy) + win);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = y * r.w + x;
        const u = gx[k]!,
          v = gy[k]!;
        const wgt = Math.exp(-((x - qx) ** 2 + (y - qy) ** 2) / (2 * 3 * 3));
        const uu = u * u * wgt,
          uv = u * v * wgt,
          vv = v * v * wgt;
        a += uu;
        b += uv;
        c += vv;
        bxSum += uu * x + uv * y;
        bySum += uv * x + vv * y;
      }
    }
    const det = a * c - b * b;
    if (!(Math.abs(det) > 1e-9)) break;
    const nx = (c * bxSum - b * bySum) / det;
    const ny = (a * bySum - b * bxSum) / det;
    if (!Number.isFinite(nx) || !Number.isFinite(ny) || Math.hypot(nx - bx, ny - by) > 4) break;
    const step = Math.hypot(nx - qx, ny - qy);
    qx = nx;
    qy = ny;
    if (step < 0.01) break;
  }
  return finish(img, tap, r.x0 + qx, r.y0 + qy);
}

/**
 * Moves a tap onto the strongest nearby edge (Sobel magnitude), refined across the edge to
 * sub-pixel accuracy. Used for curb line points.
 */
export function snapToEdge(img: GrayImage, tap: Point2, radiusPx: number): SnapResult {
  if (img.width < 4 || img.height < 4) return keep(tap);
  const cx = tap.x * img.width - 0.5;
  const cy = tap.y * img.height - 0.5;
  const r = window(img, cx, cy, radiusPx, 1);
  if (r.w < 3 || r.h < 3) return keep(tap);
  const { gx, gy } = gradients(img, r);
  const mag = new Float32Array(r.w * r.h);
  const values: number[] = [];
  for (let k = 0; k < mag.length; k++) {
    mag[k] = Math.hypot(gx[k]!, gy[k]!);
    values.push(mag[k]!);
  }
  values.sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)] ?? 0;
  let best = -Infinity,
    bx = -1,
    by = -1;
  for (let y = 1; y < r.h - 1; y++) {
    for (let x = 1; x < r.w - 1; x++) {
      const ix = r.x0 + x,
        iy = r.y0 + y;
      const d = Math.hypot(ix - cx, iy - cy);
      if (d > radiusPx) continue;
      const score = mag[y * r.w + x]! * (1 - 0.5 * (d / radiusPx));
      if (score > best) {
        best = score;
        bx = x;
        by = y;
      }
    }
  }
  const peak = bx >= 0 ? mag[by * r.w + bx]! : 0;
  // Needs a visible edge (contrast step of about 10% or more) that stands out from the texture.
  if (bx < 0 || peak < 0.4 || peak < 3 * median) return keep(tap);
  // Move the tap straight across the edge only (along the edge normal). Sliding it along the
  // edge would change where a curb segment starts or ends, and so change the measured length.
  const k = by * r.w + bx;
  const nx = gx[k]! / Math.max(1e-9, Math.hypot(gx[k]!, gy[k]!));
  const ny = gy[k]! / Math.max(1e-9, Math.hypot(gx[k]!, gy[k]!));
  const tx = cx - r.x0,
    ty = cy - r.y0; // tap in window coordinates
  const sample = (t: number) => {
    // Bilinear sample of the gradient magnitude along the normal through the tap.
    const sx = tx + nx * t,
      sy = ty + ny * t;
    const x0 = Math.floor(sx),
      y0 = Math.floor(sy);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= r.w || y0 + 1 >= r.h) return 0;
    const fx = sx - x0,
      fy = sy - y0;
    const m = (x: number, y: number) => mag[y * r.w + x]!;
    return (
      m(x0, y0) * (1 - fx) * (1 - fy) +
      m(x0 + 1, y0) * fx * (1 - fy) +
      m(x0, y0 + 1) * (1 - fx) * fy +
      m(x0 + 1, y0 + 1) * fx * fy
    );
  };
  let bestT = 0,
    bestM = -Infinity;
  const limit = Math.ceil(radiusPx);
  for (let t = -limit; t <= limit; t++) {
    const v = sample(t) * (1 - 0.3 * (Math.abs(t) / limit));
    if (v > bestM) {
      bestM = v;
      bestT = t;
    }
  }
  if (sample(bestT) < Math.max(0.4, 3 * median)) return keep(tap);
  const off = subpixel(sample(bestT - 1), sample(bestT), sample(bestT + 1));
  const t = bestT + off;
  return finish(img, tap, r.x0 + tx + nx * t, r.y0 + ty + ny * t);
}
