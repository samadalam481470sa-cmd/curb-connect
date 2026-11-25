// Geodesic (ellipsoid) measurement on WGS84, via GeographicLib — the same library QGIS
// uses for QgsDistanceArea.
import { describe, expect, it } from 'vitest';
import { geodesicArea, geodesicAreaAcres, geodesicPerimeter, M2_PER_ACRE } from './geodesic';
import { area, projectRing } from './index';
import type { LonLat } from './projection';

// Right triangle near Dallas: 0.01° lon (~933 m) by 0.01° lat (~1,109 m).
const triangle: LonLat[] = [
  { lon: -96.8, lat: 32.8 },
  { lon: -96.79, lat: 32.8 },
  { lon: -96.79, lat: 32.79 },
];

describe('geodesicArea', () => {
  it('measures the Dallas triangle at ~519,368 m² (Karney geodesic)', () => {
    const a = geodesicArea(triangle);
    expect(a).toBeGreaterThan(519_000);
    expect(a).toBeLessThan(519_800);
  });

  it('measures the triangle perimeter at ~3,497 m', () => {
    const p = geodesicPerimeter(triangle);
    expect(p).toBeGreaterThan(3_490);
    expect(p).toBeLessThan(3_505);
  });

  it('reports acres from the same area', () => {
    expect(geodesicAreaAcres(triangle)).toBeCloseTo(geodesicArea(triangle) / M2_PER_ACRE, 10);
    expect(geodesicAreaAcres(triangle)).toBeGreaterThan(128);
    expect(geodesicAreaAcres(triangle)).toBeLessThan(129);
  });

  it('does not depend on winding', () => {
    expect(geodesicArea([...triangle].reverse())).toBeCloseTo(geodesicArea(triangle), 6);
  });

  it('agrees with the tangent plane to far under 0.01% at house scale', () => {
    const { points } = projectRing(triangle);
    const planar = area(points);
    expect(Math.abs(geodesicArea(triangle) - planar) / planar).toBeLessThan(0.0001);
  });

  it('grows with extent: a 10× larger triangle is ~100× the area', () => {
    const big = triangle.map((p) => ({
      lon: -96.8 + (p.lon + 96.8) * 10,
      lat: 32.8 + (p.lat - 32.8) * 10,
    }));
    const ratio = geodesicArea(big) / geodesicArea(triangle);
    expect(ratio).toBeGreaterThan(95);
    expect(ratio).toBeLessThan(105);
  });

  it('throws for too few vertices and invalid coordinates', () => {
    expect(() => geodesicArea(triangle.slice(0, 2))).toThrow(/at least 3 vertices/);
    expect(() =>
      geodesicArea([
        { lon: -96.8, lat: 32.8 },
        { lon: -96.79, lat: 32.8 },
        { lon: 200, lat: 32.79 },
      ]),
    ).toThrow(/invalid lon\/lat/);
  });
});
