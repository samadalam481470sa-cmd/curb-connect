import { describe, expect, it } from 'vitest';
import { calculateRoofFromGeoJson, roundRoofTotals } from './geometry-calc';

/** ~10m x 10m square near Dallas (approx). */
function approx10mSquare() {
  const originLat = 32.7767;
  const originLon = -96.797;
  // 10m north ≈ 10 / 111_320 degrees latitude
  const dLat = 10 / 111_320;
  // 10m east ≈ 10 / (111_320 * cos(lat))
  const dLon = 10 / (111_320 * Math.cos((originLat * Math.PI) / 180));
  const ring: [number, number][] = [
    [originLon, originLat],
    [originLon + dLon, originLat],
    [originLon + dLon, originLat + dLat],
    [originLon, originLat + dLat],
    [originLon, originLat],
  ];
  return {
    type: 'Polygon' as const,
    coordinates: [ring],
  };
}

describe('calculateRoofFromGeoJson', () => {
  it('computes ~100 m2 plan area for a 10x10m square', () => {
    const result = calculateRoofFromGeoJson(approx10mSquare(), [
      { facetIndex: 0, pitchRise: 0, pitchRun: 12 },
    ]);
    expect(result.planAreaM2).toBeGreaterThan(95);
    expect(result.planAreaM2).toBeLessThan(105);
    expect(result.slopedAreaM2).toBeCloseTo(result.planAreaM2, 5);
    expect(result.perimeterM).toBeGreaterThan(38);
    expect(result.perimeterM).toBeLessThan(42);
    expect(result.edgeLengthsM).toHaveLength(4);
    expect(result.squares).toBeGreaterThan(1);
  });

  it('applies 6/12 pitch slope factor to sloped area', () => {
    const flat = calculateRoofFromGeoJson(approx10mSquare(), [
      { facetIndex: 0, pitchRise: 0, pitchRun: 12 },
    ]);
    const pitched = calculateRoofFromGeoJson(approx10mSquare(), [
      { facetIndex: 0, pitchRise: 6, pitchRun: 12 },
    ]);
    const expectedFactor = Math.sqrt(1 + (6 / 12) ** 2);
    expect(pitched.slopedAreaM2 / pitched.planAreaM2).toBeCloseTo(expectedFactor, 5);
    expect(pitched.slopedAreaM2).toBeGreaterThan(flat.slopedAreaM2);
  });

  it('roundRoofTotals returns display-friendly numbers', () => {
    const rounded = roundRoofTotals(
      calculateRoofFromGeoJson(approx10mSquare(), [{ facetIndex: 0, pitchRise: 6, pitchRun: 12 }]),
    );
    expect(rounded.planAreaFt2).toBeGreaterThan(1000);
    expect(rounded.squares).toBeGreaterThan(10);
    expect(rounded.georef.crs).toBe('LOCAL_ENU_M');
  });
});
