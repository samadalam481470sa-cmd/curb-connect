import { describe, expect, it } from 'vitest';
import {
  assessMeasurement,
  measureCurbInPhoto,
  REFERENCE_PRESETS,
  type Point2,
} from './cameraMeasureMath';

/**
 * Simulated pinhole phone camera looking down at flat ground. World points are on the ground
 * plane (z = 0), in feet. Returns normalized image coordinates (0..1) for a 4:3 sensor.
 */
function camera(opts: {
  heightFt: number;
  pitchDeg: number;
  yawDeg: number;
  xFt: number;
  yFt: number;
  fov: number;
}) {
  const pitch = (opts.pitchDeg * Math.PI) / 180;
  const yaw = (opts.yawDeg * Math.PI) / 180;
  const f = 0.5 / Math.tan(((opts.fov / 2) * Math.PI) / 180);
  return (X: number, Y: number): Point2 => {
    // Translate to camera position, then rotate by yaw (about z) and pitch (about camera x).
    const dx = X - opts.xFt,
      dy = Y - opts.yFt,
      dz = -opts.heightFt;
    const rx = Math.cos(yaw) * dx + Math.sin(yaw) * dy;
    const ry = -Math.sin(yaw) * dx + Math.cos(yaw) * dy; // forward
    // Camera forward axis tilted down by `pitch`.
    const forward = Math.cos(pitch) * ry - Math.sin(pitch) * dz;
    const down = Math.sin(pitch) * ry + Math.cos(pitch) * dz;
    if (forward <= 0) throw new Error('behind camera');
    return { x: 0.5 + (f * rx) / forward, y: 0.5 - ((f * down) / forward) * (4 / 3) };
  };
}

const views = [
  {
    name: 'standing, looking down 45°',
    heightFt: 5,
    pitchDeg: 45,
    yawDeg: 0,
    xFt: 1,
    yFt: -4,
    fov: 70,
  },
  {
    name: 'standing, shallow 30° angle',
    heightFt: 5.5,
    pitchDeg: 30,
    yawDeg: 8,
    xFt: 1.5,
    yFt: -7,
    fov: 75,
  },
  {
    name: 'high, 60° and rotated',
    heightFt: 7,
    pitchDeg: 60,
    yawDeg: -20,
    xFt: 1.5,
    yFt: -1,
    fov: 80,
  },
  {
    name: 'wide lens from the side',
    heightFt: 5,
    pitchDeg: 40,
    yawDeg: 20,
    xFt: 0.5,
    yFt: -6.5,
    fov: 90,
  },
];

describe('perspective-correct length on simulated phone photos', () => {
  for (const view of views) {
    it(`measures a 10.00 ft bent curb within 0.5% (${view.name})`, () => {
      const project = camera(view);
      const ref = [
        [0, 0],
        [8.5 / 12, 0],
        [8.5 / 12, 11 / 12],
        [0, 11 / 12],
      ].map(([x, y]) => project(x!, y!));
      // Curb path 6 ft straight then 4 ft at a right angle: total 10 ft.
      const curb = [
        [-1, 2],
        [5, 2],
        [5, 6],
      ].map(([x, y]) => project(x!, y!));
      for (const p of [...ref, ...curb]) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
      const m = measureCurbInPhoto(ref, 8.5, 11, curb);
      expect(m.lengthFt).toBeGreaterThan(9.95);
      expect(m.lengthFt).toBeLessThan(10.05);
      expect(m.segmentsFt[0]).toBeCloseTo(6, 2);
      expect(m.segmentsFt[1]).toBeCloseTo(4, 2);
    });
  }

  it('gives the same length when corners are marked counter-clockwise', () => {
    const project = camera(views[0]!);
    const cw = [
      [0, 0],
      [8.5 / 12, 0],
      [8.5 / 12, 11 / 12],
      [0, 11 / 12],
    ].map(([x, y]) => project(x!, y!));
    const ccw = [cw[0]!, cw[3]!, cw[2]!, cw[1]!];
    const curb = [
      [-1, 2],
      [5, 2],
    ].map(([x, y]) => project(x!, y!));
    expect(measureCurbInPhoto(ccw, 11, 8.5, curb).lengthFt).toBeCloseTo(6, 3);
  });

  it('the accuracy range contains the true length when taps are off by a few pixels', () => {
    // Tabloid sheet (11 x 17 in), points snapped to about 1 px.
    const project = camera(views[0]!);
    const ref = [
      [0, 0],
      [11 / 12, 0],
      [11 / 12, 17 / 12],
      [0, 17 / 12],
    ].map(([x, y]) => project(x!, y!));
    const curb = [
      [-1, 2],
      [5, 2],
      [5, 6],
    ].map(([x, y]) => project(x!, y!));
    const opts = { cornerErrorPx: [1, 1, 1, 1], pathErrorPx: [1, 1, 1] };
    const q = assessMeasurement(ref, 11, 17, curb, { widthPx: 1920, heightPx: 1440 }, opts);
    expect(q.lowFt).toBeLessThanOrEqual(10);
    expect(q.highFt).toBeGreaterThanOrEqual(10);
    expect(q.plusMinusFt).toBeGreaterThan(0);
    expect(q.plusMinusFt).toBeLessThan(1);
  });

  it('reports a wider range for rough finger taps than for snapped points', () => {
    const project = camera(views[0]!);
    const ref = [
      [0, 0],
      [8.5 / 12, 0],
      [8.5 / 12, 11 / 12],
      [0, 11 / 12],
    ].map(([x, y]) => project(x!, y!));
    const curb = [
      [-1, 2],
      [5, 2],
    ].map(([x, y]) => project(x!, y!));
    const img = { widthPx: 1920, heightPx: 1440 };
    const snapped = assessMeasurement(ref, 8.5, 11, curb, img, { tapErrorPx: 1 });
    const rough = assessMeasurement(ref, 8.5, 11, curb, img, { tapErrorPx: 6 });
    expect(rough.plusMinusFt).toBeGreaterThan(snapped.plusMinusFt * 2);
  });

  it('is deterministic for the same taps', () => {
    const project = camera(views[0]!);
    const ref = [
      [0, 0],
      [8.5 / 12, 0],
      [8.5 / 12, 11 / 12],
      [0, 11 / 12],
    ].map(([x, y]) => project(x!, y!));
    const curb = [
      [0, 2],
      [6, 2],
    ].map(([x, y]) => project(x!, y!));
    const a = assessMeasurement(ref, 8.5, 11, curb, { widthPx: 1920, heightPx: 1440 });
    const b = assessMeasurement(ref, 8.5, 11, curb, { widthPx: 1920, heightPx: 1440 });
    expect(a).toEqual(b);
  });

  it('a larger reference gives a tighter range than a small one', () => {
    const project = camera(views[0]!);
    const sheet = (w: number, h: number) =>
      [
        [0, 0],
        [w / 12, 0],
        [w / 12, h / 12],
        [0, h / 12],
      ].map(([x, y]) => project(x!, y!));
    const curb = [
      [-1, 3],
      [5, 3],
    ].map(([x, y]) => project(x!, y!));
    const small = assessMeasurement(sheet(3.37, 2.125), 3.37, 2.125, curb, {
      widthPx: 1920,
      heightPx: 1440,
    });
    const big = assessMeasurement(sheet(48, 96), 48, 96, curb, { widthPx: 1920, heightPx: 1440 });
    expect(big.plusMinusFt).toBeLessThan(small.plusMinusFt);
  });

  it('warns when the curb reaches far beyond a tiny reference', () => {
    const project = camera({ heightFt: 5, pitchDeg: 35, yawDeg: 0, xFt: 0, yFt: -3, fov: 75 });
    const ref = [
      [0, 0],
      [3.37 / 12, 0],
      [3.37 / 12, 2.125 / 12],
      [0, 2.125 / 12],
    ].map(([x, y]) => project(x!, y!));
    const curb = [
      [-3, 4],
      [3, 6],
    ].map(([x, y]) => project(x!, y!));
    const q = assessMeasurement(ref, 3.37, 2.125, curb, { widthPx: 1920, heightPx: 1440 });
    expect(q.extrapolation).toBeGreaterThan(12);
    expect(q.warnings.join(' ')).toMatch(/beyond the reference|small in the photo|wider than 5%/);
  });

  it('has reference presets with sane dimensions', () => {
    for (const p of REFERENCE_PRESETS) {
      expect(p.widthIn).toBeGreaterThan(0);
      expect(p.heightIn).toBeLessThanOrEqual(240);
    }
  });
});
