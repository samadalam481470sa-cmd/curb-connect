import {
  rankImageryCandidates,
  type RoofImageryCandidate,
  type RoofImageryRights,
} from '@fieldline/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Company, call, createCompany, createTestContext, type TestContext } from '../helpers';

const rights: RoofImageryRights = {
  commercialUse: true,
  analysisAllowed: true,
  storageAllowed: true,
  derivativesAllowed: true,
  exportAllowed: true,
  retentionDays: 365,
};

const aerial: RoofImageryCandidate = {
  id: 'source-aerial-1',
  provider: 'analysis_licensed_aerial',
  sourceReference: 'vendor:aerial-1',
  captureDate: '2024-06-01',
  processingDate: '2024-06-02',
  gsdM: 0.1,
  quality: 'high',
  perspective: 'nadir',
  orthorectified: true,
  sharpnessScore: 95,
  roofVisibilityPct: 95,
  shadowPct: 2,
  georefConfidence: 95,
  buildingMatchConfidence: 95,
  rights,
  attribution: 'Licensed aerial imagery',
  retentionExpiresAt: '2027-01-01T00:00:00.000Z',
  warnings: [],
};

const naip: RoofImageryCandidate = {
  id: 'source-naip-1',
  provider: 'naip',
  sourceReference: 'naip:tx-2026',
  captureDate: '2026-10-01',
  processingDate: null,
  gsdM: 0.6,
  quality: 'medium',
  perspective: 'nadir',
  orthorectified: false,
  sharpnessScore: 45,
  roofVisibilityPct: 60,
  shadowPct: 20,
  georefConfidence: 70,
  buildingMatchConfidence: 65,
  rights,
  attribution: 'USDA NAIP',
  retentionExpiresAt: null,
  warnings: [],
};

describe('imagery ingestion', () => {
  let ctx: TestContext;
  let company: Company;
  let propertyId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    company = await createCompany(ctx);
    const point = 'SRID=4326;POINT(-96.797 32.7767)';
    const [property] = await ctx.owner.client<{ id: string }[]>`
      insert into properties (org_id, original_query, normalized_address, location)
      values (${company.orgId}, '700 Ingest Way', '700 Ingest Way, Dallas, TX 75201',
        ${point}::geography)
      returning id
    `;
    propertyId = property!.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function ingest(candidate: RoofImageryCandidate) {
    const res = await call(ctx, 'POST', '/v1/imagery/candidates', {
      as: company.owner,
      body: { propertyId, candidate },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { candidate: RoofImageryCandidate }).candidate;
  }

  it('writes provider ids and metadata, then returns a rankable candidate', async () => {
    const storedAerial = await ingest(aerial);
    expect(storedAerial).toMatchObject({
      provider: 'analysis_licensed_aerial',
      sourceReference: 'vendor:aerial-1',
      captureDate: '2024-06-01',
      processingDate: '2024-06-02',
      gsdM: 0.1,
      quality: 'high',
      perspective: 'nadir',
      orthorectified: true,
      sharpnessScore: 95,
      roofVisibilityPct: 95,
      shadowPct: 2,
      georefConfidence: 95,
      buildingMatchConfidence: 95,
      attribution: 'Licensed aerial imagery',
      retentionExpiresAt: '2027-01-01T00:00:00.000Z',
    });
    expect(storedAerial.rights).toEqual(rights);
    expect(storedAerial.id).not.toBe(aerial.id);

    const [row] = await ctx.owner.client<
      {
        provider: string;
        provider_image_id: string;
        processing_date: string;
        sharpness_score: string;
        roof_visibility_pct: string;
        shadow_pct: string;
        georef_confidence: string;
        building_match_confidence: string;
        expires_at: Date | string;
      }[]
    >`
      select provider, provider_image_id, processing_date, sharpness_score, roof_visibility_pct,
        shadow_pct, georef_confidence, building_match_confidence, expires_at
      from imagery_assets where id = ${storedAerial.id}
    `;
    expect(row).toMatchObject({
      provider: 'analysis_licensed_aerial',
      provider_image_id: 'vendor:aerial-1',
      processing_date: '2024-06-02',
    });
    expect(Number(row!.sharpness_score)).toBe(95);
    expect(Number(row!.roof_visibility_pct)).toBe(95);
    expect(Number(row!.shadow_pct)).toBe(2);
    expect(Number(row!.georef_confidence)).toBe(95);
    expect(Number(row!.building_match_confidence)).toBe(95);
    expect(new Date(row!.expires_at).toISOString()).toBe('2027-01-01T00:00:00.000Z');

    await ingest(naip);

    const list = await call(ctx, 'GET', `/v1/imagery/candidates?propertyId=${propertyId}`, {
      as: company.owner,
    });
    expect(list.statusCode).toBe(200);
    const candidates = (list.json() as { candidates: RoofImageryCandidate[] }).candidates;
    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.provider).sort()).toEqual([
      'analysis_licensed_aerial',
      'naip',
    ]);

    const assetsResponse = await call(ctx, 'GET', `/v1/imagery/assets?propertyId=${propertyId}`, {
      as: company.owner,
    });
    expect(assetsResponse.statusCode).toBe(200);
    const assets = (
      assetsResponse.json() as {
        candidates: {
          provider: string;
          quality: string;
          perspective: string;
          processingDate: string | null;
          orthorectified: boolean | null;
          sharpnessScore: number | null;
          roofVisibilityPct: number | null;
          shadowPct: number | null;
          georefConfidence: number | null;
          buildingMatchConfidence: number | null;
          rights: { derivativeMeasurementAllowed: boolean; maxRetentionDays: number | null };
          blockers: string[];
        }[];
      }
    ).candidates;
    expect(assets).toHaveLength(2);
    const aerialAsset = assets.find((asset) => asset.provider === 'analysis_licensed_aerial');
    expect(aerialAsset).toMatchObject({
      quality: 'high',
      perspective: 'nadir',
      processingDate: '2024-06-02',
      orthorectified: true,
      sharpnessScore: 95,
      roofVisibilityPct: 95,
      shadowPct: 2,
      georefConfidence: 95,
      buildingMatchConfidence: 95,
      rights: { derivativeMeasurementAllowed: true, maxRetentionDays: 365 },
      blockers: [],
    });

    const ranking = rankImageryCandidates(candidates, {
      asOf: new Date('2026-11-15T00:00:00Z'),
    });
    expect(ranking.excluded).toEqual([]);
    expect(ranking.selected?.candidate.sourceReference).toBe('vendor:aerial-1');
    expect(ranking.ranked.map((entry) => entry.candidate.provider)).toEqual([
      'analysis_licensed_aerial',
      'naip',
    ]);
  });
});
