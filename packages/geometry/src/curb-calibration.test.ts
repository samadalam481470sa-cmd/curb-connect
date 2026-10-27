import { describe, expect, it } from 'vitest';
import {
  arcDeviation,
  arcLength,
  arcSegmentCount,
  arcToPolyline,
  calibrateHomography,
  calibrateReferenceScale,
  type Calibration,
  curbLengths,
  fromSI,
  GeometryError,
  imageToPlane,
  measureLength,
  type Point,
  polylineLength,
  solveLinear,
  toSI,
  validateCurbSegments,
} from './index';

describe('curb segments (CV-047, CP-051)', () => {
  it('10-ft and 25-ft straight cuts', () => {
    const s10 = {
      id: 's10',
      kind: 'straight' as const,
      points: [
        { x: 0, y: 0 },
        { x: toSI(10, 'ft'), y: 0 },
      ],
    };
    const s25 = {
      id: 's25',
      kind: 'straight' as const,
      points: [
        { x: 0, y: 5 },
        { x: toSI(25, 'ft'), y: 5 },
      ],
    };
    const r = curbLengths([s10, s25]);
    expect(fromSI(r.total, 'ft')).toBeCloseTo(35, 12);
    expect(r.segmentCount).toBe(2);
    expect(fromSI(r.byKind.straight, 'ft')).toBeCloseTo(35, 12);
  });
  it('corner geometry measures both legs, not the diagonal', () => {
    const corner = {
      id: 'c',
      kind: 'corner' as const,
      points: [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 4 },
      ],
    };
    const r = curbLengths([corner]);
    expect(r.total).toBe(7);
    expect(r.segments[0]!.chordLength).toBe(5);
  });
  it('curved curbs: piecewise length converges to the arc, never the chord', () => {
    const arc = { center: { x: 0, y: 0 }, radius: 10, startAngle: 0, sweep: Math.PI / 2 };
    const pts = arcToPolyline(arc, 0.005);
    expect(arcDeviation(pts, arc)).toBeLessThanOrEqual(0.005 + 1e-12);
    const len = polylineLength(pts);
    expect(len).toBeLessThan(arcLength(arc));
    expect((arcLength(arc) - len) / arcLength(arc)).toBeLessThan(1e-3);
    const r = curbLengths([{ id: 'k', kind: 'curved', points: pts, arc }]);
    expect(r.total).toBeGreaterThan(r.segments[0]!.chordLength * 1.1);
    expect(arcSegmentCount(arc, 100)).toBe(2);
    expect(arcSegmentCount({ ...arc, sweep: -Math.PI }, 0.01)).toBeGreaterThan(10);
    expect(() => arcSegmentCount({ ...arc, radius: 0 }, 1)).toThrow(GeometryError);
    expect(() => arcSegmentCount(arc, 0)).toThrow(GeometryError);
  });
  it('validation issues', () => {
    const arc = { center: { x: 0, y: 0 }, radius: 10, startAngle: 0, sweep: Math.PI / 2 };
    const codes = (segs: Parameters<typeof validateCurbSegments>[0]) =>
      validateCurbSegments(segs).map((i) => i.code);
    expect(
      codes([
        {
          id: 'a',
          kind: 'curved',
          points: [
            { x: 10, y: 0 },
            { x: 0, y: 10 },
          ],
        },
      ]),
    ).toEqual(['chord_only_curve']);
    expect(codes([{ id: 'a', kind: 'curved', points: arcToPolyline(arc, 0.5), arc }])).toEqual([
      'curve_deviation',
    ]);
    expect(codes([{ id: 'a', kind: 'straight', points: [{ x: 0, y: 0 }] }])).toEqual([
      'too_few_points',
    ]);
    expect(
      codes([
        {
          id: 'a',
          kind: 'straight',
          points: [
            { x: 1, y: 1 },
            { x: 1, y: 1 },
          ],
        },
      ]),
    ).toContain('zero_length');
    expect(
      codes([
        {
          id: 'a',
          kind: 'straight',
          points: [
            { x: Number.NaN, y: 1 },
            { x: 1, y: 1 },
          ],
        },
      ]),
    ).toEqual(['non_finite_coordinate']);
    expect(
      codes([
        {
          id: 'a',
          kind: 'straight',
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
            { x: 2, y: 0 },
          ],
        },
      ]),
    ).toContain('self_overlap');
    expect(
      codes([
        {
          id: 'a',
          kind: 'straight',
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
            { x: 5, y: 5 },
            { x: 2, y: -1 },
          ],
        },
      ]),
    ).toContain('self_overlap');
    expect(
      codes([
        {
          id: 'a',
          kind: 'straight',
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
          ],
        },
        {
          id: 'b',
          kind: 'straight',
          points: [
            { x: 4, y: 0 },
            { x: 9, y: 0 },
          ],
        },
      ]),
    ).toEqual(['duplicate_linework']);
    // Touching end to end and crossing are fine.
    expect(
      codes([
        {
          id: 'a',
          kind: 'straight',
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
          ],
        },
        {
          id: 'b',
          kind: 'straight',
          points: [
            { x: 5, y: 0 },
            { x: 9, y: 0 },
          ],
        },
        {
          id: 'c',
          kind: 'straight',
          points: [
            { x: 2, y: -1 },
            { x: 2, y: 1 },
          ],
        },
      ]),
    ).toEqual([]);
    expect(() => curbLengths([{ id: 'a', kind: 'straight', points: [{ x: 0, y: 0 }] }])).toThrow(
      /needs at least 2/,
    );
  });
});

/** Synthetic pinhole-style homography: plane (X,Y) -> image (u,v) for known perspective. */
function project(p: Point): Point {
  // H_true maps plane meters to pixels with perspective.
  const w = 0.0008 * p.x + 0.0015 * p.y + 1;
  return { x: (420 * p.x + 35 * p.y + 100) / w, y: (12 * p.x - 260 * p.y + 900) / w };
}

describe('calibration (CV-045)', () => {
  it('2-point reference scale with uncertainty', () => {
    const c = calibrateReferenceScale({ x: 0, y: 0 }, { x: 300, y: 400 }, 2.5);
    expect(c.status).toBe('valid');
    if (c.status !== 'valid' || c.method !== 'reference_scale') throw new Error('expected scale');
    expect(c.metersPerPixel).toBe(0.005);
    const m = measureLength(c, { x: 0, y: 0 }, { x: 1000, y: 0 });
    expect(m.state).toBe('known');
    if (m.state !== 'known') throw new Error();
    expect(m.value).toBe(5);
    expect(m.sigma).toBeGreaterThan(0);
    expect(m.sigma).toBeLessThan(0.05);
    expect(measureLength(c, { x: 1, y: 1 }, { x: 1, y: 1 })).toMatchObject({
      state: 'known',
      value: 0,
    });
  });
  it('2-point failures: too short, invalid', () => {
    expect(calibrateReferenceScale({ x: 0, y: 0 }, { x: 5, y: 0 }, 1)).toMatchObject({
      status: 'failed',
      reason: 'reference_too_short',
    });
    expect(calibrateReferenceScale({ x: 0, y: 0 }, { x: 500, y: 0 }, 0.01)).toMatchObject({
      reason: 'reference_too_short',
    });
    expect(calibrateReferenceScale({ x: 0, y: 0 }, { x: 500, y: 0 }, 0)).toMatchObject({
      reason: 'invalid_input',
    });
    expect(calibrateReferenceScale({ x: Number.NaN, y: 0 }, { x: 500, y: 0 }, 1)).toMatchObject({
      reason: 'invalid_input',
    });
  });
  it('4-point homography recovers known lengths under perspective', () => {
    const plane = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 2 },
      { x: 0, y: 2 },
    ];
    const image = plane.map(project);
    const c = calibrateHomography(image, plane);
    expect(c.status).toBe('valid');
    if (c.status !== 'valid' || c.method !== 'homography') throw new Error();
    expect(c.reprojectionRms).toBeLessThan(1e-9);
    // Known length: diagonal of a 1 x 1 m square inside the plane.
    const m = measureLength(c, project({ x: 1, y: 0.5 }), project({ x: 2, y: 1.5 }));
    if (m.state !== 'known') throw new Error(m.reason);
    expect(m.value).toBeCloseTo(Math.SQRT2, 9);
    expect(m.sigma).toBeGreaterThan(0.003);
    const q = imageToPlane(c, project({ x: 2.5, y: 1 }))!;
    expect(q.x).toBeCloseTo(2.5, 9);
    expect(q.y).toBeCloseTo(1, 9);
  });
  it('more than 4 points: reprojection error and out-of-plane failure', () => {
    const plane = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 2 },
      { x: 0, y: 2 },
      { x: 1.5, y: 1.2 },
    ];
    const image = plane.map(project);
    const ok = calibrateHomography(
      image.map((p, i) => (i === 4 ? { x: p.x + 0.3, y: p.y } : p)),
      plane,
    );
    expect(ok.status).toBe('valid');
    if (ok.status === 'valid' && ok.method === 'homography')
      expect(ok.reprojectionErrors).toHaveLength(5);
    const lifted = image.map((p, i) => (i === 4 ? { x: p.x + 60, y: p.y - 80 } : p));
    expect(calibrateHomography(lifted, plane)).toMatchObject({
      status: 'failed',
      reason: 'out_of_plane',
    });
  });
  it('degenerate, crossed, short and invalid references fail explicitly', () => {
    const plane = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 2 },
      { x: 0, y: 2 },
    ];
    const image = plane.map(project);
    const collinear = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
    ];
    expect(calibrateHomography(collinear.map(project), collinear)).toMatchObject({
      reason: 'degenerate_reference',
    });
    const crossed = [image[0]!, image[2]!, image[1]!, image[3]!];
    expect(calibrateHomography(crossed, plane)).toMatchObject({
      reason: 'inconsistent_orientation',
    });
    const tiny = plane.map((p) => ({ x: p.x * 0.01, y: p.y * 0.01 }));
    expect(calibrateHomography(tiny.map(project), tiny)).toMatchObject({
      reason: 'reference_too_short',
    });
    expect(calibrateHomography(image.slice(0, 3), plane.slice(0, 3))).toMatchObject({
      reason: 'invalid_input',
    });
  });
  it('never returns a length without a valid calibration', () => {
    const failed: Calibration = {
      status: 'failed',
      method: 'homography',
      reason: 'out_of_plane',
      message: 'x',
    };
    expect(measureLength(failed, { x: 0, y: 0 }, { x: 1, y: 1 })).toEqual({
      state: 'unknown',
      reason: 'calibration failed: out_of_plane',
    });
    expect(imageToPlane(failed, { x: 0, y: 0 })).toBeNull();
    const plane = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 2 },
      { x: 0, y: 2 },
    ];
    const c = calibrateHomography(plane.map(project), plane);
    // A pixel on the far side of the horizon (w <= 0) has no plane position.
    const horizon = { x: 0, y: -1e7 };
    expect(measureLength(c, horizon, { x: 0, y: 0 }).state).toBe('unknown');
  });
  it('linear solver handles singular systems', () => {
    expect(
      solveLinear(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toBeNull();
    expect(
      solveLinear(
        [
          [2, 0],
          [0, 4],
        ],
        [2, 8],
      ),
    ).toEqual([1, 2]);
  });
});
