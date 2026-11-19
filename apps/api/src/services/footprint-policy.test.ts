import { describe, expect, it } from 'vitest';
import { distanceMeters, isRemoved, isSensitiveSite, ringCentroid } from './footprint-policy';
import { mappedBuildingCandidates } from './roof-footprint';

describe('isSensitiveSite', () => {
  it.each([
    { building: 'government' },
    { building: 'military' },
    { building: 'prison' },
    { landuse: 'military' },
    { amenity: 'prison' },
    { amenity: 'courthouse' },
    { office: 'government' },
    { government: 'tax' },
    { military: 'bunker' },
  ])('treats %j as sensitive', (tags) => {
    expect(isSensitiveSite(tags)).toBe(true);
  });

  it.each([{ building: 'house' }, { building: 'yes' }, { building: 'commercial', name: 'Shop' }, {}])(
    'leaves ordinary buildings %j visible',
    (tags) => {
      expect(isSensitiveSite(tags)).toBe(false);
    },
  );
});

describe('distance and removal zones', () => {
  it('measures roughly 111 km per degree of latitude', () => {
    const d = distanceMeters({ lat: 40, lon: -75 }, { lat: 41, lon: -75 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it('hides a footprint inside an approved zone and keeps one outside', () => {
    const zone = { lat: 40.0, lon: -75.0, radiusM: 30 };
    expect(isRemoved({ lat: 40.0001, lon: -75.0001 }, [zone])).toBe(true);
    expect(isRemoved({ lat: 40.01, lon: -75.0 }, [zone])).toBe(false);
    expect(isRemoved({ lat: 40, lon: -75 }, [])).toBe(false);
  });

  it('computes a ring centroid from its vertices', () => {
    const c = ringCentroid([
      { lon: 0, lat: 0 }, { lon: 2, lat: 0 }, { lon: 2, lat: 2 }, { lon: 0, lat: 2 },
    ]);
    expect(c).toEqual({ lat: 1, lon: 1 });
  });
});

describe('mappedBuildingCandidates', () => {
  const anchor = { lat: 40, lon: -75 };
  const square = (lon: number, lat: number, size: number) => [
    { lon, lat }, { lon: lon + size, lat }, { lon: lon + size, lat: lat + size },
    { lon, lat: lat + size }, { lon, lat },
  ];
  const way = (id: number, tags: Record<string, string>) => ({
    type: 'way', id, tags,
    geometry: square(-75.00005, 40.00005, 0.00012),
  });

  it('drops government and military buildings but keeps houses', () => {
    const candidates = mappedBuildingCandidates(
      { elements: [way(1, { building: 'house' }), way(2, { building: 'government' }), way(3, { landuse: 'military' })] },
      anchor,
    );
    expect(candidates.map((c) => c.id)).toEqual(['way/1']);
  });
});
