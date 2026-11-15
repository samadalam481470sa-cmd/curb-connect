// `properties` module (RF-017, RF-024, RF-077, ADD-021, COS-201-API): address search through a
// provider adapter, property creation that keeps the original query and the geocoder evidence,
// candidate structures with an explicit "which are in scope" confirmation (never assumed), pin
// relocation that keeps the original point, jurisdiction resolution from PostGIS boundaries with
// a manual locality selector and an explicit unresolved state, and structures CRUD.
// Writes that change the property aggregate go through the shared command pipeline.
import {
  AddressSearchQuerySchema,
  AddressSearchResponseSchema,
  type AddressCandidate,
  ConfirmScopeRequestSchema,
  CreatePropertyRequestSchema,
  CreateStructureRequestSchema,
  GeoPointSchema,
  CommandReceiptSchema,
  PropertySchema,
  SelectJurisdictionRequestSchema,
  StructureSchema,
  UpdateStructureRequestSchema,
  UuidSchema,
} from '@fieldline/contracts';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { properties, structures } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { idempotent } from '../../http/idempotency';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { executeResourceCommand } from '../commands/pipeline';
import { geocoder } from './geocoder';
import { registerPropertyCommands } from './commands';
import {
  assertFound,
  loadProperty,
  loadStructure,
  loadStructures,
  markDependentEstimatesStale,
  pointWkt,
  polygonWkt,
  propertyDto,
  resolveJurisdiction,
  structureDto,
} from './service';

registerPropertyCommands();

/** Below this geocoder confidence the property is flagged for confirmation (RF-017 R). */
export const GEOCODE_REVIEW_THRESHOLD = 0.8;

const IdParams = z.object({ id: UuidSchema });
const PropertyDetailSchema = PropertySchema.extend({ structures: z.array(StructureSchema) });
const CommandResponseSchema = z.object({ receipt: CommandReceiptSchema, property: PropertyDetailSchema });
const RevisionBody = z.object({ expectedRevision: z.number().int().positive() });

async function detail(tx: Parameters<Parameters<typeof tenantTx>[1]>[0], orgId: string, id: string) {
  const p = assertFound(await loadProperty(tx, orgId, id));
  const s = await loadStructures(tx, orgId, id);
  return { ...propertyDto(p), structures: s.map(structureDto) };
}

const propertiesModule: FastifyPluginAsyncZod = async (app) => {
  // ------------------------------------------------------------------ address search (read only)
  app.get(
    '/properties/address-search',
    {
      config: { permission: 'property:read' },
      schema: {
        tags: ['properties'],
        summary: 'Address autocomplete through the configured geocoder (no writes)',
        querystring: AddressSearchQuerySchema,
        response: { 200: AddressSearchResponseSchema },
      },
    },
    async (request) => ({ candidates: await geocoder().search(request.query.q) }),
  );

  // ------------------------------------------------------------------ create
  app.post(
    '/properties',
    {
      config: { permission: 'property:write' },
      schema: {
        tags: ['properties'],
        summary: 'Create a property from a picked candidate and/or a manual pin',
        body: CreatePropertyRequestSchema,
        response: { 201: PropertyDetailSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const body = request.body;
      // RF-017: never trust a client-supplied candidate blindly; re-run the search and match it.
      let candidate: AddressCandidate | null = null;
      if (body.candidate) {
        const results = await geocoder().search(body.originalQuery);
        candidate = results.find((c) => c.placeId === body.candidate!.placeId && c.provider === body.candidate!.provider) ?? null;
        if (!candidate) {
          throw problem('validation_failed', 'The picked address is not a result of this search. Search again.', {
            errors: [{ path: 'body.candidate', message: 'not returned by the geocoder for originalQuery' }],
          });
        }
      } else if (!body.confirmedLocation) {
        const results = await geocoder().search(body.originalQuery);
        if (results.length > 1) throw problem('address_ambiguous', 'Several addresses match. Pick one, or drop a pin.');
        if (results.length === 0) {
          throw problem('validation_failed', 'No address matched. Drop a pin on the map or request a site survey.', {
            errors: [{ path: 'body.confirmedLocation', message: 'required when the address is not found' }],
          });
        }
        candidate = results[0]!;
      }
      return idempotent(request, reply, {}, async (tx) => {
        const reasons: string[] = [];
        if (candidate && candidate.confidence < GEOCODE_REVIEW_THRESHOLD) reasons.push('low_geocoder_confidence');
        if (candidate && !candidate.storable && !body.confirmedLocation) reasons.push('pin_confirmation_required');
        if (!candidate) reasons.push('manual_pin_only');
        const structureCandidates = candidate?.structures ?? [];
        // RF-017 S: one rooftop-precise candidate is unambiguous; several must be confirmed.
        const autoConfirm = structureCandidates.length === 1 && candidate?.precision === 'rooftop';
        if (structureCandidates.length > 1 || (structureCandidates.length === 1 && !autoConfirm)) {
          reasons.push('confirm_structures_in_scope');
        }
        const decisionPoint = body.confirmedLocation ?? candidate?.location ?? null;
        const jurisdiction = await resolveJurisdiction(tx, decisionPoint);
        if (jurisdiction.status !== 'resolved') reasons.push(`jurisdiction_${jurisdiction.status}`);
        const now = new Date();
        const [row] = await tx
          .insert(properties)
          .values({
            orgId: org.orgId,
            label: body.label ?? null,
            originalQuery: body.originalQuery,
            line1: candidate?.address.line1 ?? null,
            line2: candidate?.address.line2 ?? null,
            locality: candidate?.address.locality ?? null,
            region: candidate?.address.region ?? null,
            postalCode: candidate?.address.postalCode ?? null,
            countryCode: candidate?.address.countryCode ?? 'US',
            normalizedAddress: candidate?.label ?? null,
            geocoderProvider: candidate?.provider ?? null,
            geocoderPlaceId: candidate?.placeId ?? null,
            geocodeConfidence: candidate ? candidate.confidence.toFixed(3) : null,
            geocodedAt: candidate ? now : null,
            geocoderAttribution: candidate?.attribution ?? null,
            geocodePrecision: candidate?.precision ?? null,
            geocodeStorable: candidate?.storable ?? false,
            // Store the provider's point only when its terms allow it.
            location: candidate?.storable ? pointWkt(candidate.location) : null,
            confirmedLocation: body.confirmedLocation ? pointWkt(body.confirmedLocation) : null,
            confirmedByUserId: body.confirmedLocation ? org.userId : null,
            confirmedAt: body.confirmedLocation ? now : null,
            needsReview: reasons.length > 0,
            reviewReason: reasons.length ? reasons.sort().join(',') : null,
            jurisdictionId: jurisdiction.jurisdictionId,
            jurisdictionStatus: jurisdiction.status,
            jurisdictionCandidates: jurisdiction.candidates,
            jurisdictionResolvedAt: now,
            scopeConfirmedAt: autoConfirm ? now : null,
            scopeConfirmedByUserId: null,
            isFictional: candidate?.isSynthetic ?? false,
          })
          .returning({ id: properties.id });
        let order = 0;
        for (const s of structureCandidates) {
          await tx.insert(structures).values({
            orgId: org.orgId,
            propertyId: row!.id,
            label: s.label,
            kind: s.kind,
            scopeStatus: 'included',
            footprint: s.footprint ? polygonWkt(s.footprint) : null,
            sortOrder: order++,
            candidateSource: candidate!.provider,
            detectionConfidence: s.detectionConfidence === null ? null : s.detectionConfidence.toFixed(3),
            scopeConfirmed: autoConfirm,
          });
        }
        const out = await detail(tx, org.orgId, row!.id);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'property.created',
          resourceType: 'property',
          resourceId: row!.id,
          after: { ...out, structures: out.structures.map((s) => s.id) },
        });
        return { status: 201, body: out };
      });
    },
  );

  // ------------------------------------------------------------------ reads
  app.get(
    '/properties',
    {
      config: { permission: 'property:read' },
      schema: {
        tags: ['properties'],
        summary: 'Properties of the active company (newest first)',
        querystring: z.object({ limit: z.coerce.number().int().min(1).max(100).default(25) }),
        response: { 200: z.object({ items: z.array(PropertySchema), nextCursor: z.string().nullable() }) },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const ids = await tx
          .select({ id: properties.id })
          .from(properties)
          .where(and(eq(properties.orgId, org.orgId), sql`${properties.deletedAt} is null`))
          .orderBy(sql`${properties.createdAt} desc`)
          .limit(request.query.limit);
        const items = [];
        for (const { id } of ids) items.push(propertyDto(assertFound(await loadProperty(tx, org.orgId, id))));
        return { items, nextCursor: null };
      });
    },
  );

  app.get(
    '/properties/:id',
    {
      config: { permission: 'property:read' },
      schema: { tags: ['properties'], summary: 'Property with structures', params: IdParams, response: { 200: PropertyDetailSchema } },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const out = await tenantTx(request, (tx) => detail(tx, org.orgId, request.params.id));
      setEtag(reply, out.revision);
      return out;
    },
  );

  // ------------------------------------------------------------------ typed commands (shared pipeline)
  app.post(
    '/properties/:id/pin',
    {
      config: { permission: 'property:write' },
      schema: {
        tags: ['properties'],
        summary: 'Relocate the map pin (original geocoded point is kept)',
        params: IdParams,
        body: RevisionBody.extend({ location: GeoPointSchema, reason: z.string().max(500).optional() }),
        response: { 200: CommandResponseSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const { receipt } = await executeResourceCommand(request, reply, {
        type: 'PropertyPinRelocated',
        aggregateId: request.params.id,
        expectedRevision: request.body.expectedRevision,
        payload: { location: request.body.location, ...(request.body.reason && { reason: request.body.reason }) },
      });
      return { receipt, property: await tenantTx(request, (tx) => detail(tx, org.orgId, request.params.id)) };
    },
  );

  app.post(
    '/properties/:id/jurisdiction',
    {
      config: { permission: 'property:write' },
      schema: {
        tags: ['properties'],
        summary: 'Manual locality selector (ambiguous or unresolved jurisdiction)',
        params: IdParams,
        body: RevisionBody.extend(SelectJurisdictionRequestSchema.shape),
        response: { 200: CommandResponseSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const { receipt } = await executeResourceCommand(request, reply, {
        type: 'PropertyJurisdictionSelected',
        aggregateId: request.params.id,
        expectedRevision: request.body.expectedRevision,
        payload: { jurisdiction_id: request.body.jurisdictionId, ...(request.body.reason && { reason: request.body.reason }) },
      });
      return { receipt, property: await tenantTx(request, (tx) => detail(tx, org.orgId, request.params.id)) };
    },
  );

  app.post(
    '/properties/:id/scope',
    {
      config: { permission: 'property:write' },
      schema: {
        tags: ['properties'],
        summary: 'Confirm which structures are in scope (every structure must be listed)',
        params: IdParams,
        body: RevisionBody.extend(ConfirmScopeRequestSchema.shape),
        response: { 200: CommandResponseSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const { receipt } = await executeResourceCommand(request, reply, {
        type: 'PropertyStructureScopeConfirmed',
        aggregateId: request.params.id,
        expectedRevision: request.body.expectedRevision,
        payload: { structures: request.body.structures.map((s) => ({ structure_id: s.structureId, scope_status: s.scopeStatus })) },
      });
      return { receipt, property: await tenantTx(request, (tx) => detail(tx, org.orgId, request.params.id)) };
    },
  );

  // ------------------------------------------------------------------ structures CRUD
  app.get(
    '/properties/:id/structures',
    {
      config: { permission: 'property:read' },
      schema: { tags: ['properties'], summary: 'Structures of a property', params: IdParams, response: { 200: z.object({ items: z.array(StructureSchema) }) } },
    },
    async (request) => {
      const org = requireOrg(request);
      return tenantTx(request, async (tx) => {
        assertFound(await loadProperty(tx, org.orgId, request.params.id));
        return { items: (await loadStructures(tx, org.orgId, request.params.id)).map(structureDto) };
      });
    },
  );

  app.post(
    '/properties/:id/structures',
    {
      config: { permission: 'property:write' },
      schema: {
        tags: ['properties'],
        summary: 'Add a structure (a person added it, so its scope is confirmed)',
        params: IdParams,
        body: CreateStructureRequestSchema,
        response: { 201: StructureSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      return idempotent(request, reply, {}, async (tx) => {
        const p = assertFound(await loadProperty(tx, org.orgId, request.params.id, true));
        const [row] = await tx
          .insert(structures)
          .values({
            orgId: org.orgId,
            propertyId: p.id,
            label: request.body.label,
            kind: request.body.kind,
            scopeStatus: request.body.scopeStatus,
            footprint: request.body.footprint ? polygonWkt(request.body.footprint) : null,
            stories: request.body.stories ?? null,
            candidateSource: 'user_added',
            scopeConfirmed: true,
          })
          .returning({ id: structures.id });
        await touchProperty(tx, org.orgId, p.id);
        await markDependentEstimatesStale(tx, org.orgId, p.id, 'structure_added');
        const out = structureDto(assertFound(await loadStructure(tx, org.orgId, row!.id)));
        await auditRequest(request, tx, { orgId: org.orgId, action: 'structure.created', resourceType: 'structure', resourceId: row!.id, after: out });
        return { status: 201, body: out };
      });
    },
  );

  app.patch(
    '/structures/:id',
    {
      config: { permission: 'property:write' },
      schema: {
        tags: ['properties'],
        summary: 'Edit a structure (If-Match: structure revision)',
        params: IdParams,
        body: UpdateStructureRequestSchema,
        response: { 200: StructureSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const expected = parseIfMatch(request);
      const out = await tenantTx(request, async (tx) => {
        const before = assertFound(await loadStructure(tx, org.orgId, request.params.id));
        assertRevision(before.revision, expected);
        const b = request.body;
        await tx
          .update(structures)
          .set({
            ...(b.label !== undefined && { label: b.label }),
            ...(b.kind !== undefined && { kind: b.kind }),
            ...(b.scopeStatus !== undefined && { scopeStatus: b.scopeStatus, scopeConfirmed: true }),
            ...(b.footprint !== undefined && { footprint: b.footprint ? polygonWkt(b.footprint) : null }),
            ...(b.stories !== undefined && { stories: b.stories }),
            revision: before.revision + 1,
          })
          .where(and(eq(structures.orgId, org.orgId), eq(structures.id, before.id)));
        await touchProperty(tx, org.orgId, before.propertyId);
        await markDependentEstimatesStale(tx, org.orgId, before.propertyId, 'structure_changed');
        const after = structureDto(assertFound(await loadStructure(tx, org.orgId, before.id)));
        await auditRequest(request, tx, { orgId: org.orgId, action: 'structure.updated', resourceType: 'structure', resourceId: before.id, before: structureDto(before), after });
        return after;
      });
      setEtag(reply, out.revision);
      return out;
    },
  );

  app.delete(
    '/structures/:id',
    {
      config: { permission: 'property:write' },
      schema: { tags: ['properties'], summary: 'Remove a structure (If-Match)', params: IdParams, response: { 204: z.null() } },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const expected = parseIfMatch(request);
      await tenantTx(request, async (tx) => {
        const before = assertFound(await loadStructure(tx, org.orgId, request.params.id));
        assertRevision(before.revision, expected);
        await tx.delete(structures).where(and(eq(structures.orgId, org.orgId), eq(structures.id, before.id)));
        await touchProperty(tx, org.orgId, before.propertyId);
        await markDependentEstimatesStale(tx, org.orgId, before.propertyId, 'structure_removed');
        await auditRequest(request, tx, { orgId: org.orgId, action: 'structure.deleted', resourceType: 'structure', resourceId: before.id, before: structureDto(before) });
      });
      reply.status(204);
      return null;
    },
  );
};

/** A structure change is a property change: bump its revision so stale editors get a 409. */
async function touchProperty(tx: Parameters<Parameters<typeof tenantTx>[1]>[0], orgId: string, propertyId: string) {
  await tx
    .update(properties)
    .set({ revision: sql`${properties.revision} + 1` })
    .where(and(eq(properties.orgId, orgId), eq(properties.id, propertyId)));
}

export default propertiesModule;
