import { describe, expect, it } from 'vitest';
import { class6Footprints, footprintRingToLonLat, type ClassifiedPoint } from './class6-footprints';

const box = { minx: 0, miny: 0, maxx: 200, maxy: 200 };

/** Scatter `n` class-6 points uniformly over a square of side `side` at (x0, y0). */
function square(x0: number, y0: number, side: number, n = 400, c = 6): ClassifiedPoint[] {
  const pts: ClassifiedPoint[] = [];
  for (let i = 0; i < n; i++) {
    pts.push({ x: x0 + ((i * 7919) % 1000) / 1000 * side, y: y0 + ((i * 104729) % 1000) / 1000 * side, c });
  }
  return pts;
}

describe('class6Footprints', () => {
  it('turns a scattered roof into one footprint close to its real area', () => {
    const { footprints, classifiedPoints } = class6Footprints(square(50, 50, 10), box);
    expect(classifiedPoints).toBe(400);
    expect(footprints).toHaveLength(1);
    expect(footprints[0]!.areaM2).toBeGreaterThan(90);
    expect(footprints[0]!.areaM2).toBeLessThan(160);
  });

  it('keeps separate roofs separate', () => {
    const pts = [...square(20, 20, 10), ...square(120, 120, 12)];
    expect(class6Footprints(pts, box).footprints).toHaveLength(2);
  });

  it('ignores non-building classes and points outside the box', () => {
    const pts = [...square(50, 50, 10, 300, 2), ...square(300, 300, 10, 300, 6)];
    const result = class6Footprints(pts, box);
    expect(result.classifiedPoints).toBe(0);
    expect(result.footprints).toHaveLength(0);
  });

  it('drops blobs below the minimum area', () => {
    expect(class6Footprints(square(50, 50, 3, 60), box).footprints).toHaveLength(0);
  });

  it('closes a ring around the footprint', () => {
    const [f] = class6Footprints(square(50, 50, 10), box).footprints;
    expect(f!.ring[0]).toEqual(f!.ring[f!.ring.length - 1]);
  });

  it('rejects an invalid grid size', () => {
    expect(() => class6Footprints([], box, { cellM: 0 })).toThrow(RangeError);
  });
});

describe('footprintRingToLonLat', () => {
  it('converts an EPSG:3857 ring to lon/lat via the shared CRS helper', () => {
    // Dallas: EPSG:3857 x/y from the spherical Mercator formulas the script used to
    // hand-roll; the helper must agree with them to the metre.
    const R = 6378137;
    const lon = -96.8;
    const lat = 32.8;
    const x = (R * lon * Math.PI) / 180;
    const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    const ring = footprintRingToLonLat([
      [x, y],
      [x + 10, y],
      [x + 10, y + 10],
      [x, y],
    ]);
    expect(ring).toHaveLength(4);
    expect(ring[0]!.lon).toBeCloseTo(lon, 6);
    expect(ring[0]!.lat).toBeCloseTo(lat, 6);
    expect(ring[3]).toEqual(ring[0]);
  });
});
