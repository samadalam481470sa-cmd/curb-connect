// Minimal CRS support: EPSG:4326 <-> EPSG:3857 via proj4, LOCAL_ENU_M via the tangent plane.
import { describe, expect, it } from 'vitest';
import {
  lonLatRingToMercator,
  mercatorRingToLonLat,
  reprojectPoint,
  reprojectRing,
  type CrsPoint,
} from './crs';

const R = 6378137;
// The spherical Web Mercator formulas, as an independent check on proj4.
const toMerc = (lon: number, lat: number): [number, number] => [
  (R * lon * Math.PI) / 180,
  R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
];
const toLonLat = (x: number, y: number): [number, number] => [
  ((x / R) * 180) / Math.PI,
  ((2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180) / Math.PI,
];

describe('reprojectPoint', () => {
  it('round-trips lon/lat through Web Mercator within a microradian', () => {
    const p = { crs: 'EPSG:4326', lon: -96.8, lat: 32.8 } as const;
    const merc = reprojectPoint(p, 'EPSG:3857');
    expect(merc.crs).toBe('EPSG:3857');
    const back = reprojectPoint(merc, 'EPSG:4326');
    expect(back.crs).toBe('EPSG:4326');
    if (back.crs !== 'EPSG:4326') throw new Error('lost CRS');
    expect(back.lon).toBeCloseTo(-96.8, 6);
    expect(back.lat).toBeCloseTo(32.8, 6);
  });

  it('matches the spherical Mercator formulas used by the class-6 script', () => {
    const [x, y] = toMerc(-96.8, 32.8);
    const merc = reprojectPoint({ crs: 'EPSG:4326', lon: -96.8, lat: 32.8 }, 'EPSG:3857');
    if (merc.crs !== 'EPSG:3857') throw new Error('lost CRS');
    expect(merc.x).toBeCloseTo(x, 3);
    expect(merc.y).toBeCloseTo(y, 3);
    const [lon, lat] = toLonLat(x, y);
    const ll = reprojectPoint({ crs: 'EPSG:3857', x, y }, 'EPSG:4326');
    if (ll.crs !== 'EPSG:4326') throw new Error('lost CRS');
    expect(ll.lon).toBeCloseTo(lon, 9);
    expect(ll.lat).toBeCloseTo(lat, 9);
  });

  it('round-trips through the local tangent plane about an origin', () => {
    const origin = { lon: -96.8, lat: 32.8 };
    const enu = reprojectPoint({ crs: 'EPSG:4326', lon: -96.79, lat: 32.81 }, 'LOCAL_ENU_M', origin);
    expect(enu.crs).toBe('LOCAL_ENU_M');
    if (enu.crs !== 'LOCAL_ENU_M') throw new Error('lost CRS');
    // ~933 m east, ~1,109 m north.
    expect(enu.x).toBeGreaterThan(920);
    expect(enu.x).toBeLessThan(950);
    expect(enu.y).toBeGreaterThan(1100);
    expect(enu.y).toBeLessThan(1120);
    const back = reprojectPoint(enu, 'EPSG:4326', origin);
    if (back.crs !== 'EPSG:4326') throw new Error('lost CRS');
    expect(back.lon).toBeCloseTo(-96.79, 6);
    expect(back.lat).toBeCloseTo(32.81, 6);
  });

  it('returns a point already in the target CRS unchanged', () => {
    const p = { crs: 'EPSG:4326', lon: -96.8, lat: 32.8 } as const;
    expect(reprojectPoint(p, 'EPSG:4326')).toBe(p);
  });

  it('refuses LOCAL_ENU_M without an origin and unknown CRS values', () => {
    expect(() =>
      reprojectPoint({ crs: 'EPSG:4326', lon: -96.8, lat: 32.8 }, 'LOCAL_ENU_M'),
    ).toThrow(/needs an origin/);
    expect(() =>
      reprojectPoint({ crs: 'EPSG:3857', x: 0, y: 0 }, 'LOCAL_ENU_M'),
    ).toThrow(/needs an origin/);
    expect(() =>
      reprojectPoint({ crs: 'EPSG:9999', lon: 0, lat: 0 } as unknown as CrsPoint, 'EPSG:4326'),
    ).toThrow(/unsupported CRS/);
  });
});

describe('ring helpers', () => {
  it('converts a 3857 footprint ring to lon/lat and back', () => {
    const lonLat = [
      { lon: -96.8, lat: 32.8 },
      { lon: -96.79, lat: 32.8 },
      { lon: -96.79, lat: 32.79 },
    ];
    const merc = lonLatRingToMercator(lonLat);
    const back = mercatorRingToLonLat(merc.map((p) => [p.x, p.y]));
    for (const [i, p] of back.entries()) {
      expect(p.lon).toBeCloseTo(lonLat[i]!.lon, 6);
      expect(p.lat).toBeCloseTo(lonLat[i]!.lat, 6);
    }
    const ring = reprojectRing(
      lonLat.map((p) => ({ crs: 'EPSG:4326', lon: p.lon, lat: p.lat }) as const),
      'EPSG:3857',
    );
    expect(ring).toHaveLength(3);
    expect(ring[0]!.crs).toBe('EPSG:3857');
  });
});
