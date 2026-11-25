import { describe, expect, it } from 'vitest';
import { defaultLayerStates } from './layers';
import {
  buildLayerSummary,
  buildLegend,
  buildSourceNotes,
  metresPerPixel,
  northArrowRotation,
  pageDimensions,
  scaleBar,
} from './printLayout';

describe('pageDimensions', () => {
  it('swaps for landscape', () => {
    expect(pageDimensions('letter', 'portrait')).toEqual({ widthIn: 8.5, heightIn: 11 });
    expect(pageDimensions('letter', 'landscape')).toEqual({ widthIn: 11, heightIn: 8.5 });
    expect(pageDimensions('tabloid', 'landscape')).toEqual({ widthIn: 17, heightIn: 11 });
  });
});

describe('scaleBar', () => {
  it('picks a nice distance that fits and labels it', () => {
    // Dallas latitude, street zoom: ~0.24 m/px → 500 ft ≈ 635 px; 200 ft ≈ 254 px.
    const bar = scaleBar(32.7767, 17, 1000);
    expect(bar.distanceFt).toBeGreaterThanOrEqual(100);
    expect(bar.widthFraction).toBeGreaterThan(0);
    expect(bar.widthFraction).toBeLessThanOrEqual(0.41);
    expect(bar.label).toMatch(/ft|mi/);
  });

  it('shrinks the nice distance as zoom increases', () => {
    const wide = scaleBar(32.7767, 12, 1000);
    const close = scaleBar(32.7767, 19, 1000);
    expect(close.distanceFt).toBeLessThan(wide.distanceFt);
  });

  it('metresPerPixel halves per zoom level', () => {
    expect(metresPerPixel(32.7767, 17)).toBeCloseTo(metresPerPixel(32.7767, 16) / 2, 6);
  });
});

describe('northArrowRotation', () => {
  it('is the inverse bearing', () => {
    expect(northArrowRotation(0)).toBe(0);
    expect(northArrowRotation(30)).toBe(-30);
    expect(northArrowRotation(-45)).toBe(45);
  });
});

describe('legend + summary + notes', () => {
  it('legend lists visible layers with their current colors', () => {
    const states = defaultLayerStates();
    states.parcels.color = '#ff0000';
    states.streams.visible = true;
    const legend = buildLegend(states);
    expect(legend).toEqual([
      { label: 'Parcels (CAD)', color: '#ff0000' },
      { label: 'Streams (NHD)', color: '#38bdf8' },
      { label: 'Traced roofs', color: '#22d3ee' },
    ]);
  });

  it('summary reports every layer with a plain status word', () => {
    const states = defaultLayerStates();
    states.parcels.status = 'ok';
    states.parcels.featureCount = 12;
    const summary = buildLayerSummary(states);
    expect(summary).toHaveLength(5);
    expect(summary[0]).toEqual({ label: 'Parcels (CAD)', featureCount: 12, status: 'Loaded' });
    expect(summary[3]).toEqual({ label: 'Hail swath', featureCount: 0, status: 'Not loaded' });
  });

  it('source notes carry imagery + visible publishers only', () => {
    const states = defaultLayerStates();
    const notes = buildSourceNotes(states);
    expect(notes[0]).toContain('Esri');
    expect(notes.some((n) => n.includes('Collin Central Appraisal District'))).toBe(true);
    expect(notes.some((n) => n.includes('National Hydrography'))).toBe(false);
  });
});
