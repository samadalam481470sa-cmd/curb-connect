// GEOS-style operations on lon/lat rings, via @turf/* (MIT). Areas are cross-checked with
// the geodesic measurement, never taken from degree-space numbers.
import { describe, expect, it } from 'vitest';
import { geodesicArea } from './geodesic';
import {
  bufferLonLatRing,
  differenceLonLatRings,
  intersectLonLatRings,
  unionLonLatRings,
} from './operations';
import type { LonLat } from './projection';

const square: LonLat[] = [
  { lon: -96.8, lat: 32.8 },
  { lon: -96.79, lat: 32.8 },
  { lon: -96.79, lat: 32.79 },
  { lon: -96.8, lat: 32.79 },
];
const overlap: LonLat[] = [
  { lon: -96.795, lat: 32.795 },
  { lon: -96.785, lat: 32.795 },
  { lon: -96.785, lat: 32.785 },
  { lon: -96.795, lat: 32.785 },
];
const inside: LonLat[] = [
  { lon: -96.798, lat: 32.792 },
  { lon: -96.792, lat: 32.792 },
  { lon: -96.792, lat: 32.798 },
  { lon: -96.798, lat: 32.798 },
];
const far: LonLat[] = [
  { lon: -96.7, lat: 32.8 },
  { lon: -96.69, lat: 32.8 },
  { lon: -96.69, lat: 32.79 },
  { lon: -96.7, lat: 32.79 },
];

const totalArea = (rings: LonLat[][]): number =>
  rings.reduce((sum, ring) => sum + geodesicArea(ring), 0);

describe('unionLonLatRings', () => {
  it('unions two overlapping squares without double-counting the overlap', () => {
    const u = unionLonLatRings([square, overlap]);
    expect(u.length).toBeGreaterThanOrEqual(1);
    const expected =
      geodesicArea(square) + geodesicArea(overlap) - totalArea(intersectLonLatRings(square, overlap));
    expect(totalArea(u)).toBeCloseTo(expected, -3);
  });

  it('returns disjoint rings unchanged in count and a single ring as-is', () => {
    expect(unionLonLatRings([square, far])).toHaveLength(2);
    expect(unionLonLatRings([square])).toEqual([square]);
    expect(unionLonLatRings([])).toEqual([]);
  });
});

describe('intersectLonLatRings', () => {
  it('finds the overlap rectangle of two squares', () => {
    const inter = intersectLonLatRings(square, overlap);
    expect(inter).toHaveLength(1);
    // Overlap is 0.005° lon (~466 m) by 0.005° lat (~554 m) ≈ 258,000 m².
    expect(totalArea(inter)).toBeGreaterThan(250_000);
    expect(totalArea(inter)).toBeLessThan(266_000);
  });

  it('returns [] for disjoint rings', () => {
    expect(intersectLonLatRings(square, far)).toEqual([]);
  });
});

describe('differenceLonLatRings', () => {
  it('removes the overlap from the first ring', () => {
    const diff = differenceLonLatRings(square, overlap);
    const expected = geodesicArea(square) - totalArea(intersectLonLatRings(square, overlap));
    expect(totalArea(diff)).toBeCloseTo(expected, -3);
  });

  it('returns [] when the first ring is entirely inside the second', () => {
    expect(differenceLonLatRings(inside, square)).toEqual([]);
  });
});

describe('bufferLonLatRing', () => {
  it('grows a ring outward and shrinks it inward (setback)', () => {
    const base = geodesicArea(square);
    const out = bufferLonLatRing(square, 10);
    expect(totalArea(out)).toBeGreaterThan(base);
    const inset = bufferLonLatRing(square, -10);
    expect(totalArea(inset)).toBeGreaterThan(0);
    expect(totalArea(inset)).toBeLessThan(base);
  });

  it('returns [] when an inward buffer eats the whole ring', () => {
    expect(bufferLonLatRing(square, -10_000)).toEqual([]);
  });

  it('throws for too few vertices', () => {
    expect(() => bufferLonLatRing(square.slice(0, 2), 10)).toThrow(/at least 3 vertices/);
    expect(() => unionLonLatRings([square.slice(0, 2)])).toThrow(/at least 3 vertices/);
  });
});
