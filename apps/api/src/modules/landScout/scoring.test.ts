import { describe, expect, it } from 'vitest';
import type { BuyBox, LandParcel } from '@fieldline/contracts';
import {
  classifyUse,
  ownerIsEntity,
  pricePerAcre,
  rankParcels,
  scoreInfrastructure,
  scoreParcel,
  scorePrice,
  scoreSize,
  scoreUse,
} from './scoring';

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
  vintage: 'CAD data 2026-10-23',
  source: 'Collin Central Appraisal District (ArcGIS parcel service)',
  sourceUrl: 'https://www.collincad.org/open-data-portal',
  origin: 'live',
  ...over,
});

const buyBox = (over: Partial<BuyBox> = {}): BuyBox => ({
  useType: 'industrial',
  acresMin: 20,
  acresMax: 100,
  zoning: null,
  maxHighwayMiles: 1,
  needsPower: true,
  needsWater: false,
  needsSewer: false,
  counties: ['collin', 'dallas'],
  maxPricePerAcre: 50_000,
  ...over,
});

describe('classifyUse', () => {
  it('maps Texas category codes', () => {
    expect(classifyUse('F2')).toBe('industrial');
    expect(classifyUse('F1')).toBe('commercial');
    expect(classifyUse('B2')).toBe('multifamily');
    expect(classifyUse('A1')).toBe('residential');
    expect(classifyUse('C1')).toBe('vacant');
    expect(classifyUse('D1CL')).toBe('agricultural');
    expect(classifyUse('EXEMPT')).toBe('exempt');
  });
  it('maps Dallas class text and leaves the unknown unknown', () => {
    expect(classifyUse('COMMERCIAL - VACANT PLOTTED LOTS/TRACTS')).toBe('commercial');
    expect(classifyUse('INDUSTRIAL - WAREHOUSE')).toBe('industrial');
    expect(classifyUse(null)).toBe('unknown');
    expect(classifyUse('ZZ9')).toBe('unknown');
  });
});

describe('scoreUse', () => {
  it('scores a matching industrial parcel 100', () => {
    expect(scoreUse(parcel(), buyBox()).score).toBe(100);
  });
  it('scores agricultural 50 (rezone possible), exempt 0, unknown null', () => {
    expect(scoreUse(parcel({ appraisalUse: 'D1' }), buyBox()).score).toBe(50);
    expect(scoreUse(parcel({ appraisalUse: 'EXEMPT' }), buyBox()).score).toBe(0);
    expect(scoreUse(parcel({ appraisalUse: null }), buyBox()).score).toBeNull();
  });
  it('matches the buyer zoning words against appraisal use text', () => {
    const f = scoreUse(parcel({ appraisalUse: 'INDUSTRIAL - LIGHT' }), buyBox({ zoning: 'light' }));
    expect(f.score).toBe(100);
  });
});

describe('scoreSize', () => {
  it('inside range 100, within 20% 50, far outside 0, unknown null', () => {
    expect(scoreSize(parcel(), buyBox()).score).toBe(100);
    expect(scoreSize(parcel({ acres: 115 }), buyBox()).score).toBe(50);
    expect(scoreSize(parcel({ acres: 300 }), buyBox()).score).toBe(0);
    expect(scoreSize(parcel({ acres: null }), buyBox()).score).toBeNull();
  });
});

describe('scoreInfrastructure', () => {
  it('averages known distances and notes water/sewer as unconfirmable', () => {
    const f = scoreInfrastructure(parcel(), buyBox({ needsWater: true }));
    expect(f.score).toBe(100);
    expect(f.detail).toContain('water/sewer');
  });
  it('is null when no distances are known', () => {
    const f = scoreInfrastructure(
      parcel({ highwayMiles: null, substationMiles: null }),
      buyBox(),
    );
    expect(f.score).toBeNull();
  });
  it('scales highway score to the buy-box cap', () => {
    const f = scoreInfrastructure(parcel({ highwayMiles: 1.4, substationMiles: null }), buyBox());
    expect(f.score).toBe(50);
  });
});

describe('scorePrice', () => {
  it('uses CAD land value per acre against the cap', () => {
    expect(pricePerAcre(parcel())).toBeCloseTo(50_000, 0);
    expect(scorePrice(parcel(), buyBox()).score).toBe(100);
    expect(scorePrice(parcel({ landValue: 3_700_000 }), buyBox()).score).toBe(50);
    expect(scorePrice(parcel({ landValue: 6_000_000 }), buyBox()).score).toBe(0);
  });
  it('is null without a published land value (never invented)', () => {
    expect(scorePrice(parcel({ landValue: null }), buyBox()).score).toBeNull();
  });
});

describe('scoreParcel + rankParcels', () => {
  it('renormalizes weights over known factors only', () => {
    const s = scoreParcel(parcel({ landValue: null }), buyBox());
    expect(s.factorsKnown).toBe(3);
    expect(s.total).toBe(100);
  });
  it('returns null total when nothing can be scored', () => {
    const s = scoreParcel(
      parcel({
        appraisalUse: null, acres: null, highwayMiles: null, substationMiles: null, landValue: null,
      }),
      buyBox(),
    );
    expect(s.total).toBeNull();
    expect(s.factorsKnown).toBe(0);
  });
  it('ranks higher totals first and unknown totals last', () => {
    const items = [
      { id: 'low', score: scoreParcel(parcel({ acres: 300 }), buyBox()) },
      { id: 'high', score: scoreParcel(parcel(), buyBox()) },
      { id: 'none', score: scoreParcel(parcel({ appraisalUse: null, acres: null, highwayMiles: null, substationMiles: null, landValue: null }), buyBox()) },
    ];
    expect(rankParcels(items).map((i) => i.id)).toEqual(['high', 'low', 'none']);
  });
});

describe('ownerIsEntity', () => {
  it('detects LLCs and leaves people alone', () => {
    expect(ownerIsEntity('LIBERTY VENTURE I HOLDINGS LLC')).toBe(true);
    expect(ownerIsEntity('QJR PARTNERSHIP LTD')).toBe(true);
    expect(ownerIsEntity('SMITH JOHN')).toBe(false);
    expect(ownerIsEntity(null)).toBe(false);
  });
});
