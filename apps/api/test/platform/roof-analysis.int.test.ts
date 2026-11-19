import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/db/runtime';
import {
  type BuildingInsights,
  type ImageryProvider,
  type ProviderResult,
  providerFailure,
} from '../../src/modules/imagery/providers';
import { runRoofAnalysis } from '../../src/modules/imagery/roof-analysis';
import { type Company, call, createCompany, createTestContext, type TestContext } from '../helpers';

const INSIGHTS: BuildingInsights = {
  provider: 'google_solar',
  providerBuildingId: 'buildings/test-place',
  center: { latitude: 32.7767, longitude: -96.797 },
  boundingBox: null,
  regionCode: 'US',
  postalCode: '75201',
  imageryDate: '2025-03-09',
  imageryProcessedDate: null,
  imageryQuality: 'HIGH',
  wholeRoofAreaM2: 200.25,
  wholeRoofGroundAreaM2: 180.5,
  maxArrayAreaM2: 80.5,
  maxSunshineHoursPerYear: 1500,
  panelCapacityWatts: 400,
  roofSegments: [{ pitchDegrees: 26.5, azimuthDegrees: 180, areaM2: 120.5, groundAreaM2: 100.25 }],
  dataUse: 'structured_insight_only',
  imageryRights: 'not_granted',
  attribution: 'Google Solar API',
};

const CAPABILITIES = {
  structuredBuildingInsights: true,
  analysisImagery: false,
  imagerySearch: false,
  contractorUpload: false,
} as const;

function fakeProvider(result: ProviderResult<BuildingInsights>) {
  let calls = 0;
  const provider: ImageryProvider = {
    id: 'google_solar',
    displayName: 'Google Solar API',
    capabilities: CAPABILITIES,
    status: () => ({
      id: 'google_solar',
      displayName: 'Google Solar API',
      state: 'configured',
      reason: null,
      capabilities: CAPABILITIES,
      attribution: 'Google Solar API',
    }),
    findBuildingInsights: async () => {
      calls += 1;
      return result;
    },
  };
  return { provider, calls: () => calls };
}

interface JobBody {
  job: {
    id: string;
    status: string;
    cached: boolean;
    confirmedAddress: string;
    confirmedLatitude: number;
    confirmedLongitude: number;
    result: BuildingInsights | null;
    errorCode: string | null;
  };
}

describe('roof analysis job', () => {
  let ctx: TestContext;
  let company: Company;

  beforeAll(async () => {
    ctx = await createTestContext({ env: { GOOGLE_SOLAR_API_KEY: '' } });
    company = await createCompany(ctx);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function createProperty(
    confirmed: boolean,
    latitude = 32.7767,
    longitude = -96.797,
  ): Promise<string> {
    const point = `SRID=4326;POINT(${longitude} ${latitude})`;
    const [row] = await ctx.owner.client<{ id: string }[]>`
      insert into properties (
        org_id, original_query, normalized_address, location, confirmed_location,
        confirmed_at, confirmed_by_user_id
      ) values (
        ${company.orgId}, '123 Solar Way', '123 Solar Way, Dallas, TX 75201',
        ${point}::geography, ${confirmed ? point : null}::geography,
        ${confirmed ? new Date().toISOString() : null}::timestamptz, ${company.owner.userId}
      ) returning id`;
    return row!.id;
  }

  async function createJob(propertyId: string): Promise<JobBody['job']> {
    const res = await call(ctx, 'POST', '/v1/roof/analysis-jobs', {
      as: company.owner,
      body: { propertyId },
    });
    expect(res.statusCode).toBe(202);
    return (res.json() as JobBody).job;
  }

  function runJob(jobId: string, provider: ImageryProvider) {
    return withTenant(ctx.appDb.db, { orgId: company.orgId, userId: company.owner.userId }, (tx) =>
      runRoofAnalysis(tx, { orgId: company.orgId, analysisJobId: jobId, provider }),
    );
  }

  it('refuses to queue an analysis until the address and pin are confirmed', async () => {
    const propertyId = await createProperty(false);
    const res = await call(ctx, 'POST', '/v1/roof/analysis-jobs', {
      as: company.owner,
      body: { propertyId },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('address_confirmation_required');
  });

  it('queues a job with the confirmed address snapshot and exposes status', async () => {
    const propertyId = await createProperty(true, 32.1, -96.1);
    const job = await createJob(propertyId);
    expect(job).toMatchObject({
      status: 'queued',
      cached: false,
      confirmedAddress: '123 Solar Way, Dallas, TX 75201',
      confirmedLatitude: 32.1,
      confirmedLongitude: -96.1,
      result: null,
    });

    const res = await call(ctx, 'GET', `/v1/roof/analysis-jobs/${job.id}`, {
      as: company.owner,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as JobBody).job.status).toBe('queued');
  });

  it('runs once, then serves a fresh succeeded result from cache without calling the provider', async () => {
    const propertyId = await createProperty(true, 32.2, -96.2);
    const firstJob = await createJob(propertyId);
    const fake = fakeProvider({ ok: true, value: INSIGHTS });

    const first = await runJob(firstJob.id, fake.provider);
    expect(first).toMatchObject({ status: 'succeeded', cached: false, errorCode: null });
    expect(fake.calls()).toBe(1);

    const secondJob = await createJob(propertyId);
    const second = await runJob(secondJob.id, fake.provider);
    expect(second).toMatchObject({ status: 'succeeded', cached: true });
    expect(fake.calls()).toBe(1);

    const res = await call(ctx, 'GET', `/v1/roof/analysis-jobs/${secondJob.id}`, {
      as: company.owner,
    });
    const body = res.json() as JobBody;
    expect(body.job.cached).toBe(true);
    expect(body.job.result).toMatchObject({
      provider: 'google_solar',
      dataUse: 'structured_insight_only',
      imageryRights: 'not_granted',
      wholeRoofAreaM2: 200.25,
    });
  });

  it('fails instead of analysing a different building when the confirmed pin moved', async () => {
    const propertyId = await createProperty(true, 32.3, -96.3);
    const job = await createJob(propertyId);
    await ctx.owner.client`
      update properties
      set confirmed_location = ST_SetSRID(ST_MakePoint(${-96.31}, ${32.31}), 4326)::geography
      where id = ${propertyId}`;
    const fake = fakeProvider({ ok: true, value: INSIGHTS });
    const result = await runJob(job.id, fake.provider);
    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'address_confirmation_required',
      retryable: false,
    });
    expect(fake.calls()).toBe(0);
  });

  it('records an unconfigured provider as a definitive failure', async () => {
    const propertyId = await createProperty(true, 32.4, -96.4);
    const job = await createJob(propertyId);
    const fake = fakeProvider(
      providerFailure('not_configured', 'GOOGLE_SOLAR_API_KEY is not set.'),
    );
    const result = await runJob(job.id, fake.provider);
    expect(result).toMatchObject({
      status: 'failed',
      errorCode: 'not_configured',
      retryable: false,
    });
  });
});
