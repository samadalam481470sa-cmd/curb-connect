import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_COLUMNS,
  LAYER_DEFS,
  apiFeatureId,
  defaultLayerStates,
  layerDef,
  permitsToFeatures,
  type PermitLeadLike,
} from './layers';

const lead = (over: Partial<PermitLeadLike>): PermitLeadLike => ({
  permitNumber: 'P-1',
  city: 'Dallas',
  address: '100 Main St',
  description: 'New single family',
  status: 'Issued',
  issuedAt: '2026-11-20T00:00:00.000Z',
  value: 250000,
  contractor: '',
  latitude: 32.7767,
  longitude: -96.797,
  projectType: 'single_family',
  score: 82,
  grade: 'B',
  sourceName: 'Dallas',
  ...over,
});

describe('layer registry', () => {
  it('defines the five workbench layers with attribute columns', () => {
    expect(LAYER_DEFS.map((d) => d.id)).toEqual(['parcels', 'permits', 'streams', 'hail', 'roofs']);
    for (const def of LAYER_DEFS) {
      expect(ATTRIBUTE_COLUMNS[def.id].length).toBeGreaterThan(0);
      expect(layerDef(def.id)).toBe(def);
    }
  });

  it('starts parcels and roofs visible, everything not loaded', () => {
    const states = defaultLayerStates();
    expect(states.parcels.visible).toBe(true);
    expect(states.roofs.visible).toBe(true);
    expect(states.hail.visible).toBe(false);
    expect(Object.values(states).every((s) => s.status === 'not_loaded')).toBe(true);
  });
});

describe('permitsToFeatures', () => {
  it('plots only permits with published coordinates and counts the rest', () => {
    const { features, withoutCoords } = permitsToFeatures([
      lead({}),
      lead({ permitNumber: 'P-2', latitude: null, longitude: null }),
      lead({ permitNumber: 'P-3', latitude: undefined, longitude: undefined }),
      lead({ permitNumber: 'P-4', latitude: 999, longitude: -96.8 }),
    ]);
    expect(features).toHaveLength(1);
    expect(features[0]?.geometry).toEqual({ type: 'Point', coordinates: [-96.797, 32.7767] });
    expect(features[0]?.properties.permitNumber).toBe('P-1');
    expect(withoutCoords).toBe(3);
  });
});

describe('apiFeatureId', () => {
  it('is stable per layer', () => {
    expect(apiFeatureId('parcels', { county: 'collin', parcelId: '123' }, 0)).toBe('parcel-collin-123');
    expect(apiFeatureId('roofs', { measurementId: 'abc', label: 'F1' }, 0)).toBe('roof-abc-F1');
    expect(apiFeatureId('streams', {}, 4)).toBe('stream-4');
    expect(apiFeatureId('hail', {}, 2)).toBe('hail-2');
  });
});
