import { describe, expect, it } from 'vitest';
import { collectText, documentFor, renderToBuffer } from '../index';
import type { MapPlanSheetSnapshot } from '../snapshots';

// A 1x1 transparent PNG, enough for the renderer to lay out the map frame.
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const fixture: MapPlanSheetSnapshot = {
  kind: 'map_plan_sheet',
  meta: {
    documentId: 'MAP-2026-11-25-1234',
    revision: 1,
    issuedAt: '2026-11-25T12:00:00.000Z',
    organization: { name: 'Alam Construction LLC' },
    productName: 'Field Pro',
  },
  title: 'Turtle Creek parcels',
  pageSize: 'LETTER',
  orientation: 'landscape',
  mapImageDataUrl: TINY_PNG,
  centerLat: 32.7767,
  centerLon: -96.797,
  zoom: 16,
  bearing: 30,
  scaleBarLabel: '500 ft',
  scaleBarWidthFraction: 0.2,
  legend: [
    { label: 'Parcels (CAD)', color: '#f5c451' },
    { label: 'Streams (NHD)', color: '#38bdf8' },
  ],
  layerSummary: [
    { label: 'Parcels (CAD)', featureCount: 42, status: 'Loaded' },
    { label: 'Streams (NHD)', featureCount: 3, status: 'Loaded' },
    { label: 'Hail swath', featureCount: 0, status: 'Not loaded' },
  ],
  sourceNotes: [
    'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community.',
    'Parcels: Collin Central Appraisal District + Dallas Central Appraisal District parcel services.',
    'Streams: USGS National Hydrography Dataset (NHD), The National Map.',
  ],
};

describe('GIS workbench plan sheet PDF', () => {
  it('says DRAFT plan sheet, carries legend, scale and source notes', async () => {
    const text = collectText(documentFor(fixture));
    expect(text).toContain('Turtle Creek parcels');
    expect(text).toContain('DRAFT PLAN SHEET — not a survey');
    expect(text).toContain('Parcels (CAD)');
    expect(text).toContain('Streams (NHD)');
    expect(text).toContain('500 ft');
    expect(text).toContain('(scale approximate at map centre)');
    expect(text).toContain('Centre 32.77670°, -96.79700°');
    expect(text).toContain('USGS National Hydrography Dataset (NHD), The National Map.');
    expect(text).toContain('42');
    const pdf = await renderToBuffer(fixture);
    expect(pdf.pageCount).toBeGreaterThan(0);
    expect(pdf.sha256).toHaveLength(64);
  });

  it('renders portrait tabloid with an empty legend honestly', async () => {
    const empty: MapPlanSheetSnapshot = {
      ...fixture,
      pageSize: 'TABLOID',
      orientation: 'portrait',
      bearing: 0,
      legend: [],
      layerSummary: [],
    };
    const text = collectText(documentFor(empty));
    expect(text).toContain('No data layers were visible in this view.');
    const pdf = await renderToBuffer(empty);
    expect(pdf.pageCount).toBeGreaterThan(0);
  });
});
