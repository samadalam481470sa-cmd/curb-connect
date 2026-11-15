// `imagery` module (RF-022, RR-031, COS-202, COS-213, COS-214, ADD-020, ADD-022, ADD-024, ADD-038):
// provider candidates with license rights, contractor-supplied imagery with asserted rights, and
// rights decisions per use. Inference, caching and PDF embedding are gated independently by
// ./rights.ts wherever they happen (roof module, exports module).
import {
  ContractorImageryRequestSchema,
  ImageryAssetSchema,
  ImagerySearchQuerySchema,
  RightsDecisionSchema,
  UuidSchema,
} from '@fieldline/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { imageryAssets } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { effectivePoint, loadProperty } from '../properties/service';
import { imageryProviders } from './providers';
import { decideAll, parseLicense } from './rights';
import { imageryDto, requireImagery } from './service';

const imageryModule: FastifyPluginAsyncZod = async (app) => {
  // Candidate search stores provider metadata + rights (no pixels are fetched or cached here).
  app.post(
    '/imagery/search',
    {
      config: { permission: 'imagery:order' },
      schema: {
        tags: ['imagery'],
        summary: 'Find imagery candidates for a property and record their license rights',
        body: ImagerySearchQuerySchema,
        response: { 200: z.object({ items: z.array(ImageryAssetSchema), unavailable: z.array(z.string()) }) },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const property = await loadProperty(tx, org.orgId, request.body.propertyId);
        if (!property) throw problem('not_found', 'Property not found.');
        const pt = effectivePoint(property);
        if (!pt) throw problem('validation_failed', 'The property has no confirmed location yet.');
        const point = { lon: pt.coordinates[0], lat: pt.coordinates[1] };
        const unavailable: string[] = [];
        const items = [];
        for (const adapter of imageryProviders()) {
          if (request.body.provider && adapter.id !== request.body.provider) continue;
          let found;
          try {
            found = await adapter.candidates(point);
          } catch {
            // ADD-038: one provider outage never blocks the others or manual tracing.
            unavailable.push(adapter.id);
            continue;
          }
          if (found.length === 0) unavailable.push(adapter.id);
          for (const c of found) {
            await tx
              .insert(imageryAssets)
              .values({
                orgId: org.orgId,
                propertyId: property.id,
                provider: c.provider,
                providerImageId: c.providerImageId,
                kind: c.kind,
                status: 'candidate',
                rights: c.rights,
                attribution: c.attribution,
                gsdM: c.gsdM === null ? null : String(c.gsdM),
                captureDate: c.captureDate,
                georef: c.georef,
                widthPx: c.widthPx,
                heightPx: c.heightPx,
                expiresAt: c.rights.expiresAt ? new Date(c.rights.expiresAt) : null,
              })
              .onConflictDoNothing();
            const [row] = await tx
              .select()
              .from(imageryAssets)
              .where(and(eq(imageryAssets.orgId, org.orgId), eq(imageryAssets.provider, c.provider), eq(imageryAssets.providerImageId, c.providerImageId)));
            if (row && row.propertyId === property.id) items.push(imageryDto(row));
          }
        }
        return { items, unavailable };
      });
    },
  );

  app.post(
    '/imagery/contractor',
    {
      config: { permission: 'imagery:order' },
      schema: {
        tags: ['imagery'],
        summary: 'Register contractor imagery (drone photo, blueprint) with asserted rights',
        body: ContractorImageryRequestSchema,
        response: { 201: ImageryAssetSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const b = request.body;
      const row = await tenantTx(request, async (tx) => {
        const property = await loadProperty(tx, org.orgId, b.propertyId);
        if (!property) throw problem('not_found', 'Property not found.');
        const now = new Date();
        const rights = {
          rightsVersion: 1 as const,
          visualize: true,
          analyze: b.rights.analyze,
          cache: b.rights.cache,
          embedInExports: b.rights.embedInExports,
          redistribute: b.rights.redistribute,
          expiresAt: b.rights.expiresAt,
          attributionRequired: true,
          licenseRef: b.rights.licenseRef,
          assertedBy: { userId: org.userId, at: now.toISOString(), statement: b.rightsStatement },
          isSynthetic: false,
        };
        const [inserted] = await tx
          .insert(imageryAssets)
          .values({
            orgId: org.orgId,
            propertyId: b.propertyId,
            provider: 'contractor_upload',
            providerImageId: `upload-${crypto.randomUUID()}`,
            kind: b.kind,
            status: 'ingested',
            rights,
            attribution: b.attribution,
            gsdM: b.gsdM === undefined ? null : String(b.gsdM),
            captureDate: b.captureDate ?? null,
            georef: b.georef ?? null,
            mediaAssetId: b.mediaAssetId ?? null,
            expiresAt: rights.expiresAt ? new Date(rights.expiresAt) : null,
          })
          .returning();
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'imagery.contractor_registered',
          resourceType: 'imagery_asset',
          resourceId: inserted!.id,
          after: { kind: b.kind, rights, attribution: b.attribution },
        });
        return inserted!;
      });
      reply.status(201);
      return imageryDto(row);
    },
  );

  app.get(
    '/imagery/assets',
    {
      config: { permission: 'imagery:read' },
      schema: {
        tags: ['imagery'],
        summary: 'Imagery assets of a property',
        querystring: z.object({ propertyId: UuidSchema }),
        response: { 200: z.object({ items: z.array(ImageryAssetSchema), nextCursor: z.string().nullable() }) },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const rows = await tx
          .select()
          .from(imageryAssets)
          .where(and(eq(imageryAssets.orgId, org.orgId), eq(imageryAssets.propertyId, request.query.propertyId)))
          .orderBy(desc(imageryAssets.createdAt), sql`${imageryAssets.id}`);
        return { items: rows.map((r) => imageryDto(r)), nextCursor: null };
      });
    },
  );

  app.get(
    '/imagery/assets/:id',
    {
      config: { permission: 'imagery:read' },
      schema: { tags: ['imagery'], params: z.object({ id: UuidSchema }), response: { 200: ImageryAssetSchema } },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => imageryDto(await requireImagery(tx, org.orgId, request.params.id)));
    },
  );

  app.get(
    '/imagery/assets/:id/rights',
    {
      config: { permission: 'imagery:read' },
      schema: {
        tags: ['imagery'],
        summary: 'Rights engine decisions per use (visualize, analyze, cache, embed_in_exports, redistribute)',
        params: z.object({ id: UuidSchema }),
        response: { 200: z.object({ decisions: z.array(RightsDecisionSchema) }) },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const row = await requireImagery(tx, org.orgId, request.params.id);
        return { decisions: decideAll(parseLicense(row.rights)) };
      });
    },
  );
};

export default imageryModule;
