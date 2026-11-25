// GeoJSON import: only lon/lat Polygon/MultiPolygon input; everything else is refused with
// a plain-language reason instead of being silently misread.
import { describe, expect, it } from 'vitest';
import { parseGeoJsonPolygons } from './geojson';

const ring = [
  [-96.8, 32.8],
  [-96.79, 32.8],
  [-96.79, 32.79],
  [-96.8, 32.79],
  [-96.8, 32.8],
];

describe('parseGeoJsonPolygons', () => {
  it('parses a FeatureCollection of polygons into open rings', () => {
    const { polygons, errors } = parseGeoJsonPolygons({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } },
        { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } },
      ],
    });
    expect(errors).toEqual([]);
    expect(polygons).toHaveLength(2);
    expect(polygons[0]).toHaveLength(4);
    expect(polygons[0]![0]).toEqual({ lon: -96.8, lat: 32.8 });
  });

  it('parses a bare Polygon and a MultiPolygon', () => {
    const bare = parseGeoJsonPolygons({ type: 'Polygon', coordinates: [ring] });
    expect(bare.polygons).toHaveLength(1);
    const multi = parseGeoJsonPolygons({ type: 'MultiPolygon', coordinates: [[ring], [ring]] });
    expect(multi.polygons).toHaveLength(2);
    expect(multi.errors).toEqual([]);
  });

  it('skips a Point feature with a reason instead of failing the file', () => {
    const { polygons, errors } = parseGeoJsonPolygons({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-96.8, 32.8] } },
        { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } },
      ],
    });
    expect(polygons).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/only Polygon and MultiPolygon/);
  });

  it('refuses projected-metre coordinates as lon/lat', () => {
    const mercRing = [
      [-10775726, 3868787],
      [-10774600, 3868787],
      [-10774600, 3867678],
      [-10775726, 3867678],
      [-10775726, 3868787],
    ];
    const { polygons, errors } = parseGeoJsonPolygons({
      type: 'Polygon',
      coordinates: [mercRing],
    });
    expect(polygons).toHaveLength(0);
    expect(errors.join(' ')).toMatch(/EPSG:3857/);
  });

  it('refuses unclosed rings and non-GeoJSON input', () => {
    const unclosed = parseGeoJsonPolygons({ type: 'Polygon', coordinates: [ring.slice(0, -1)] });
    expect(unclosed.polygons).toHaveLength(0);
    expect(unclosed.errors.join(' ')).toMatch(/not closed/);
    expect(parseGeoJsonPolygons({ hello: 'world' }).errors.join(' ')).toMatch(/no "type"/);
    expect(parseGeoJsonPolygons(null).errors.join(' ')).toMatch(/no "type"/);
    expect(
      parseGeoJsonPolygons({ type: 'FeatureCollection', features: 'nope' }).errors.join(' '),
    ).toMatch(/no "features"/);
  });

  it('skips a null-geometry feature with a reason', () => {
    const { polygons, errors } = parseGeoJsonPolygons({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: null }],
    });
    expect(polygons).toHaveLength(0);
    expect(errors.join(' ')).toMatch(/no geometry/);
  });
});
