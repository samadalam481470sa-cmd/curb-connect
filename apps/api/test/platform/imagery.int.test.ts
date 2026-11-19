import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Company, call, createCompany, createTestContext, type TestContext } from '../helpers';

interface ProviderStatusBody {
  providers: {
    id: string;
    displayName: string;
    state: 'configured' | 'not_configured';
    reason: string | null;
    capabilities: Record<string, boolean>;
  }[];
}

describe('imagery provider status', () => {
  let ctx: TestContext;
  let company: Company;

  beforeAll(async () => {
    // Explicitly clear the key so this test asserts the real unconfigured state even when the
    // developer's environment has a Google Solar key.
    ctx = await createTestContext({ env: { GOOGLE_SOLAR_API_KEY: '' } });
    company = await createCompany(ctx);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('requires authentication', async () => {
    const res = await call(ctx, 'GET', '/v1/imagery/providers');
    expect(res.statusCode).toBe(401);
  });

  it('stores analysis provider ids and candidate metadata', async () => {
    const enumRows = await ctx.owner.client<{ typname: string; enumlabel: string }[]>`
      select t.typname, e.enumlabel
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      where t.typname in ('imagery_provider', 'imagery_quality', 'imagery_perspective')
      order by t.typname, e.enumsortorder
    `;
    const labels = (name: string) =>
      enumRows.filter((row) => row.typname === name).map((row) => row.enumlabel);
    expect(labels('imagery_provider')).toEqual(
      expect.arrayContaining([
        'fixture',
        'contractor_upload',
        'google_solar',
        'analysis_licensed_aerial',
        'naip',
        'local_gis',
        'lidar',
      ]),
    );
    expect(labels('imagery_quality')).toEqual(
      expect.arrayContaining(['high', 'medium', 'low', 'base', 'unknown']),
    );
    expect(labels('imagery_perspective')).toEqual(
      expect.arrayContaining(['nadir', 'oblique', 'unknown']),
    );

    const columns = await ctx.owner.client<
      { column_name: string; udt_name: string; is_nullable: string }[]
    >`
      select column_name, udt_name, is_nullable
      from information_schema.columns
      where table_schema = 'public' and table_name = 'imagery_assets'
    `;
    const byName = Object.fromEntries(columns.map((column) => [column.column_name, column]));
    expect(byName.processing_date).toMatchObject({ udt_name: 'date', is_nullable: 'YES' });
    expect(byName.quality).toMatchObject({ udt_name: 'imagery_quality', is_nullable: 'NO' });
    expect(byName.perspective).toMatchObject({
      udt_name: 'imagery_perspective',
      is_nullable: 'NO',
    });
    for (const name of [
      'orthorectified',
      'sharpness_score',
      'roof_visibility_pct',
      'shadow_pct',
      'georef_confidence',
      'building_match_confidence',
    ]) {
      expect(byName[name], name).toBeDefined();
      expect(byName[name]?.is_nullable, name).toBe('YES');
    }
    expect(byName.orthorectified?.udt_name).toBe('bool');
    expect(byName.sharpness_score?.udt_name).toBe('numeric');
  });

  it('lists Google Solar as not configured instead of pretending it works', async () => {
    const res = await call(ctx, 'GET', '/v1/imagery/providers', { as: company.owner });
    expect(res.statusCode).toBe(200);
    const body = res.json() as ProviderStatusBody;
    const solar = body.providers.find((provider) => provider.id === 'google_solar');
    expect(solar).toMatchObject({
      id: 'google_solar',
      state: 'not_configured',
      capabilities: {
        structuredBuildingInsights: true,
        analysisImagery: false,
        imagerySearch: false,
        contractorUpload: false,
      },
    });
    expect(solar?.reason).toContain('GOOGLE_SOLAR_API_KEY');
    expect(body.providers.find((provider) => provider.id === 'contractor_upload')).toMatchObject({
      id: 'contractor_upload',
      state: 'configured',
      capabilities: {
        structuredBuildingInsights: false,
        analysisImagery: true,
        imagerySearch: false,
        contractorUpload: true,
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/api[_-]?key"?\s*[:=]\s*"[^"]+"/i);
  });
});
