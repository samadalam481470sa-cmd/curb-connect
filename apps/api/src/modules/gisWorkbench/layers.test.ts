import { describe, expect, it } from 'vitest';
import {
  bboxContains,
  checkBbox,
  fetchParcelsInBbox,
  fetchStreamsInBbox,
  geoJsonFeatures,
  normalizeCollinGeoJsonFeature,
  normalizeDallasGeoJsonFeature,
  normalizeNhdGeoJsonFeature,
  parseLineGeometry,
  parsePolygonGeometry,
} from './layers';

const BBOX = { west: -96.82, south: 32.76, east: -96.78, north: 32.79 };

const polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-96.81, 32.77],
      [-96.8, 32.77],
      [-96.8, 32.78],
      [-96.81, 32.78],
      [-96.81, 32.77],
    ],
  ],
};

function fakeFetch(payloads: Record<string, unknown>): typeof fetch {
  return (async (url: string) => {
    const key = Object.keys(payloads).find((k) => String(url).includes(k));
    if (key === undefined) throw new Error('unexpected url');
    return new Response(JSON.stringify(payloads[key]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('checkBbox', () => {
  it('accepts a view-scale box', () => {
    expect(checkBbox(BBOX).ok).toBe(true);
  });

  it('refuses inverted corners', () => {
    const result = checkBbox({ west: -96.7, south: 32.8, east: -96.8, north: 32.7 });
    expect(result.ok).toBe(false);
  });

  it('refuses a county-wide view with the reason', () => {
    const result = checkBbox({ west: -97.5, south: 32.5, east: -96.5, north: 33.0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('too wide');
  });
});

describe('bboxContains', () => {
  it('is inclusive at the edges', () => {
    expect(bboxContains(-96.82, 32.76, BBOX)).toBe(true);
    expect(bboxContains(-96.7, 32.77, BBOX)).toBe(false);
  });
});

describe('geometry parsing', () => {
  it('accepts Polygon and MultiPolygon, refuses lines and junk', () => {
    expect(parsePolygonGeometry(polygon)?.type).toBe('Polygon');
    expect(parsePolygonGeometry({ type: 'MultiPolygon', coordinates: [polygon.coordinates] })?.type).toBe(
      'MultiPolygon',
    );
    expect(parsePolygonGeometry({ type: 'LineString', coordinates: [[0, 0], [1, 1]] })).toBeNull();
    expect(parsePolygonGeometry({ type: 'Polygon', coordinates: [[[999, 0]]] })).toBeNull();
    expect(parsePolygonGeometry(null)).toBeNull();
  });

  it('accepts LineString and MultiLineString, refuses polygons', () => {
    expect(
      parseLineGeometry({ type: 'LineString', coordinates: [[-96.8, 32.77], [-96.79, 32.78]] })?.type,
    ).toBe('LineString');
    expect(parseLineGeometry(polygon)).toBeNull();
  });

  it('geoJsonFeatures returns null for non-collections', () => {
    expect(geoJsonFeatures({ type: 'FeatureCollection', features: [] })).toEqual([]);
    expect(geoJsonFeatures({ error: { message: 'bad' } })).toBeNull();
  });
});

describe('parcel normalizers', () => {
  it('normalizes a Collin GeoJSON feature with published fields only', () => {
    const feature = normalizeCollinGeoJsonFeature({
      type: 'Feature',
      geometry: polygon,
      properties: {
        propID: 12345,
        ownerName: '  Jane Doe ',
        situsConcatShort: '100 Main St',
        situsCity: 'McKinney',
        situsZip: '75069',
        landSizeAcres: 2.5,
        landTypeCode: 'RES',
        currValLand: 120000,
        currValMarket: 450000,
        currValYear: 2026,
        dataDate: '2026-10-23T00:00:00',
      },
    });
    expect(feature?.properties).toMatchObject({
      layer: 'parcels',
      county: 'collin',
      parcelId: '12345',
      ownerName: 'Jane Doe',
      acres: 2.5,
      landValue: 120000,
      vintage: 'CAD data 2026-10-23',
    });
  });

  it('normalizes a Dallas GeoJSON feature and converts square feet to acres', () => {
    const feature = normalizeDallasGeoJsonFeature({
      type: 'Feature',
      geometry: polygon,
      properties: {
        ACCT: '00000123456789012',
        TAXPANAME1: 'DOE JOHN',
        ST_NUM: '1500',
        ST_NAME: 'MARILLA',
        ST_TYPE: 'ST',
        CITY: 'DALLAS',
        AREA_FEET: 43560,
        APPRAISALYEAR: 2019,
        PROP_CL: 'Residential',
      },
    });
    expect(feature?.properties).toMatchObject({
      county: 'dallas',
      situsAddress: '1500 MARILLA ST',
      acres: 1,
      landValue: null,
      vintage: 'Appraisal year 2019 (verify current ownership with DCAD)',
    });
  });

  it('refuses features without an id or without polygon geometry', () => {
    expect(normalizeCollinGeoJsonFeature({ geometry: polygon, properties: {} })).toBeNull();
    expect(normalizeDallasGeoJsonFeature({ geometry: null, properties: { ACCT: '1' } })).toBeNull();
    expect(
      normalizeDallasGeoJsonFeature({ geometry: polygon, properties: { ACCT: 'MULTIPLE' } }),
    ).toBeNull();
  });
});

describe('NHD normalizer', () => {
  it('classifies by ftype and keeps the published name', () => {
    const feature = normalizeNhdGeoJsonFeature({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[-96.8, 32.77], [-96.79, 32.78]] },
      properties: { gnis_name: 'Turtle Creek', ftype: 460 },
    });
    expect(feature?.properties).toEqual({
      layer: 'streams',
      name: 'Turtle Creek',
      type: 'stream',
      ftype: 460,
    });
  });

  it('names unnamed segments by class, never inventing a name', () => {
    const feature = normalizeNhdGeoJsonFeature({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[-96.8, 32.77], [-96.79, 32.78]] },
      properties: { gnis_name: '  ', ftype: 558 },
    });
    expect(feature?.properties.name).toBe('Unnamed waterway');
    expect(feature?.properties.type).toBe('waterway');
  });
});

describe('fetchParcelsInBbox', () => {
  it('merges both counties and reports ok', async () => {
    const fetcher = fakeFetch({
      CCAD_Parcel_Feature_Set: {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: polygon, properties: { propID: 7, landSizeAcres: 1 } }],
      },
      DallasTaxParcels: {
        type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: polygon, properties: { ACCT: '99', AREA_FEET: 87120 } }],
      },
    });
    const result = await fetchParcelsInBbox(BBOX, fetcher);
    expect(result.status).toBe('ok');
    expect(result.features).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it('is upstream_unavailable when both services fail, never invented rows', async () => {
    const fetcher = (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    const result = await fetchParcelsInBbox(BBOX, fetcher);
    expect(result.status).toBe('upstream_unavailable');
    expect(result.features).toEqual([]);
  });

  it('is empty when the services answer with no features', async () => {
    const fetcher = fakeFetch({
      CCAD_Parcel_Feature_Set: { type: 'FeatureCollection', features: [] },
      DallasTaxParcels: { type: 'FeatureCollection', features: [] },
    });
    const result = await fetchParcelsInBbox(BBOX, fetcher);
    expect(result.status).toBe('empty');
  });
});

describe('fetchStreamsInBbox', () => {
  it('returns normalized flowlines', async () => {
    const fetcher = fakeFetch({
      nhd: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[-96.8, 32.77], [-96.79, 32.78]] },
            properties: { gnis_name: 'Coombs Creek', ftype: 460 },
          },
        ],
      },
    });
    const result = await fetchStreamsInBbox(BBOX, fetcher);
    expect(result.status).toBe('ok');
    expect(result.features[0]?.properties.name).toBe('Coombs Creek');
  });

  it('empty is not a "no water" verdict', async () => {
    const fetcher = fakeFetch({ nhd: { type: 'FeatureCollection', features: [] } });
    const result = await fetchStreamsInBbox(BBOX, fetcher);
    expect(result.status).toBe('empty');
    expect(result.message).toContain('not a "no water" verdict');
  });
});
