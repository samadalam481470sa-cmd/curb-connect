import { describe, expect, it } from 'vitest';
import { facetsGeoJson, measureFacet, measureRoof, type MapFacet } from './facetMath';

// ~10 m × 10 m square near Dallas: 1 deg lat ≈ 110,950 m there.
const lat0 = 32.78;
const dLat = 10 / 110_950;
const dLon = 10 / (111_320 * Math.cos((lat0 * Math.PI) / 180));
const square: MapFacet = {
  id: 'a',
  name: 'A',
  pitch: 6,
  ring: [
    { lon: -96.8, lat: lat0 },
    { lon: -96.8 + dLon, lat: lat0 },
    { lon: -96.8 + dLon, lat: lat0 + dLat },
    { lon: -96.8, lat: lat0 + dLat },
  ],
};

describe('map roof facets', () => {
  it('measures a ~100 m² square as ~1,076 ft² plan, with 6/12 slope', () => {
    const r = measureFacet(square)!;
    expect(r.planSqFt).toBeGreaterThan(1065);
    expect(r.planSqFt).toBeLessThan(1085);
    expect(r.slopedSqFt! / r.planSqFt).toBeCloseTo(Math.sqrt(1.25), 2);
    expect(r.pitchDegrees).toBeCloseTo(26.6, 1);
    expect(r.perimeterFt).toBeGreaterThan(130);
  });

  it('leaves sloped area unresolved when pitch is unknown', () => {
    const roof = measureRoof([square, { ...square, id: 'b', pitch: null }]);
    expect(roof.facetsMissingPitch).toBe(1);
    expect(roof.slopedSqFt).toBeCloseTo(roof.facets[0]!.slopedSqFt!, 1);
  });

  it('ignores open rings and emits closed GeoJSON polygons', () => {
    const roof = measureRoof([{ ...square, ring: square.ring.slice(0, 2) }]);
    expect(roof.facets).toHaveLength(0);
    const gj = facetsGeoJson([square], measureRoof([square]).facets);
    const coords = gj.features[0]!.geometry.coordinates[0]!;
    expect(coords[0]).toEqual(coords[coords.length - 1]);
  });
});
