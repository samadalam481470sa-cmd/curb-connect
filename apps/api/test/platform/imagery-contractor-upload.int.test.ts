import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Company, call, createCompany, createTestContext, type TestContext } from '../helpers';

interface WithdrawalBody {
  consent: { id: string; supersedesId: string; status: string; recordedAt: string };
  assets: { id: string; status: string; expiresAt: string | null; revision: number }[];
  alreadyWithdrawn: boolean;
}

interface ContractorAssetBody {
  asset: {
    id: string;
    propertyId: string;
    mediaAssetId: string;
    consentId: string;
    provider: 'contractor_upload';
    status: string;
    kind: string;
    quality: string;
    perspective: string;
    orthorectified: boolean | null;
    rights: {
      commercialUse: boolean;
      analysisAllowed: boolean;
      storageAllowed: boolean;
      derivativesAllowed: boolean;
      exportAllowed: boolean;
      retentionDays: number;
    };
    attribution: string;
    gsdM: number | null;
    captureDate: string | null;
    expiresAt: string | null;
    widthPx: number | null;
    heightPx: number | null;
    createdAt: string;
    revision: number;
  };
}

describe('contractor upload imagery', () => {
  let ctx: TestContext;
  let company: Company;
  let propertyId: string;
  let mediaAssetId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    company = await createCompany(ctx);
    const point = 'SRID=4326;POINT(-96.797 32.7767)';
    const [property] = await ctx.owner.client<{ id: string }[]>`
      insert into properties (org_id, original_query, normalized_address, location)
      values (${company.orgId}, '500 Contractor Way', '500 Contractor Way, Dallas, TX 75201',
        ${point}::geography)
      returning id
    `;
    propertyId = property!.id;
    mediaAssetId = await createReadyMedia(propertyId);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function createReadyMedia(forPropertyId: string): Promise<string> {
    const id = randomUUID();
    const sha256 = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
    await ctx.owner.client`
      insert into media_assets (
        id, org_id, owner_type, owner_id, kind, status, original_object_key,
        sha256, mime_type, size_bytes, width_px, height_px
      ) values (
        ${id}, ${company.orgId}, 'property', ${forPropertyId}, 'photo', 'ready',
        ${`${company.orgId}/${id}/original`}, ${sha256}, 'image/jpeg', 1200, 4032, 3024
      )
    `;
    return id;
  }

  function uploadBody(forMediaAssetId: string, overrides: Record<string, unknown> = {}) {
    return {
      propertyId,
      mediaAssetId: forMediaAssetId,
      kind: 'drone_photo',
      quality: 'high',
      perspective: 'oblique',
      orthorectified: false,
      captureDate: '2026-10-01',
      gsdM: 0.25,
      rights: {
        commercialUse: true,
        analysisAllowed: true,
        storageAllowed: true,
        derivativesAllowed: true,
        exportAllowed: true,
        retentionDays: 365,
      },
      attribution: 'Contractor upload with signed consent',
      consent: {
        grantedBy: 'casey@contractor.example',
        source: 'signed upload consent v2',
        policyVersion: '2026-01',
        evidence: { formId: 'form-42' },
      },
      ...overrides,
    };
  }

  it('records consent, rights and retention for a processed contractor asset', async () => {
    const res = await call(ctx, 'POST', '/v1/imagery/contractor-uploads', {
      as: company.owner,
      body: uploadBody(mediaAssetId),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as ContractorAssetBody;
    expect(body.asset).toMatchObject({
      propertyId,
      mediaAssetId,
      provider: 'contractor_upload',
      status: 'candidate',
      kind: 'drone_photo',
      quality: 'high',
      perspective: 'oblique',
      orthorectified: false,
      gsdM: 0.25,
      captureDate: '2026-10-01',
      attribution: 'Contractor upload with signed consent',
    });
    expect(body.asset.rights).toMatchObject({
      analysisAllowed: true,
      derivativesAllowed: true,
      retentionDays: 365,
    });
    expect(body.asset.consentId).toBeTruthy();
    expect(body.asset.expiresAt).toBeTruthy();
    const retentionDays = (Date.parse(body.asset.expiresAt!) - Date.now()) / 86_400_000;
    expect(retentionDays).toBeGreaterThan(364);
    expect(retentionDays).toBeLessThan(366);

    const [consent] = await ctx.owner.client<
      { kind: string; status: string; source: string; policy_version: string; evidence: unknown }[]
    >`
      select kind, status, source, policy_version, evidence
      from consents where id = ${body.asset.consentId}
    `;
    expect(consent).toMatchObject({
      kind: 'imagery_analysis',
      status: 'granted',
      source: 'signed upload consent v2',
      policy_version: '2026-01',
    });
    expect(consent?.evidence).toMatchObject({
      formId: 'form-42',
      grantedBy: 'casey@contractor.example',
      propertyId,
      mediaAssetId,
      retentionExpiresAt: body.asset.expiresAt,
    });

    const [asset] = await ctx.owner.client<
      {
        provider: string;
        status: string;
        media_asset_id: string;
        consent_id: string;
        expires_at: Date | string;
        rights: { retentionDays: number };
        object_key: string;
      }[]
    >`
      select provider, status, media_asset_id, consent_id, expires_at, rights, object_key
      from imagery_assets where id = ${body.asset.id}
    `;
    expect(asset).toMatchObject({
      provider: 'contractor_upload',
      status: 'candidate',
      media_asset_id: mediaAssetId,
      consent_id: body.asset.consentId,
    });
    expect(asset?.rights.retentionDays).toBe(365);
    expect(new Date(asset!.expires_at).getTime()).toBe(Date.parse(body.asset.expiresAt!));
    expect(asset?.object_key).toContain(mediaAssetId);
  });

  it('rejects a second registration of the same media file', async () => {
    const res = await call(ctx, 'POST', '/v1/imagery/contractor-uploads', {
      as: company.owner,
      body: uploadBody(mediaAssetId),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'duplicate' });
  });

  it('withdraws consent, expires linked imagery and keeps the audit trail', async () => {
    const media = await createReadyMedia(propertyId);
    const upload = await call(ctx, 'POST', '/v1/imagery/contractor-uploads', {
      as: company.owner,
      body: uploadBody(media),
    });
    expect(upload.statusCode).toBe(201);
    const asset = (upload.json() as ContractorAssetBody).asset;

    const res = await call(ctx, 'POST', `/v1/imagery/consents/${asset.consentId}/withdrawal`, {
      as: company.owner,
      body: { reason: 'Property owner withdrew permission' },
    });
    expect(res.statusCode).toBe(201);
    const withdrawal = res.json() as WithdrawalBody;
    expect(withdrawal.consent).toMatchObject({
      supersedesId: asset.consentId,
      status: 'withdrawn',
    });
    expect(withdrawal.assets).toHaveLength(1);
    expect(withdrawal.assets[0]).toMatchObject({ id: asset.id, status: 'expired' });
    expect(withdrawal.alreadyWithdrawn).toBe(false);

    const [original] = await ctx.owner.client<{ status: string }[]>`
      select status from consents where id = ${asset.consentId}
    `;
    expect(original?.status).toBe('granted');

    const [record] = await ctx.owner.client<
      { status: string; supersedes_id: string; source: string; evidence: { reason: string } }[]
    >`
      select status, supersedes_id, source, evidence
      from consents where id = ${withdrawal.consent.id}
    `;
    expect(record).toMatchObject({
      status: 'withdrawn',
      supersedes_id: asset.consentId,
      source: 'contractor_consent_withdrawal',
    });
    expect(record?.evidence.reason).toBe('Property owner withdrew permission');

    const [expired] = await ctx.owner.client<
      { status: string; expires_at: Date | string; revision: number }[]
    >`
      select status, expires_at, revision from imagery_assets where id = ${asset.id}
    `;
    expect(expired?.status).toBe('expired');
    expect(expired?.revision).toBe(asset.revision + 1);
    expect(new Date(expired!.expires_at).getTime()).toBeLessThanOrEqual(Date.now());

    const [audit] = await ctx.owner.client<
      { action: string; reason: string; after: { assetIds: string[] } }[]
    >`
      select action, reason, after from audit_events where resource_id = ${withdrawal.consent.id}
    `;
    expect(audit).toMatchObject({
      action: 'imagery.contractor_consent_withdrawn',
      reason: 'Property owner withdrew permission',
      after: { assetIds: [asset.id] },
    });

    const replay = await call(ctx, 'POST', `/v1/imagery/consents/${asset.consentId}/withdrawal`, {
      as: company.owner,
      body: { reason: 'Retry' },
    });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as WithdrawalBody).alreadyWithdrawn).toBe(true);
    const [count] = await ctx.owner.client<{ count: string }[]>`
      select count(*) from consents where supersedes_id = ${asset.consentId}
    `;
    expect(Number(count?.count)).toBe(1);

    const assets = await call(ctx, 'GET', `/v1/imagery/assets?propertyId=${propertyId}`, {
      as: company.owner,
    });
    const exposed = (
      assets.json() as { candidates: { id: string; status: string; blockers: string[] }[] }
    ).candidates.find((candidate) => candidate.id === asset.id);
    expect(exposed).toMatchObject({ status: 'expired' });
    expect(exposed?.blockers).toContain('rights_expired');
  });

  it('refuses rights that do not allow storage', async () => {
    const otherMediaId = await createReadyMedia(propertyId);
    const body = uploadBody(otherMediaId);
    const res = await call(ctx, 'POST', '/v1/imagery/contractor-uploads', {
      as: company.owner,
      body: {
        ...body,
        rights: { ...body.rights, storageAllowed: false },
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'imagery_rights_denied' });
  });
});
