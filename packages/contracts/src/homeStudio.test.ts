import { describe, expect, it } from 'vitest';
import { parseHouseBriefText, type HouseBriefSpec } from './homeBrief';
import {
  briefQuestions,
  parseBlsSeries,
  parseBriefExtras,
  parsePlanText,
  parseSiteContext,
  StudioHouseSettingsSchema,
  summarizeIndexes,
} from './homeStudio';

const FALLBACK: HouseBriefSpec = {
  lengthFt: 50, widthFt: 32, stories: 1, bedrooms: 3, bathrooms: 2, garage: 'two_car', wallHeightFt: 9, roofPitch: 6,
};

describe('brief extras', () => {
  it('reads budget, lot and what the person already has', () => {
    const text = 'I have 40 2x4s and 30 sheets of drywall. Build me a 4 bed 3 bath on a 60x120 lot, budget $350k';
    const extras = parseBriefExtras(text);
    expect(extras.budgetCents).toBe(35_000_000);
    expect(extras.lot).toEqual({ widthFt: 60, depthFt: 120 });
    expect(extras.onHand).toEqual(expect.arrayContaining([
      { item: 'stud_2x4', quantity: 40 },
      { item: 'drywall_sheet', quantity: 30 },
    ]));
    // The lot is not taken as the house size.
    const house = parseHouseBriefText(text, FALLBACK);
    expect(house.spec.lengthFt).toBe(50);
    expect(house.read).toEqual(expect.arrayContaining(['bedrooms', 'bathrooms']));
    expect(house.read).not.toContain('size');
  });

  it('ignores numbers that are not budgets or things on hand', () => {
    const extras = parseBriefExtras('3 bed 2 bath, 2,000 sq ft, 2 windows on the front');
    expect(extras.budgetCents).toBeNull();
    expect(extras.onHand).toEqual([]);
    expect(extras.lot).toBeNull();
  });

  it('turns acres into a lot and asks only about missing facts', () => {
    expect(parseBriefExtras('half acre lot').lot?.widthFt).toBeGreaterThan(100);
    const read = parseHouseBriefText('4 bed 3 bath two story', FALLBACK).read;
    const fields = briefQuestions(read, { budgetCents: null }).map((q) => q.field);
    expect(fields).toEqual(['size', 'garage', 'budget']);
  });
});

describe('plan text reader', () => {
  it('reads room labels, the stated area, pitch, ceiling and garage', () => {
    const text = `FIRST FLOOR PLAN  SCALE 1/4" = 1'-0"  MASTER BEDROOM 14'-0" x 16'-0"  BEDROOM 2  BEDROOM 3
      MASTER BATH  BATH 2  POWDER  KITCHEN  2-CAR GARAGE  TOTAL LIVING: 2,150 SQ FT  GARAGE 480 SQ FT
      6:12 ROOF PITCH TYP.  9'-0" CLG  58'-0"  58'-0"  40'-0"  40'-0"`;
    const out = parsePlanText(text, FALLBACK);
    expect(out.spec.bedrooms).toBe(3);
    expect(out.spec.bathrooms).toBe(3);
    expect(out.spec.garage).toBe('two_car');
    expect(out.spec.roofPitch).toBe(6);
    expect(out.spec.wallHeightFt).toBe(9);
    expect(out.spec.lengthFt * out.spec.widthFt).toBeGreaterThan(1_900);
    expect(out.read).toEqual(expect.arrayContaining(['bedrooms', 'bathrooms', 'size', 'garage', 'roofPitch', 'wallHeightFt']));
  });

  it('falls back to the defaults when the text says nothing', () => {
    const out = parsePlanText('GENERAL NOTES ONLY', FALLBACK);
    expect(out.spec).toEqual(FALLBACK);
    expect(out.read).toEqual([]);
  });
});

describe('material indexes', () => {
  const payload = {
    status: 'REQUEST_SUCCEEDED',
    Results: {
      series: [
        {
          seriesID: 'WPUIP2311001',
          data: [
            { year: '2026', period: 'M10', value: '360.0', footnotes: [{ code: 'P' }] },
            { year: '2026', period: 'M09', value: '356.4', footnotes: [{}] },
            { year: '2025', period: 'M10', value: '330.0', footnotes: [{}] },
            { year: '2024', period: 'M09', value: '316.0', footnotes: [{}] },
            { year: '2024', period: 'M13', value: '999', footnotes: [{}] },
          ],
        },
        { seriesID: 'WPU0811', data: [{ year: '2026', period: 'M10', value: 'n/a' }] },
      ],
    },
  };

  it('parses BLS rows, skips bad values and computes changes', () => {
    const data = parseBlsSeries(payload);
    expect(data.get('WPUIP2311001')).toHaveLength(4);
    expect(data.get('WPU0811')).toEqual([]);
    const { indexes, escalation } = summarizeIndexes(data);
    const all = indexes.find((i) => i.id === 'residential_inputs')!;
    expect(all.latest).toEqual({ period: '2026-10', value: 360 });
    expect(all.preliminary).toBe(true);
    expect(all.changeMonthPercent).toBe(1.01);
    expect(all.changeYearPercent).toBe(9.09);
    expect(escalation).toEqual({ fromPeriod: '2024-09', toPeriod: '2026-10', percent: 13.92 });
    expect(indexes.find((i) => i.id === 'softwood_lumber')!.latest).toBeNull();
  });

  it('returns nothing for a malformed payload', () => {
    expect(parseBlsSeries({ status: 'REQUEST_NOT_PROCESSED' }).size).toBe(0);
    expect(summarizeIndexes(new Map()).escalation).toBeNull();
  });
});

describe('site context', () => {
  it('keeps buildings, roads and trees in local metres and drops sensitive sites', () => {
    const anchor = { lat: 32.95, lon: -96.89 };
    const square = (dLat: number) => [
      { lat: anchor.lat + dLat, lon: anchor.lon }, { lat: anchor.lat + dLat, lon: anchor.lon + 0.0001 },
      { lat: anchor.lat + dLat + 0.0001, lon: anchor.lon + 0.0001 }, { lat: anchor.lat + dLat, lon: anchor.lon },
    ];
    const out = parseSiteContext({
      elements: [
        { type: 'way', id: 1, tags: { building: 'house', 'building:levels': '2' }, geometry: square(0.0003) },
        { type: 'way', id: 2, tags: { building: 'government' }, geometry: square(0.0006) },
        { type: 'way', id: 3, tags: { highway: 'residential' }, geometry: [anchor, { lat: anchor.lat, lon: anchor.lon + 0.001 }] },
        { type: 'node', id: 4, tags: { natural: 'tree' }, lat: anchor.lat + 0.0001, lon: anchor.lon },
        { type: 'way', id: 'x', tags: { building: 'yes' }, geometry: square(0.001) },
      ],
    }, anchor, (tags) => tags.building === 'government');
    expect(out.buildings).toHaveLength(1);
    expect(out.buildings[0]!.heightM).toBe(6.4);
    expect(out.buildings[0]!.ring[0]!.y).toBeCloseTo(33.4, 0);
    expect(out.roads[0]).toMatchObject({ kind: 'residential', widthM: 7 });
    expect(out.trees[0]!.y).toBeCloseTo(11.1, 0);
  });
});

describe('saved house settings', () => {
  it('rejects unknown keys and oversized maps', () => {
    expect(StudioHouseSettingsSchema.safeParse({ hack: 1 }).success).toBe(false);
    const big = Object.fromEntries(Array.from({ length: 401 }, (_, i) => [`m_${i}`, 1]));
    expect(StudioHouseSettingsSchema.safeParse({ onHand: big }).success).toBe(false);
    expect(StudioHouseSettingsSchema.safeParse({ onHand: { stud_2x4x8: 40 } }).success).toBe(true);
  });
});
