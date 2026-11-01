/**
 * `properties` module: Properties, addresses and structures.
 *
 * Geocode attribution (show in UI when displaying candidates):
 * - Nominatim/OSM: © OpenStreetMap contributors (ODbL). User-Agent FieldPro/1.0; no illegal cache.
 * - Mapbox / Google: follow each provider's attribution and caching terms when tokens are set.
 */
import {
  CreatePropertyRequestSchema,
  GeoPointSchema,
  PageQuerySchema,
  PropertyListSchema,
  PropertySchema,
  UpdatePropertyRequestSchema,
  UuidSchema,
  type Property,
} from '@fieldline/contracts';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { properties } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { afterCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { parseGeoJsonPoint, pointEwkt } from './geo';
import { GeocodeCandidateSchema, geocodeAddress } from './geocode';

const IdParams = z.object({ id: UuidSchema });
const IfMatchHeaders = z.object({ 'if-match': z.string().optional() }).loose();

/** MVP create body: contracts candidate path plus optional address/pin fields. */
const CreatePropertyBodySchema = CreatePropertyRequestSchema.extend({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  locality: z.string().max(120).optional(),
  region: z.string().max(120).optional(),
  postalCode: z.string().max(20).optional(),
  countryCode: z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/)
    .optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  location: GeoPointSchema.optional(),
});

const PatchPropertyBodySchema = UpdatePropertyRequestSchema.extend({
  line1: z.string().max(200).nullable().optional(),
  line2: z.string().max(200).nullable().optional(),
  locality: z.string().max(120).nullable().optional(),
  region: z.string().max(120).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  countryCode: z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/)
    .nullable()
    .optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  originalQuery: z.string().trim().min(3).max(300).optional(),
});

type PropertyRow = typeof properties.$inferSelect;

function addressFromRow(row: PropertyRow) {
  if (!row.line1 || !row.locality) return null;
  return {
    line1: row.line1,
    ...(row.line2 ? { line2: row.line2 } : {}),
    locality: row.locality,
    ...(row.region ? { region: row.region } : {}),
    ...(row.postalCode ? { postalCode: row.postalCode } : {}),
    countryCode: row.countryCode,
  };
}

function propertyDto(
  row: PropertyRow,
  locationJson: string | null,
  confirmedJson: string | null,
): Property {
  const conf = row.geocodeConfidence != null ? Number(row.geocodeConfidence) : null;
  return {
    id: row.id,
    orgId: row.orgId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    label: row.label,
    originalQuery: row.originalQuery,
    address: addressFromRow(row),
    normalizedAddress: row.normalizedAddress,
    geocoder: row.geocoderProvider
      ? {
          provider: row.geocoderProvider,
          placeId: row.geocoderPlaceId,
          confidence: Number.isFinite(conf) ? conf : null,
        }
      : null,
    location: parseGeoJsonPoint(locationJson),
    confirmedLocation: parseGeoJsonPoint(confirmedJson),
    needsReview: row.needsReview,
    reviewReason: row.reviewReason,
    parcelId: row.parcelId,
    jurisdictionId: row.jurisdictionId,
    isFictional: row.isFictional,
  };
}

async function loadProperty(tx: Tx, orgId: string, id: string) {
  const [row] = await tx
    .select({
      p: properties,
      locationJson: sql<string | null>`ST_AsGeoJSON(${properties.location})`,
      confirmedJson: sql<string | null>`ST_AsGeoJSON(${properties.confirmedLocation})`,
    })
    .from(properties)
    .where(and(eq(properties.orgId, orgId), eq(properties.id, id), isNull(properties.deletedAt)));
  return row ?? null;
}

const propertiesModule: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/properties',
    {
      config: { permission: 'property:write' },
      schema: {
        tags: ['properties'],
        summary: 'Create a property from an address / geocode candidate / pin',
        body: CreatePropertyBodySchema,
        response: { 201: PropertySchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const body = request.body;
      const candidate = body.candidate;
      const lon =
        body.lng ??
        body.location?.coordinates[0] ??
        body.confirmedLocation?.coordinates[0] ??
        candidate?.location.coordinates[0];
      const lat =
        body.lat ??
        body.location?.coordinates[1] ??
        body.confirmedLocation?.coordinates[1] ??
        candidate?.location.coordinates[1];
      const location = lon != null && lat != null ? pointEwkt(lon, lat) : null;
      const confirmed =
        body.confirmedLocation != null
          ? pointEwkt(body.confirmedLocation.coordinates[0], body.confirmedLocation.coordinates[1])
          : null;

      const dto = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .insert(properties)
          .values({
            orgId: org.orgId,
            label: body.label ?? null,
            originalQuery: body.originalQuery,
            line1: body.line1 ?? candidate?.address.line1 ?? null,
            line2: body.line2 ?? candidate?.address.line2 ?? null,
            locality: body.locality ?? candidate?.address.locality ?? null,
            region: body.region ?? candidate?.address.region ?? null,
            postalCode: body.postalCode ?? candidate?.address.postalCode ?? null,
            countryCode: body.countryCode ?? candidate?.address.countryCode ?? 'US',
            normalizedAddress: candidate?.label ?? null,
            geocoderProvider: candidate?.provider ?? null,
            geocoderPlaceId: candidate?.placeId ?? null,
            geocodeConfidence:
              candidate?.confidence != null ? String(candidate.confidence) : null,
            geocodedAt: candidate ? new Date() : null,
            location,
            confirmedLocation: confirmed,
            confirmedByUserId: confirmed ? org.userId : null,
            confirmedAt: confirmed ? new Date() : null,
            needsReview: candidate != null && candidate.confidence < 0.7,
            reviewReason:
              candidate != null && candidate.confidence < 0.7
                ? 'Low geocoder confidence; confirm the pin.'
                : null,
          })
          .returning();
        const loaded = await loadProperty(tx, org.orgId, row!.id);
        const out = propertyDto(loaded!.p, loaded!.locationJson, loaded!.confirmedJson);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'property.created',
          resourceType: 'property',
          resourceId: row!.id,
          after: out,
        });
        return out;
      });
      reply.status(201);
      setEtag(reply, dto.revision);
      return dto;
    },
  );

  app.get(
    '/properties',
    {
      config: { permission: 'property:read' },
      schema: {
        tags: ['properties'],
        summary: 'List properties (paginated)',
        querystring: PageQuerySchema,
        response: { 200: PropertyListSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { limit, cursor } = request.query;
      const after = decodeCursor(cursor);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select({
            p: properties,
            locationJson: sql<string | null>`ST_AsGeoJSON(${properties.location})`,
            confirmedJson: sql<string | null>`ST_AsGeoJSON(${properties.confirmedLocation})`,
          })
          .from(properties)
          .where(
            and(
              eq(properties.orgId, org.orgId),
              isNull(properties.deletedAt),
              afterCursor(properties.createdAt, properties.id, after),
            ),
          )
          .orderBy(asc(msTrunc(properties.createdAt)), asc(properties.id))
          .limit(limit + 1),
      );
      return pageResult(
        rows,
        limit,
        (r) => ({ at: r.p.createdAt, id: r.p.id }),
        (r) => propertyDto(r.p, r.locationJson, r.confirmedJson),
      );
    },
  );

  app.get(
    '/properties/:id',
    {
      config: { permission: 'property:read' },
      schema: {
        tags: ['properties'],
        summary: 'Get one property',
        params: IdParams,
        response: { 200: PropertySchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const loaded = await tenantTx(request, (tx) => loadProperty(tx, org.orgId, request.params.id));
      if (!loaded) throw problem('not_found');
      setEtag(reply, loaded.p.revision);
      return propertyDto(loaded.p, loaded.locationJson, loaded.confirmedJson);
    },
  );

  app.patch(
    '/properties/:id',
    {
      config: { permission: 'property:write' },
      schema: {
        tags: ['properties'],
        summary: 'Update pin / label / address fields (If-Match revision)',
        params: IdParams,
        headers: IfMatchHeaders,
        body: PatchPropertyBodySchema,
        response: { 200: PropertySchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const expected = parseIfMatch(request);
      const body = request.body;
      const dto = await tenantTx(request, async (tx) => {
        const current = await loadProperty(tx, org.orgId, request.params.id);
        if (!current) throw problem('not_found');
        assertRevision(current.p.revision, expected);

        let confirmedLocation: string | null | undefined;
        let confirmedByUserId: string | null | undefined;
        let confirmedAt: Date | null | undefined;
        if (body.confirmedLocation) {
          confirmedLocation = pointEwkt(
            body.confirmedLocation.coordinates[0],
            body.confirmedLocation.coordinates[1],
          );
          confirmedByUserId = org.userId;
          confirmedAt = new Date();
        } else if (body.lat != null && body.lng != null) {
          confirmedLocation = pointEwkt(body.lng, body.lat);
          confirmedByUserId = org.userId;
          confirmedAt = new Date();
        }

        const [row] = await tx
          .update(properties)
          .set({
            ...(body.label !== undefined && { label: body.label }),
            ...(body.parcelId !== undefined && { parcelId: body.parcelId }),
            ...(body.notes !== undefined && { notes: body.notes }),
            ...(body.originalQuery !== undefined && { originalQuery: body.originalQuery }),
            ...(body.line1 !== undefined && { line1: body.line1 }),
            ...(body.line2 !== undefined && { line2: body.line2 }),
            ...(body.locality !== undefined && { locality: body.locality }),
            ...(body.region !== undefined && { region: body.region }),
            ...(body.postalCode !== undefined && { postalCode: body.postalCode }),
            ...(body.countryCode !== undefined &&
              body.countryCode !== null && { countryCode: body.countryCode }),
            ...(confirmedLocation !== undefined && {
              confirmedLocation,
              confirmedByUserId,
              confirmedAt,
              needsReview: false,
              reviewReason: null,
            }),
            revision: current.p.revision + 1,
            updatedAt: new Date(),
          })
          .where(eq(properties.id, current.p.id))
          .returning();
        const loaded = await loadProperty(tx, org.orgId, row!.id);
        const before = propertyDto(current.p, current.locationJson, current.confirmedJson);
        const after = propertyDto(loaded!.p, loaded!.locationJson, loaded!.confirmedJson);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'property.updated',
          resourceType: 'property',
          resourceId: row!.id,
          before,
          after,
        });
        return after;
      });
      setEtag(reply, dto.revision);
      return dto;
    },
  );

  app.post(
    '/properties/geocode',
    {
      config: {
        permission: 'property:read',
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['properties'],
        summary:
          'Geocode an address (Mapbox/Google if configured, else OSM Nominatim). No illegal caching.',
        body: z.object({ q: z.string().trim().min(3).max(300) }),
        response: {
          200: z.object({
            candidates: z.array(GeocodeCandidateSchema),
            attribution: z.string(),
          }),
        },
      },
    },
    async (request) => {
      requireOrg(request);
      const mapbox =
        process.env.MAPBOX_ACCESS_TOKEN?.trim() ||
        process.env.MAPBOX_TOKEN?.trim() ||
        null;
      const google =
        process.env.GOOGLE_GEOCODING_API_KEY?.trim() ||
        process.env.GOOGLE_MAPS_API_KEY?.trim() ||
        null;
      const candidates = await geocodeAddress(request.body.q, {
        mapboxAccessToken: mapbox,
        googleGeocodingApiKey: google,
      });
      const provider = candidates[0]?.provider ?? (mapbox ? 'mapbox' : google ? 'google' : 'nominatim');
      const attribution =
        provider === 'nominatim'
          ? '© OpenStreetMap contributors (ODbL). Nominatim usage policy applies.'
          : provider === 'mapbox'
            ? 'Geocoding © Mapbox. Mapbox attribution required when results are shown on a map.'
            : 'Geocoding © Google. Follow Google Maps Platform Terms; do not cache beyond allowed temporary use.';
      return { candidates, attribution };
    },
  );
};

export default propertiesModule;
