// Geometry repair: duplicate vertices, closing duplicates, single bow-tie splits, and the
// cases that must stay unrepaired.
import { describe, expect, it } from 'vitest';
import { repairLonLatRing, repairRing, segmentCrossingPoint } from './repair';
import { signedArea } from './polygon';

const bowTie = [
  { x: 0, y: 0 },
  { x: 10, y: 10 },
  { x: 10, y: 0 },
  { x: 0, y: 10 },
];

describe('segmentCrossingPoint', () => {
  it('finds the crossing of the bow-tie diagonals', () => {
    const p = segmentCrossingPoint(bowTie[0]!, bowTie[1]!, bowTie[2]!, bowTie[3]!);
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(5, 9);
    expect(p!.y).toBeCloseTo(5, 9);
  });

  it('returns null for parallel and merely touching segments', () => {
    expect(
      segmentCrossingPoint({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 }),
    ).toBeNull();
    expect(
      segmentCrossingPoint({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }),
    ).toBeNull();
  });
});

describe('repairRing', () => {
  it('splits a bow-tie into one simple triangle and reports it', () => {
    const r = repairRing(bowTie);
    expect(r.ok).toBe(true);
    expect(r.ring).toHaveLength(3);
    expect(Math.abs(signedArea(r.ring))).toBeCloseTo(25, 9);
    expect(r.actions.join(' ')).toMatch(/self-intersection/);
  });

  it('drops duplicate vertices and a closing duplicate', () => {
    const r = repairRing([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.ring).toHaveLength(4);
    expect(Math.abs(signedArea(r.ring))).toBeCloseTo(100, 9);
    expect(r.actions.join(' ')).toMatch(/duplicate/);
  });

  it('leaves a valid ring alone with no actions', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const r = repairRing(square);
    expect(r.ok).toBe(true);
    expect(r.ring).toEqual(square);
    expect(r.actions).toEqual([]);
  });

  it('refuses a ring with several crossings, returning the input untouched', () => {
    // A five-point star outline crosses itself five times.
    const star = [
      { x: 0, y: 0 },
      { x: 10, y: 6 },
      { x: 2, y: 10 },
      { x: 6, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 4 },
    ];
    const r = repairRing(star);
    expect(r.ok).toBe(false);
    expect(r.ring).toEqual(star);
    expect(r.actions.join(' ')).toMatch(/crosses itself/);
  });

  it('refuses zero-area and non-finite rings', () => {
    expect(repairRing([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }]).ok).toBe(false);
    expect(
      repairRing([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: Number.NaN, y: 10 },
      ]).ok,
    ).toBe(false);
  });
});

describe('repairLonLatRing', () => {
  it('repairs a lon/lat bow-tie in its tangent plane', () => {
    const ring = [
      { lon: -96.8, lat: 32.8 },
      { lon: -96.79, lat: 32.81 },
      { lon: -96.79, lat: 32.8 },
      { lon: -96.8, lat: 32.81 },
    ];
    const r = repairLonLatRing(ring);
    expect(r.ok).toBe(true);
    expect(r.ring).toHaveLength(3);
    expect(r.actions.join(' ')).toMatch(/self-intersection/);
  });
});
