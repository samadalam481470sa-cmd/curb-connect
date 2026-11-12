import { describe, expect, it } from 'vitest';
import { cleanOutlineSegments, derivedRoofOutline } from './outlineMath';

const q = 0.00001;
const ring = (left: number, top: number, right: number, bottom: number) => [
  { lon: left * q, lat: top * q },
  { lon: right * q, lat: top * q },
  { lon: right * q, lat: bottom * q },
  { lon: left * q, lat: bottom * q },
];
const mid = (segment: {lon:number;lat:number}[]) => ({
  x: ((segment[0]!.lon + segment[1]!.lon) / 2) / q,
  y: ((segment[0]!.lat + segment[1]!.lat) / 2) / q,
});

describe('Clean map roof boundary', () => {
  it('automatically outlines a single traced facet', () => {
    expect(derivedRoofOutline([{ ring: ring(0, 0, 2, 2) }])).toHaveLength(4);
  });
  it('removes internal crossing seams from overlapping traced facet polygons', () => {
    const segments = derivedRoofOutline([
      { ring: ring(0, 0, 2, 2) },
      { ring: ring(1, 1, 3, 3) },
    ]);
    expect(segments).toHaveLength(8);
    expect(segments.some(segment => {
      const p = mid(segment);
      return Math.abs(p.x - 2) < 0.01 && p.y > 1.01 && p.y < 1.99;
    })).toBe(false);
    expect(segments.some(segment => {
      const p = mid(segment);
      return Math.abs(p.y - 2) < 0.01 && p.x > 1.01 && p.x < 1.99;
    })).toBe(false);
  });
  it('does not render inside facets or shared walls as the exterior', () => {
    expect(derivedRoofOutline([
      { ring: ring(0, 0, 4, 4) },
      { ring: ring(1, 1, 2, 2) },
    ])).toHaveLength(4);
    const adjacent = derivedRoofOutline([
      { ring: ring(0, 0, 1, 1) },
      { ring: ring(1, 0, 2, 1) },
    ]);
    expect(adjacent.some(s => s.every(p => Math.abs(p.lon / q - 1) < 0.01))).toBe(false);
  });
  it('prioritizes an explicit contractor-drawn building footprint', () => {
    const outline = ring(0, 0, 3, 3);
    const clean = cleanOutlineSegments([{ ring: ring(0, 0, 1, 1) }], outline);
    expect(clean).toHaveLength(1);
    expect(clean[0]).toHaveLength(5);
  });
});
