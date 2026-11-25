import { describe, expect, it } from 'vitest';
import { EXTENSION_TOOLS, runExtensionTool } from './extensions';
import type { GisFeature } from './layers';

// Two 0.01° squares near Dallas that overlap by half.
const square = (id: string, west: number, south: number): GisFeature => ({
  id,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [west + 0.01, south],
        [west + 0.01, south + 0.01],
        [west, south + 0.01],
        [west, south],
      ],
    ],
  },
  properties: {},
});

const left = square('a', -96.8, 32.8);
const right = square('b', -96.795, 32.8);

describe('extension tools', () => {
  it('offers the four built-in tools', () => {
    expect(EXTENSION_TOOLS.map((t) => t.id)).toEqual(['union', 'buffer', 'intersect', 'difference']);
  });

  it('union merges overlapping squares into one outline with an honest area', () => {
    const result = runExtensionTool({ toolId: 'union', layerA: 'parcels', featuresA: [left, right] });
    expect(result.features).toHaveLength(1);
    const acres = result.features[0]?.properties.acres as number;
    // Each square ≈ 0.933 × 1.109 km ≈ 255 ac; union of two half-overlapping ≈ 383 ac.
    expect(acres).toBeGreaterThan(370);
    expect(acres).toBeLessThan(395);
    expect(result.summary).toContain('Merged 2 polygons');
  });

  it('buffer grows the outline and refuses a zero distance', () => {
    const zero = runExtensionTool({ toolId: 'buffer', layerA: 'parcels', featuresA: [left], bufferFeet: 0 });
    expect(zero.features).toEqual([]);
    expect(zero.summary).toContain('greater than 0');
    const grown = runExtensionTool({ toolId: 'buffer', layerA: 'parcels', featuresA: [left], bufferFeet: 100 });
    expect(grown.features.length).toBeGreaterThan(0);
    expect(grown.features[0]?.properties.acres as number).toBeGreaterThan(255);
  });

  it('intersect keeps only the overlap; disjoint layers say so', () => {
    const overlap = runExtensionTool({
      toolId: 'intersect',
      layerA: 'parcels',
      featuresA: [left],
      layerB: 'hail',
      featuresB: [right],
    });
    expect(overlap.features).toHaveLength(1);
    const acres = overlap.features[0]?.properties.acres as number;
    expect(acres).toBeGreaterThan(120);
    expect(acres).toBeLessThan(135);
    const disjoint = runExtensionTool({
      toolId: 'intersect',
      layerA: 'parcels',
      featuresA: [left],
      layerB: 'hail',
      featuresB: [square('far', -96.6, 32.9)],
    });
    expect(disjoint.features).toEqual([]);
    expect(disjoint.summary).toContain('do not overlap');
  });

  it('difference cuts the second layer out of the first', () => {
    const result = runExtensionTool({
      toolId: 'difference',
      layerA: 'parcels',
      featuresA: [left],
      layerB: 'streams',
      featuresB: [right],
    });
    expect(result.features).toHaveLength(1);
    const acres = result.features[0]?.properties.acres as number;
    expect(acres).toBeGreaterThan(120);
    expect(acres).toBeLessThan(135);
  });

  it('refuses point layers honestly instead of inventing polygons', () => {
    const point: GisFeature = {
      id: 'p',
      geometry: { type: 'Point', coordinates: [-96.8, 32.8] },
      properties: {},
    };
    const result = runExtensionTool({ toolId: 'union', layerA: 'permits', featuresA: [point] });
    expect(result.features).toEqual([]);
    expect(result.summary).toContain('No polygons');
  });
});
