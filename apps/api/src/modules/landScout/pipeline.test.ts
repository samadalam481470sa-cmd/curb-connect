// Ranked-pipeline export: the CSV has one row per ranked parcel, a Google Maps link per
// row, scores that match the ranking, and honest water/sewer and rail columns.
import { describe, expect, it } from 'vitest';
import type { BuyBox, LandParcel, LandScore } from '@fieldline/contracts';
import {
  PIPELINE_COLUMNS,
  googleMapsLink,
  pipelineCsv,
  pipelineFilename,
  waterSewerStatus,
  type PipelineRow,
} from './pipeline';

const buyBox = (over: Partial<BuyBox> = {}): BuyBox => ({
  useType: 'warehouse',
  acresMin: 20,
  acresMax: 100,
  zoning: null,
  maxHighwayMiles: 1,
  needsPower: true,
  needsRail: true,
  needsWater: true,
  needsSewer: false,
  counties: ['collin', 'dallas'],
  maxPricePerAcre: 50_000,
  ...over,
});

const parcel = (over: Partial<LandParcel> = {}): LandParcel => ({
  county: 'collin',
  parcelId: '46',
  ownerName: 'LIBERTY VENTURE I HOLDINGS LLC',
  ownerMailing: '1800 WAZEE ST STE 500, DENVER CO 80202-2526',
  situsAddress: '2300 W PLANO PKWY',
  city: 'PLANO',
  zip: '75075',
  acres: 64.414,
  appraisalUse: 'F2',
  landValue: 3_220_700,
  marketValue: null,
  valueYear: 2026,
  lat: 33.0059,
  lon: -96.7399,
  highwayMiles: 0.8,
  highwayName: 'SH 190',
  substationMiles: 1.5,
  substationName: 'UNKNOWN25916',
  substationKv: 345,
  railroadMiles: 0.4,
  railroadName: 'Union Pacific (UP)',
  vintage: 'CAD data 2026-10-23',
  source: 'Collin Central Appraisal District (ArcGIS parcel service)',
  sourceUrl: 'https://www.collincad.org/open-data-portal',
  origin: 'live',
  ...over,
});

const score = (total: number | null): LandScore => ({
  total,
  factorsKnown: total === null ? 0 : 4,
  use: { score: 100, weight: 0.3, detail: 'fits' },
  size: { score: 100, weight: 0.25, detail: 'fits' },
  infrastructure: { score: 100, weight: 0.25, detail: 'near' },
  price: { score: 100, weight: 0.2, detail: 'under cap' },
});

const row = (over: Partial<PipelineRow> = {}): PipelineRow => ({
  parcel: parcel(),
  score: score(92),
  signals: ['Out-of-state owner (mailing address in CO)'],
  ...over,
});

describe('googleMapsLink', () => {
  it('uses coordinates when published', () => {
    expect(googleMapsLink(parcel())).toBe('https://maps.google.com/?q=33.0059,-96.7399');
  });
  it('falls back to the situs address, and to empty without either', () => {
    expect(googleMapsLink(parcel({ lat: null, lon: null }))).toContain(
      'https://maps.google.com/?q=2300%20W%20PLANO%20PKWY',
    );
    expect(googleMapsLink(parcel({ lat: null, lon: null, situsAddress: null, city: null, zip: null }))).toBe(
      'https://maps.google.com/?q=TX',
    );
  });
});

describe('waterSewerStatus', () => {
  it('says plainly that availability is not in CAD data', () => {
    expect(waterSewerStatus(buyBox())).toContain('Not in CAD data');
    expect(waterSewerStatus(buyBox({ needsWater: false, needsSewer: false }))).toBe(
      'Not required by buy box',
    );
  });
});

describe('pipelineCsv', () => {
  it('has the header and one row per ranked parcel, in rank order', () => {
    const csv = pipelineCsv([row(), row({ parcel: parcel({ parcelId: '47' }), score: score(71) })], buyBox());
    const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe(PIPELINE_COLUMNS.join(','));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('92');
    expect(lines[1]).toContain('Strong fit');
    expect(lines[2]).toContain('71');
    expect(lines[2]).toContain('Good fit');
  });
  it('carries the Google Maps link, rail distance and owner signals per row', () => {
    const csv = pipelineCsv([row()], buyBox());
    expect(csv).toContain('https://maps.google.com/?q=33.0059,-96.7399');
    expect(csv).toContain('0.4');
    expect(csv).toContain('Union Pacific (UP)');
    expect(csv).toContain('Out-of-state owner (mailing address in CO)');
    expect(csv).toContain('Not in CAD data — confirm with city/utility');
    expect(csv).toContain('50000');
  });
  it('leaves unknown values blank and quotes fields with commas', () => {
    const csv = pipelineCsv(
      [row({ parcel: parcel({ railroadMiles: null, railroadName: null, landValue: null }) })],
      buyBox(),
    );
    expect(csv).not.toContain('Union Pacific');
    expect(csv).not.toContain('null');
    expect(csv).not.toContain('NaN');
    // An owner name with a comma is quoted so the row stays one row.
    const quoted = pipelineCsv(
      [row({ parcel: parcel({ ownerName: 'SMITH, JOHN' }) })],
      buyBox(),
    );
    expect(quoted).toContain('"SMITH, JOHN"');
  });
  it('labels an unscored parcel honestly', () => {
    const csv = pipelineCsv([row({ score: score(null) })], buyBox());
    expect(csv).toContain('Not enough data to score');
  });
});

describe('pipelineFilename', () => {
  it('is a dated csv name', () => {
    expect(pipelineFilename(new Date('2026-11-24T12:00:00Z'))).toBe(
      'land-scout-pipeline-2026-11-24.csv',
    );
  });
});
