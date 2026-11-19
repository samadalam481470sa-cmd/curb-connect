import { describe, expect, it } from 'vitest';
import {
  areaFt2AsInput,
  closeRing,
  edgeLengthsFt,
  openRing,
  perimeterFromLngLat,
  planAreaFromLngLat,
} from './polygonArea';

/**
 * Roughly 100 ft × 100 ft square near 40°N, 75°W.
 * 100 ft ≈ 30.48 m; at mid-latitudes 1° lon ≈ 111320·cos(lat) m, 1° lat ≈ 110540 m.
 */
function approxHundredFootSquare(): [number, number][] {
  const lat = 40.0;
  const lng = -75.0;
  const dLat = 30.48 / 110540;
  const dLng = 30.48 / (111320 * Math.cos((lat * Math.PI) / 180));
  return [
    [lng, lat],
    [lng + dLng, lat],
    [lng + dLng, lat + dLat],
    [lng, lat + dLat],
  ];
}

describe('planAreaFromLngLat', () => {
  it('returns zero for fewer than 3 vertices', () => {
    expect(planAreaFromLngLat([]).areaFt2).toBe(0);
    expect(planAreaFromLngLat([[-75, 40]]).areaFt2).toBe(0);
    expect(
      planAreaFromLngLat([
        [-75, 40],
        [-74.9, 40],
      ]).areaFt2,
    ).toBe(0);
  });

  it('converts a ~100×100 ft square to roughly 10,000 ft²', () => {
    const ring = approxHundredFootSquare();
    const result = planAreaFromLngLat(ring);
    expect(result.areaFt2).toBeGreaterThan(9800);
    expect(result.areaFt2).toBeLessThan(10200);
    expect(result.areaM2).toBeGreaterThan(900);
    expect(result.areaM2).toBeLessThan(950);
    // Turf geodesic and ENU planar should agree within imagery-scale error.
    expect(Math.abs(result.areaFt2 - result.planarAreaFt2) / result.areaFt2).toBeLessThan(0.01);
  });

  it('accepts an already-closed ring', () => {
    const open = approxHundredFootSquare();
    const closed = closeRing(open);
    const a = planAreaFromLngLat(open);
    const b = planAreaFromLngLat(closed);
    expect(b.areaFt2).toBeCloseTo(a.areaFt2, 1);
  });

  it('formats positive areas as decimal input strings', () => {
    expect(areaFt2AsInput(1234.567, 1)).toBe('1234.6');
    expect(areaFt2AsInput(0)).toBe('');
    expect(areaFt2AsInput(Number.NaN)).toBe('');
  });
});

describe('edge and perimeter helpers', () => {
  it('openRing / closeRing are inverses for closed input', () => {
    const open = approxHundredFootSquare();
    const closed = closeRing(open);
    expect(closed).toHaveLength(5);
    expect(openRing(closed)).toEqual(open);
  });

  it('reports four ~100 ft edges for the test square', () => {
    const edges = edgeLengthsFt(approxHundredFootSquare());
    expect(edges).toHaveLength(4);
    for (const e of edges) {
      expect(e).toBeGreaterThan(95);
      expect(e).toBeLessThan(105);
    }
    const peri = perimeterFromLngLat(approxHundredFootSquare());
    expect(peri.lengthFt).toBeGreaterThan(380);
    expect(peri.lengthFt).toBeLessThan(420);
  });
});
