import { describe, expect, it } from 'vitest';
import {
  facetsGeoJson,
  measureFacet,
  measureRoof,
  validateMapFacet,
  type MapFacet,
} from './facetMath';

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

  it('labels the facet at its centroid via the projection inverse', () => {
    const r = measureFacet(square)!;
    expect(r.label.lon).toBeGreaterThan(-96.8);
    expect(r.label.lon).toBeLessThan(-96.79);
    expect(r.label.lat).toBeGreaterThan(lat0);
    expect(r.label.lat).toBeLessThan(lat0 + dLat);
    expect(r.issues).toEqual([]);
    expect(r.blocked).toBe(false);
  });

  it('flags a bow-tie facet as blocked and excludes it from the totals', () => {
    const bowTie: MapFacet = {
      id: 'bow',
      name: 'Bow',
      pitch: 6,
      ring: [
        { lon: -96.8, lat: lat0 },
        { lon: -96.8 + dLon, lat: lat0 + dLat },
        { lon: -96.8 + dLon, lat: lat0 },
        { lon: -96.8, lat: lat0 + dLat },
      ],
    };
    const issues = validateMapFacet(bowTie);
    expect(issues.some((i) => i.code === 'self_intersection')).toBe(true);
    const roof = measureRoof([square, bowTie]);
    expect(roof.invalidFacets).toBe(1);
    expect(roof.facets.find((f) => f.id === 'bow')!.blocked).toBe(true);
    // The bow-tie contributes nothing: the totals equal the good facet alone.
    expect(roof.planSqFt).toBeCloseTo(measureRoof([square]).planSqFt, 1);
  });

  it('flags a duplicate-vertex facet but still counts it', () => {
    const dup: MapFacet = {
      ...square,
      id: 'dup',
      ring: [square.ring[0]!, square.ring[1]!, square.ring[1]!, square.ring[2]!, square.ring[3]!],
    };
    expect(validateMapFacet(dup).some((i) => i.code === 'duplicate_vertex')).toBe(true);
    const roof = measureRoof([dup]);
    expect(roof.invalidFacets).toBe(0);
    expect(roof.flaggedFacets).toBe(1);
    expect(roof.planSqFt).toBeGreaterThan(1000);
  });

  it('unions overlapping facets so the combined footprint is counted once', () => {
    const shifted: MapFacet = {
      ...square,
      id: 'shifted',
      ring: square.ring.map((p) => ({ lon: p.lon + dLon / 2, lat: p.lat })),
    };
    const roof = measureRoof([square, shifted]);
    expect(roof.overlappingFacetPairs).toBe(1);
    expect(roof.unionPlanSqFt).not.toBeNull();
    expect(roof.unionPlanSqFt!).toBeLessThan(roof.planSqFt);
    expect(roof.unionPlanSqFt!).toBeGreaterThan(roof.planSqFt / 2);
    const apart = measureRoof([
      square,
      { ...shifted, ring: shifted.ring.map((p) => ({ lon: p.lon + dLon * 4, lat: p.lat })) },
    ]);
    expect(apart.overlappingFacetPairs).toBe(0);
    expect(apart.unionPlanSqFt).toBeCloseTo(apart.planSqFt, 0);
  });
});
