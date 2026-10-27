import { describe, expect, it } from 'vitest';
import {
  area,
  centroid,
  convert,
  feetInchesToMeters,
  formatFixed,
  formatQuantity,
  fromSI,
  GeometryError,
  isCounterClockwise,
  isUnit,
  meanLonLat,
  neumaierSum,
  normalizeWinding,
  openRing,
  parseDecimalNumber,
  perimeter,
  pitchDegrees,
  pitchFromDegrees,
  pitchRatio,
  pointInPolygon,
  polygonsOverlap,
  projectRing,
  risePer12,
  roundHalfAwayFromZero,
  signedArea,
  slopedArea,
  slopeFactor,
  tangentPlane,
  toSI,
  trueEdgeLength,
  UNIT_TO_SI,
  validatePolygon,
  cyclic,
  at,
  clamp,
  compareStrings,
  interiorPoint,
  segmentsIntersect,
  GEOMETRY_VERSION,
} from './index';

const close = (a: number, b: number, rel = 1e-12): void => {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(b)));
};

describe('numeric helpers', () => {
  it('exports a semantic version', () => expect(GEOMETRY_VERSION).toMatch(/^\d+\.\d+\.\d+$/));
  it('compensated sum beats naive float addition', () => {
    const values = [1e16, 1, -1e16, 1];
    expect(neumaierSum(values)).toBe(2);
    expect(neumaierSum([0.1, 0.2, 0.3])).toBeCloseTo(0.6, 15);
  });
  it('rounds half away from zero on the decimal representation', () => {
    expect(roundHalfAwayFromZero(1.005, 2)).toBe(1.01);
    expect(roundHalfAwayFromZero(-1.005, 2)).toBe(-1.01);
    expect(roundHalfAwayFromZero(2.5, 0)).toBe(3);
    expect(roundHalfAwayFromZero(1.004999, 2)).toBe(1);
    expect(roundHalfAwayFromZero(0, 2)).toBe(0);
    expect(roundHalfAwayFromZero(-0.001, 2)).toBe(0);
    expect(formatFixed(2.345, 2)).toBe('2.35');
    expect(() => roundHalfAwayFromZero(Number.NaN, 2)).toThrow(GeometryError);
    expect(() => roundHalfAwayFromZero(1, 16)).toThrow(GeometryError);
  });
  it('parses strict decimals only', () => {
    expect(parseDecimalNumber(' 12.5 ')).toBe(12.5);
    expect(parseDecimalNumber('.25')).toBe(0.25);
    expect(parseDecimalNumber('-3')).toBe(-3);
    expect(parseDecimalNumber('1e3')).toBeNull();
    expect(parseDecimalNumber('12abc')).toBeNull();
    expect(parseDecimalNumber('')).toBeNull();
  });
  it('safe index helpers', () => {
    expect(at([1, 2], 1)).toBe(2);
    expect(() => at([1], 3)).toThrow(GeometryError);
    expect(cyclic([1, 2, 3], -1)).toBe(3);
    expect(cyclic([1, 2, 3], 4)).toBe(2);
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(1, 0, 3)).toBe(1);
    expect([compareStrings('a', 'b'), compareStrings('b', 'a'), compareStrings('a', 'a')]).toEqual([
      -1, 1, 0,
    ]);
  });
});

describe('units (PLT-019, CP-051 unit switches)', () => {
  it('uses exact definitional factors', () => {
    expect(toSI(1, 'ft')).toBe(0.3048);
    expect(toSI(12, 'in')).toBeCloseTo(0.3048, 15);
    expect(toSI(1, 'yd')).toBe(0.9144);
    close(UNIT_TO_SI.ft2, 0.3048 * 0.3048);
    close(UNIT_TO_SI.yd3, 0.9144 ** 3);
    close(UNIT_TO_SI.ft3, 0.3048 ** 3);
    expect(UNIT_TO_SI.square).toBe(UNIT_TO_SI.ft2 * 100);
  });
  it('converts lengths, areas and volumes', () => {
    close(convert(10, 'ft', 'm'), 3.048);
    close(convert(25, 'ft', 'in'), 300);
    close(convert(3, 'ft', 'yd'), 1);
    close(convert(1, 'm', 'ft'), 3.280839895013123);
    close(convert(100, 'ft2', 'square'), 1);
    close(convert(1, 'yd2', 'ft2'), 9);
    close(convert(1, 'yd3', 'ft3'), 27);
    close(convert(1, 'm3', 'yd3'), 1.3079506193143922);
    close(convert(144, 'in2', 'ft2'), 1);
    close(convert(1000, 'mm', 'cm'), 100);
    expect(convert(7, 'm', 'm')).toBe(7);
  });
  it('round trips within 1e-12 relative', () => {
    for (const u of ['ft', 'in', 'yd', 'ft2', 'yd2', 'square', 'ft3', 'yd3'] as const) {
      close(fromSI(toSI(123.456, u), u), 123.456);
    }
  });
  it('rejects dimension mismatches and non-finite values', () => {
    expect(() => convert(1, 'ft', 'ft2')).toThrow(/cannot convert/);
    expect(() => toSI(Number.POSITIVE_INFINITY, 'ft')).toThrow(GeometryError);
    expect(() => convert(Number.NaN, 'm', 'm')).toThrow(GeometryError);
  });
  it('feet+inches and display formatting', () => {
    close(feetInchesToMeters(12, 6), 3.81);
    expect(formatQuantity(toSI(1234.56, 'ft2'), 'ft2')).toBe('1234.6');
    expect(formatQuantity(toSI(12.345, 'square'), 'square')).toBe('12.35');
    expect(isUnit('ft')).toBe(true);
    expect(isUnit('furlong')).toBe(false);
  });
});

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('polygon math', () => {
  it('area, perimeter, centroid and winding', () => {
    expect(signedArea(square)).toBe(100);
    expect(signedArea([...square].reverse())).toBe(-100);
    expect(area([...square].reverse())).toBe(100);
    expect(perimeter(square)).toBe(40);
    expect(centroid(square)).toEqual({ x: 5, y: 5 });
    expect(isCounterClockwise(square)).toBe(true);
    const cw = [...square].reverse();
    const n = normalizeWinding(cw);
    expect(isCounterClockwise(n)).toBe(true);
    expect(n[0]).toEqual(cw[0]);
    expect(normalizeWinding([])).toEqual([]);
    expect(signedArea([{ x: 0, y: 0 }])).toBe(0);
    expect(perimeter([{ x: 0, y: 0 }])).toBe(0);
  });
  it('is accurate far from the origin', () => {
    const far = square.map((p) => ({ x: p.x + 5e6, y: p.y + 5e6 }));
    expect(signedArea(far)).toBe(100);
  });
  it('centroid of an L shape', () => {
    const l = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ];
    const c = centroid(l);
    close(c.x, 5 / 6);
    close(c.y, 5 / 6);
    expect(() =>
      centroid([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ]),
    ).toThrow(/zero-area/);
  });
  it('open ring strips explicit closure', () => {
    expect(openRing([...square, square[0]!])).toHaveLength(4);
    expect(openRing(square)).toHaveLength(4);
  });
  it('point in polygon', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(1);
    expect(pointInPolygon({ x: 10, y: 5 }, square)).toBe(0);
    expect(pointInPolygon({ x: 11, y: 5 }, square)).toBe(-1);
  });
  it('segment intersection incl. collinear touch', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 })).toBe(
      true,
    );
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 })).toBe(
      false,
    );
  });
});

describe('polygon validation (RF-023 S)', () => {
  it('accepts a valid square', () => expect(validatePolygon(square)).toEqual([]));
  it('flags unclosed GeoJSON-style rings and accepts closed ones', () => {
    expect(validatePolygon(square, { closed: true }).map((i) => i.code)).toContain('unclosed');
    expect(validatePolygon([...square, square[0]!], { closed: true })).toEqual([]);
  });
  it('flags < 3 vertices', () => {
    expect(validatePolygon(square.slice(0, 2)).map((i) => i.code)).toEqual(['too_few_vertices']);
  });
  it('flags zero area', () => {
    const codes = validatePolygon([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]).map((i) => i.code);
    expect(codes).toContain('zero_area');
  });
  it('flags self-intersection (bow tie)', () => {
    const bow = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(validatePolygon(bow).map((i) => i.code)).toContain('self_intersection');
  });
  it('flags fold-back spikes and duplicate vertices', () => {
    const spike = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
    ];
    expect(validatePolygon(spike).map((i) => i.code)).toContain('self_intersection');
    const dup = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
    ];
    expect(validatePolygon(dup).map((i) => i.code)).toContain('duplicate_vertex');
  });
  it('flags non-finite coordinates', () => {
    expect(validatePolygon([{ x: Number.NaN, y: 0 }, ...square]).map((i) => i.code)).toEqual([
      'non_finite_coordinate',
    ]);
  });
  it('overlap detection', () => {
    const shifted = square.map((p) => ({ x: p.x + 5, y: p.y }));
    const adjacent = square.map((p) => ({ x: p.x + 10, y: p.y }));
    const inner = [
      { x: 2, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: 4 },
    ];
    expect(polygonsOverlap(square, shifted)).toBe(true);
    expect(polygonsOverlap(square, adjacent)).toBe(false);
    expect(polygonsOverlap(square, inner)).toBe(true);
    expect(polygonsOverlap(square, square)).toBe(true);
  });
  it('interior point of a concave polygon lies inside', () => {
    const c = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 9, y: 10 },
      { x: 9, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(pointInPolygon(interiorPoint(c), c)).toBe(1);
  });
});

describe('pitch (RF-027 golden: 0/12, 6/12, 12/12)', () => {
  it('0/12 is flat', () => {
    const p = { rise: 0, run: 12 };
    expect(slopeFactor(p)).toBe(1);
    expect(pitchDegrees(p)).toBe(0);
    expect(slopedArea(100, p)).toBe(100);
  });
  it('6/12', () => {
    const p = { rise: 6, run: 12 };
    expect(pitchRatio(p)).toBe(0.5);
    expect(slopeFactor(p)).toBe(Math.sqrt(1.25));
    close(pitchDegrees(p), 26.56505117707799);
    close(slopedArea(1000, p), 1118.033988749895);
  });
  it('12/12', () => {
    const p = { rise: 12, run: 12 };
    expect(slopeFactor(p)).toBe(Math.SQRT2);
    close(pitchDegrees(p), 45);
    expect(risePer12({ rise: 1, run: 2 })).toBe(6);
  });
  it('degrees round trip and rejects bad input', () => {
    close(risePer12(pitchFromDegrees(45)), 12);
    expect(() => pitchFromDegrees(90)).toThrow(GeometryError);
    expect(() => pitchRatio({ rise: 1, run: 0 })).toThrow(/run > 0/);
    expect(() => pitchRatio({ rise: -1, run: 12 })).toThrow(GeometryError);
    expect(() => slopedArea(-1, { rise: 1, run: 12 })).toThrow(GeometryError);
  });
  it('true edge length: level, fall line, 45-degree hip', () => {
    expect(trueEdgeLength(10, 0.5, 0)).toBe(10);
    close(trueEdgeLength(10, 0.5, 1), 10 * Math.sqrt(1.25));
    close(trueEdgeLength(10 * Math.SQRT2, 0.5, Math.SQRT1_2), 15);
  });
});

describe('WGS84 tangent-plane projection', () => {
  it('origin maps to (0,0) and small offsets match the ellipsoid radii', () => {
    const plane = tangentPlane({ lon: -97.7431, lat: 30.2672 });
    const o = plane.project({ lon: -97.7431, lat: 30.2672 });
    expect(Math.abs(o.x)).toBeLessThan(1e-9);
    expect(Math.abs(o.y)).toBeLessThan(1e-9);
    // 1e-5 deg of latitude/longitude scale by the meridional (M) and prime-vertical (N) radii.
    const phi = (30.2672 * Math.PI) / 180;
    const e2 = (1 / 298.257223563) * (2 - 1 / 298.257223563);
    const w = 1 - e2 * Math.sin(phi) ** 2;
    const m = (6378137 * (1 - e2)) / w ** 1.5;
    const nRad = 6378137 / Math.sqrt(w);
    const step = (1e-5 * Math.PI) / 180;
    const n = plane.project({ lon: -97.7431, lat: 30.26721 });
    expect(n.y).toBeCloseTo(m * step, 6);
    const e = plane.project({ lon: -97.74309, lat: 30.2672 });
    expect(e.x).toBeCloseTo(nRad * Math.cos(phi) * step, 6);
  });
  it('projects a ~20 m square lot to its planar area within 1e-6 relative', () => {
    const lat = 40;
    const dLat = 20 / 111034.6; // approx meters per degree latitude at 40N
    const ring = [
      { lon: 0, lat },
      { lon: 0.0002, lat },
      { lon: 0.0002, lat: lat + dLat },
      { lon: 0, lat: lat + dLat },
    ];
    const { points } = projectRing(ring);
    const a = area(points);
    expect(a).toBeGreaterThan(0);
    // Reprojecting around a different origin gives the same area (shape-preserving locally).
    const other = projectRing(ring, ring[0]!);
    expect(Math.abs(area(other.points) - a) / a).toBeLessThan(1e-6);
    expect(meanLonLat(ring).lon).toBeCloseTo(0.0001, 12);
  });
  it('rejects invalid coordinates', () => {
    expect(() => tangentPlane({ lon: 0, lat: 91 })).toThrow(GeometryError);
    expect(() => meanLonLat([])).toThrow(GeometryError);
  });
});
