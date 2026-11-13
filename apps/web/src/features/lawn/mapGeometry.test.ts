import { describe, expect, it } from 'vitest';
import {
  measureLawnRegions, migrateLegacyLawnPolygon, nudgeCoordinate,
  perimeterFeet, segmentLengthFeet, validRegionPoints, type LawnRegion,
} from './mapGeometry';
import { polygonAreaSqFt, type Coordinate } from './estimate';

const origin = { lat: 32.7767, lon: -96.797 };
function rectangle(x: number, y: number, width: number, height: number): Coordinate[] {
  const sw = nudgeCoordinate(nudgeCoordinate(origin, 'east', x), 'north', y);
  const east = nudgeCoordinate(sw, 'east', width);
  const north = nudgeCoordinate(sw, 'north', height);
  const ne = nudgeCoordinate(east, 'north', height);
  return [sw, east, ne, north];
}
const lawn = (id: string, points: Coordinate[]): LawnRegion =>
  ({ id, name: id, kind: 'grass', points });
const exclusion = (id: string, points: Coordinate[]): LawnRegion =>
  ({ id, name: id, kind: 'exclude', points });

describe('lawn precision mapping', () => {
  it('calculates a field-scale 100 × 100 foot patch within small projection tolerance', () => {
    const points = rectangle(0, 0, 100, 100);
    expect(polygonAreaSqFt(points)).toBeGreaterThan(9900);
    expect(polygonAreaSqFt(points)).toBeLessThan(10100);
    expect(perimeterFeet(points)).toBeCloseTo(400, 0);
    expect(segmentLengthFeet(points[0]!, points[1]!)).toBeCloseTo(100, 1);
  });
  it('adds separate lawns and subtracts mapped patio and flowerbed once', () => {
    const regions = [
      lawn('front', rectangle(0, 0, 100, 100)),
      lawn('back', rectangle(120, 0, 50, 80)),
      exclusion('driveway', rectangle(10, 10, 20, 30)),
      exclusion('flowerbed', rectangle(60, 10, 20, 10)),
    ];
    const q = measureLawnRegions(regions);
    expect(q.valid).toBe(true);
    expect(q.grossSqFt).toBeGreaterThan(13900);
    expect(q.grossSqFt).toBeLessThan(14100);
    expect(q.excludedSqFt).toBeGreaterThan(780);
    expect(q.excludedSqFt).toBeLessThan(820);
    expect(q.netSqFt).toBeGreaterThan(13000);
    expect(q.netSqFt).toBeLessThan(13300);
    expect(q.grassPerimeterFt).toBeGreaterThan(650);
    expect(q.lawnZones).toBe(2);
    expect(q.exclusions).toBe(2);
  });
  it('subtracts driveways that touch the outside edge of a yard', () => {
    const quote = measureLawnRegions([
      lawn('front', rectangle(0, 0, 100, 100)),
      exclusion('driveway by sidewalk', rectangle(0, 0, 30, 40)),
    ]);
    expect(quote.valid).toBe(true);
    expect(quote.excludedSqFt).toBeGreaterThan(1180);
    expect(quote.excludedSqFt).toBeLessThan(1220);
    expect(quote.netSqFt).toBeGreaterThan(8700);
    expect(quote.netSqFt).toBeLessThan(8900);
  });
  it('rejects overlapping lawns that would double-price mowing', () => {
    const q = measureLawnRegions([
      lawn('front', rectangle(0, 0, 100, 100)),
      lawn('side', rectangle(50, 50, 100, 100)),
    ]);
    expect(q.valid).toBe(false);
    expect(q.netSqFt).toBeNull();
    expect(q.issues.join(' ')).toMatch(/overlap/i);
  });
  it('rejects identical and partly coincident grass zones but allows adjacent yards', () => {
    expect(measureLawnRegions([
      lawn('double', rectangle(0, 0, 100, 100)),
      lawn('same', rectangle(0, 0, 100, 100)),
    ]).valid).toBe(false);
    expect(measureLawnRegions([
      lawn('front', rectangle(0, 0, 100, 100)),
      lawn('overlap-on-edge', rectangle(0, 0, 100, 50)),
    ]).valid).toBe(false);
    const nextDoor = measureLawnRegions([
      lawn('front', rectangle(0, 0, 100, 100)),
      lawn('back', rectangle(100, 0, 60, 100)),
    ]);
    expect(nextDoor.valid).toBe(true);
  });

  it('rejects holes outside the grass zone or crossing its edge', () => {
    const q = measureLawnRegions([
      lawn('front', rectangle(0, 0, 100, 100)),
      exclusion('wrong-side-of-fence', rectangle(85, 85, 40, 40)),
    ]);
    expect(q.valid).toBe(false);
    expect(q.netSqFt).toBeNull();
    expect(q.issues[0]).toContain('exclusions');
  });
  it('rejects overlapping exclusion islands and invalid drawing geometry', () => {
    expect(measureLawnRegions([
      lawn('front', rectangle(0, 0, 100, 100)),
      exclusion('bed1', rectangle(5, 5, 30, 30)),
      exclusion('bed2', rectangle(25, 25, 30, 30)),
    ]).valid).toBe(false);
    expect(measureLawnRegions([
      lawn('front', rectangle(0, 0, 100, 100)),
      lawn('partial', rectangle(110, 0, 100, 100).slice(0, 2)),
    ]).valid).toBe(false);
  });
  it('moves one point one measured foot instead of one vague display pixel', () => {
    const east = nudgeCoordinate(origin, 'east', 1);
    expect(segmentLengthFeet(origin, east)).toBeCloseTo(1, 2);
    const back = nudgeCoordinate(east, 'west', 1);
    expect(segmentLengthFeet(back, origin)).toBeLessThan(0.01);
    const north = nudgeCoordinate(origin, 'north', 5);
    expect(segmentLengthFeet(origin, north)).toBeCloseTo(5, 2);
  });
  it('prevents invalid saved geometry and migrates old single-outline drafts', () => {
    const old = rectangle(0, 0, 40, 40);
    const imported = migrateLegacyLawnPolygon(old);
    expect(imported[0]?.kind).toBe('grass');
    expect(measureLawnRegions(imported).valid).toBe(true);
    expect(validRegionPoints([{ id: 'broken', name: 'bad', kind: 'grass',
      points: [{ lon: NaN, lat: 40 }] }])).toBe(false);
    expect(validRegionPoints(Array.from({ length: 25 }, (_, i) =>
      lawn(String(i), old)))).toBe(false);
  });
});
