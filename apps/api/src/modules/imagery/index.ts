// `imagery` module: imagery providers, contractor uploads and the imagery rights engine
// (RR-021..RR-024).
//
// Registered under /v1 by src/modules/registry.ts in its own encapsulation context. The provider
// status route reports real configuration only: Google Solar is listed as not_configured until a
// server-side key exists, and no adapter invents coverage or imagery. Contractor uploads reuse the
// media module's upload/processing flow, then record consent, rights and retention here; this module
// never proxies arbitrary user requests to a paid provider.
import {
  AnalysisImageryProviderSchema,
  IMAGERY_STATUSES,
  ImageryCandidatesResponseSchema,
  ImageryKindSchema,
  ImageryPerspectiveSchema,
  ImageryQualitySchema,
  RoofImageryCandidateSchema,
  RoofImageryRightsSchema,
  type RoofImageryRights,
  UuidSchema,
} from '@fieldline/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { requireOrg, tenantTx } from '../../http/context';
import { eq } from 'drizzle-orm';
import { footprintRemovals } from '../../db/schema';
import { isRemoved, ringCentroid } from '../../services/footprint-policy';
import { lookupMappedRoof } from '../../services/roof-footprint';
import { auditRequest } from '../../services/audit';
import { withdrawContractorConsent } from './consent-withdrawal';
import {
  recordContractorUpload,
  type ImageryAssetRow as ContractorAssetRow,
} from './contractor-upload';
import {
  imageryAssetToApiCandidate,
  imageryAssetToCandidate,
  ingestImageryCandidate,
  loadImageryAssets,
  loadRankableImageryCandidates,
} from './ingestion';
import { createImageryProviders } from './providers';

const ProviderStatusSchema = z.object({
  id: AnalysisImageryProviderSchema,
  displayName: z.string(),
  state: z.enum(['configured', 'not_configured']),
  reason: z.string().nullable(),
  capabilities: z.object({
    structuredBuildingInsights: z.boolean(),
    analysisImagery: z.boolean(),
    imagerySearch: z.boolean(),
    contractorUpload: z.boolean(),
  }),
  attribution: z.string().nullable(),
});

const ContractorRightsSchema = RoofImageryRightsSchema.extend({
  retentionDays: z.number().int().min(1).max(3650),
});

const ContractorUploadBodySchema = z.object({
  propertyId: UuidSchema,
  mediaAssetId: UuidSchema,
  kind: ImageryKindSchema.optional(),
  quality: ImageryQualitySchema.optional(),
  perspective: ImageryPerspectiveSchema.optional(),
  orthorectified: z.boolean().optional(),
  captureDate: z.iso.date().optional(),
  gsdM: z.number().positive().max(100).optional(),
  rights: ContractorRightsSchema,
  attribution: z.string().min(1).max(500),
  consent: z.object({
    grantedBy: z.string().min(1).max(200),
    source: z.string().min(1).max(200),
    policyVersion: z.string().min(1).max(100).optional(),
    evidence: z.record(z.string(), z.unknown()).optional(),
  }),
});

const ConsentWithdrawalAssetSchema = z.object({
  id: UuidSchema,
  status: z.enum(IMAGERY_STATUSES),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  revision: z.number().int(),
});

const ConsentWithdrawalSchema = z.object({
  consent: z.object({
    id: UuidSchema,
    supersedesId: UuidSchema,
    status: z.literal('withdrawn'),
    recordedAt: z.iso.datetime({ offset: true }),
  }),
  assets: z.array(ConsentWithdrawalAssetSchema),
  alreadyWithdrawn: z.boolean(),
});

const ContractorUploadAssetSchema = z.object({
  id: UuidSchema,
  propertyId: UuidSchema,
  mediaAssetId: UuidSchema.nullable(),
  consentId: UuidSchema.nullable(),
  provider: z.literal('contractor_upload'),
  status: z.enum(IMAGERY_STATUSES),
  kind: ImageryKindSchema,
  quality: ImageryQualitySchema,
  perspective: ImageryPerspectiveSchema,
  orthorectified: z.boolean().nullable(),
  rights: RoofImageryRightsSchema,
  attribution: z.string(),
  gsdM: z.number().nullable(),
  captureDate: z.string().nullable(),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  widthPx: z.number().int().nullable(),
  heightPx: z.number().int().nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  revision: z.number().int(),
});

function contractorAssetDto(row: ContractorAssetRow): z.infer<typeof ContractorUploadAssetSchema> {
  return {
    id: row.id,
    propertyId: row.propertyId,
    mediaAssetId: row.mediaAssetId,
    consentId: row.consentId,
    provider: 'contractor_upload',
    status: row.status,
    kind: row.kind,
    quality: row.quality,
    perspective: row.perspective,
    orthorectified: row.orthorectified,
    rights: row.rights as RoofImageryRights,
    attribution: row.attribution,
    gsdM: row.gsdM === null ? null : Number(row.gsdM),
    captureDate: row.captureDate,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    widthPx: row.widthPx,
    heightPx: row.heightPx,
    createdAt: row.createdAt.toISOString(),
    revision: row.revision,
  };
}

const LatLon = z
  .object({
    lat: z.number().finite().min(-85).max(85),
    lon: z.number().finite().min(-180).max(180),
  })
  .strict();
const Point = z.object({ lon: z.number(), lat: z.number() });
const Candidate = z.object({
  id: z.string(),
  label: z.string(),
  ring: z.array(Point).min(3).max(300),
  planAreaSqFt: z.number().positive(),
  distanceMeters: z.number().nonnegative(),
  containsTarget: z.boolean(),
  sourceUrl: z.url(),
});
const Response = z.object({
  status: z.enum(['found', 'no_footprint', 'upstream_unavailable']),
  provider: z.literal('openstreetmap'),
  message: z.string(),
  candidates: z.array(Candidate).max(5),
});

/** Public: a property owner asks for a building to be removed from the map. Nothing is hidden until staff approve it. */
const RemovalRequest = z.object({
  lat: z.number().finite().min(-85).max(85),
  lon: z.number().finite().min(-180).max(180),
  reason: z.string().trim().min(10).max(500),
}).strict();
export const footprintRemovalRoute: FastifyPluginAsyncZod = async (app) => {
  app.post('/imagery/footprint-removals', {
    config: { auth: 'none', rateLimit: { max: 5, timeWindow: '1 hour' } },
    schema: { tags: ['imagery'], summary: 'Ask for a building to be removed from the map', body: RemovalRequest,
      response: { 202: z.object({ received: z.literal(true) }) } },
  }, async (request, reply) => {
    await app.db.insert(footprintRemovals).values({
      lat: request.body.lat, lon: request.body.lon, reason: request.body.reason,
    });
    request.log.info('footprint removal request received'); // never log the address or the reason text
    reply.code(202);
    return { received: true as const };
  });
};

const imageryModule: FastifyPluginAsyncZod = async (app) => {
  await footprintRemovalRoute(app, {});
  const providers = createImageryProviders(app.config);

  app.get(
    '/imagery/providers',
    {
      config: { permission: 'imagery:read' },
      schema: {
        tags: ['imagery'],
        summary: 'Imagery providers and whether each is actually configured',
        response: { 200: z.object({ providers: z.array(ProviderStatusSchema) }) },
      },
    },
    async () => ({ providers: providers.map((provider) => provider.status()) }),
  );

  app.post(
    '/imagery/contractor-uploads',
    {
      config: { permission: 'imagery:order' },
      schema: {
        tags: ['imagery'],
        summary:
          'Register a processed contractor media asset with recorded consent, license rights and retention',
        body: ContractorUploadBodySchema,
        response: { 201: z.object({ asset: ContractorUploadAssetSchema }) },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const asset = await tenantTx(request, async (tx) => {
        const created = await recordContractorUpload(tx, {
          ...request.body,
          orgId: org.orgId,
        });
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'imagery.contractor_upload_recorded',
          resourceType: 'imagery_asset',
          resourceId: created.id,
          after: {
            propertyId: created.propertyId,
            mediaAssetId: created.mediaAssetId,
            consentId: created.consentId,
            provider: created.provider,
            rights: created.rights,
            retentionExpiresAt: created.expiresAt?.toISOString() ?? null,
          },
        });
        return created;
      });
      reply.status(201);
      return { asset: contractorAssetDto(asset) };
    },
  );

  app.post(
    '/imagery/consents/:consentId/withdrawal',
    {
      config: { permission: 'imagery:order' },
      schema: {
        tags: ['imagery'],
        summary: 'Withdraw contractor imagery consent and expire or mark linked imagery ineligible',
        params: z.object({ consentId: UuidSchema }),
        body: z.object({ reason: z.string().trim().min(1).max(1000) }),
        response: { 200: ConsentWithdrawalSchema, 201: ConsentWithdrawalSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const result = await tenantTx(request, async (tx) => {
        const withdrawn = await withdrawContractorConsent(tx, {
          orgId: org.orgId,
          consentId: request.params.consentId,
          reason: request.body.reason,
          actorUserId: org.userId,
        });
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'imagery.contractor_consent_withdrawn',
          resourceType: 'consent',
          resourceId: withdrawn.consent.id,
          reason: request.body.reason,
          before: { consentId: withdrawn.originalConsentId, status: 'granted' },
          after: {
            withdrawalConsentId: withdrawn.consent.id,
            originalConsentId: withdrawn.originalConsentId,
            assetIds: withdrawn.assets.map((asset) => asset.id),
            alreadyWithdrawn: withdrawn.alreadyWithdrawn,
          },
        });
        return withdrawn;
      });
      reply.status(result.alreadyWithdrawn ? 200 : 201);
      return {
        consent: {
          id: result.consent.id,
          supersedesId: result.consent.supersedesId!,
          status: 'withdrawn' as const,
          recordedAt: result.consent.recordedAt.toISOString(),
        },
        assets: result.assets.map((asset) => ({
          id: asset.id,
          status: asset.status,
          expiresAt: asset.expiresAt?.toISOString() ?? null,
          revision: asset.revision,
        })),
        alreadyWithdrawn: result.alreadyWithdrawn,
      };
    },
  );

  app.post(
    '/imagery/candidates',
    {
      config: { permission: 'imagery:order' },
      schema: {
        tags: ['imagery'],
        summary:
          'Ingest a normalized imagery candidate, including provider id and ranking metadata',
        body: z.object({
          propertyId: UuidSchema,
          candidate: RoofImageryCandidateSchema,
          kind: ImageryKindSchema.optional(),
          mediaAssetId: UuidSchema.optional(),
          consentId: UuidSchema.optional(),
          objectKey: z.string().min(1).max(1000).optional(),
          widthPx: z.number().int().positive().optional(),
          heightPx: z.number().int().positive().optional(),
        }),
        response: { 201: z.object({ candidate: RoofImageryCandidateSchema }) },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const candidate = await tenantTx(request, async (tx) => {
        const asset = await ingestImageryCandidate(tx, {
          orgId: org.orgId,
          propertyId: request.body.propertyId,
          candidate: request.body.candidate,
          kind: request.body.kind,
          mediaAssetId: request.body.mediaAssetId,
          consentId: request.body.consentId,
          objectKey: request.body.objectKey,
          widthPx: request.body.widthPx,
          heightPx: request.body.heightPx,
        });
        const stored = imageryAssetToCandidate(asset);
        if (!stored) throw new Error('Ingested candidate could not be read back.');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'imagery.candidate_ingested',
          resourceType: 'imagery_asset',
          resourceId: asset.id,
          after: {
            propertyId: asset.propertyId,
            provider: asset.provider,
            sourceReference: stored.sourceReference,
            captureDate: stored.captureDate,
            gsdM: stored.gsdM,
            quality: stored.quality,
            rights: stored.rights,
          },
        });
        return stored;
      });
      reply.status(201);
      return { candidate };
    },
  );

  app.get(
    '/imagery/assets',
    {
      config: { permission: 'imagery:read' },
      schema: {
        tags: ['imagery'],
        summary: 'Stored imagery assets with candidate quality, scores and processing metadata',
        querystring: z.object({ propertyId: UuidSchema }),
        response: { 200: ImageryCandidatesResponseSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        loadImageryAssets(tx, org.orgId, request.query.propertyId),
      );
      return {
        candidates: rows.flatMap((row) => {
          const candidate = imageryAssetToApiCandidate(row);
          return candidate ? [candidate] : [];
        }),
      };
    },
  );

  app.get(
    '/imagery/candidates',
    {
      config: { permission: 'imagery:read' },
      schema: {
        tags: ['imagery'],
        summary: 'Rankable imagery candidates stored for a property',
        querystring: z.object({ propertyId: UuidSchema }),
        response: { 200: z.object({ candidates: z.array(RoofImageryCandidateSchema) }) },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const candidates = await tenantTx(request, (tx) =>
        loadRankableImageryCandidates(tx, org.orgId, request.query.propertyId),
      );
      return { candidates };
    },
  );

  /** Contractor-triggered lookup of independent GIS roof footprints, not satellite pixel analysis. */
  app.post(
    '/imagery/roof-footprint',
    {
      config: { permission: 'roof_order:read', rateLimit: { max: 6, timeWindow: '1 minute' } },
      schema: {
        tags: ['imagery'],
        summary: 'Locate mapped buildings behind tree cover',
        body: LatLon,
        response: { 200: Response },
      },
    },
    async (request, reply) => {
      requireOrg(request);
      reply.header('cache-control', 'private, no-store');
      const result = await lookupMappedRoof(request.body);
      // Owner removal requests: approved zones hide footprints, and the caller is not told why.
      const removals = await app.db
        .select({ lat: footprintRemovals.lat, lon: footprintRemovals.lon, radiusM: footprintRemovals.radiusM })
        .from(footprintRemovals)
        .where(eq(footprintRemovals.status, 'approved'));
      const candidates = result.candidates.filter((c) => !isRemoved(ringCentroid(c.ring), removals));
      if (candidates.length === result.candidates.length) return result;
      return {
        ...result,
        candidates,
        status: candidates.length ? ('found' as const) : ('no_footprint' as const),
        message: candidates.length
          ? 'Mapped building footprints found near this address. Choose the correct structure and verify against the site.'
          : 'No usable mapped building outline was found here. Trace a footprint or roof facets manually.',
      };
    },
  );
};

export default imageryModule;
