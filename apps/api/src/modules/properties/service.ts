// Property + structure persistence, jurisdiction resolution and dependent-estimate staleness
// (RF-017, RF-024, RF-077, ADD-021). All queries run in the caller's tenant transaction (RLS).
import type { GeoPoint, GeoPolygon } from '@fieldline/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import { jurisdictions, properties, structures } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { problem } from '../../http/problem';

export type PropertyRow = typeof properties.$inferSelect;
export type StructureRow = typeof structures.$inferSelect;

export interface JurisdictionCandidate {
  id: string;
  code: string;
  name: string;
  kind: 'city' | 'county' | 'state' | 'special_district' | 'unincorporated' | 'other';
  isSynthetic: boolean;
}

export interface JurisdictionResolution {
  status: 'resolved' | 'ambiguous' | 'unresolved';
  jurisdictionId: string | null;
  candidates: JurisdictionCandidate[];
}

/** WKT for a GeoJSON point (lon lat). */
export function pointWkt(p: GeoPoint): string {
  const [lon, lat] = p.coordinates;
  return `SRID=4326;POINT(${lon} ${lat})`;
}

export function polygonWkt(p: GeoPolygon): string {
  const rings = p.coordinates.map((ring) => `(${ring.map(([x, y]) => `${x} ${y}`).join(', ')})`).join(', ');
  return `SRID=4326;POLYGON(${rings})`;
}

const LOCAL_KINDS = new Set(['city', 'unincorporated']);

/**
 * RF-077: boundaries covering the point. The most local level decides: two cities (or a city and
 * an unincorporated area) claiming the point = ambiguous, so regulatory conclusions are blocked
 * until a person picks the locality. Special districts overlay and never cause ambiguity.
 */
export async function resolveJurisdiction(tx: Tx, point: GeoPoint | null): Promise<JurisdictionResolution> {
  if (!point) return { status: 'unresolved', jurisdictionId: null, candidates: [] };
  const [lon, lat] = point.coordinates;
  const rows = await tx
    .select({
      id: jurisdictions.id,
      code: jurisdictions.code,
      name: jurisdictions.name,
      kind: jurisdictions.kind,
      isSynthetic: jurisdictions.isSynthetic,
    })
    .from(jurisdictions)
    .where(
      sql`${jurisdictions.status} <> 'retired' and ${jurisdictions.boundary} is not null
          and ST_Covers(${jurisdictions.boundary}, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326))`,
    )
    .orderBy(asc(jurisdictions.code));
  const candidates = rows as JurisdictionCandidate[];
  for (const level of [LOCAL_KINDS, new Set(['county']), new Set(['state'])]) {
    const hits = candidates.filter((c) => level.has(c.kind));
    if (hits.length > 1) return { status: 'ambiguous', jurisdictionId: null, candidates };
    if (hits.length === 1) return { status: 'resolved', jurisdictionId: hits[0]!.id, candidates };
  }
  return { status: 'unresolved', jurisdictionId: null, candidates };
}

export async function loadJurisdictionCandidate(tx: Tx, id: string): Promise<JurisdictionCandidate | null> {
  const [row] = await tx
    .select({ id: jurisdictions.id, code: jurisdictions.code, name: jurisdictions.name, kind: jurisdictions.kind, isSynthetic: jurisdictions.isSynthetic, status: jurisdictions.status })
    .from(jurisdictions)
    .where(eq(jurisdictions.id, id));
  if (!row || row.status === 'retired') return null;
  const { status: _s, ...rest } = row;
  return rest as JurisdictionCandidate;
}

// ------------------------------------------------------------------ reads with geometry as GeoJSON
const geo = (col: unknown) => sql<string | null>`ST_AsGeoJSON(${col})`;

export async function loadProperty(tx: Tx, orgId: string, id: string, forUpdate = false) {
  const q = tx
    .select({ row: properties, location: geo(properties.location), confirmed: geo(properties.confirmedLocation) })
    .from(properties)
    .where(and(eq(properties.orgId, orgId), eq(properties.id, id), sql`${properties.deletedAt} is null`));
  const [found] = forUpdate ? await q.for('update', { of: properties }) : await q;
  if (!found) return null;
  return {
    ...found.row,
    locationJson: found.location ? (JSON.parse(found.location) as GeoPoint) : null,
    confirmedJson: found.confirmed ? (JSON.parse(found.confirmed) as GeoPoint) : null,
  };
}
export type LoadedProperty = NonNullable<Awaited<ReturnType<typeof loadProperty>>>;

export async function loadStructures(tx: Tx, orgId: string, propertyId: string) {
  const rows = await tx
    .select({ row: structures, footprint: geo(structures.footprint) })
    .from(structures)
    .where(and(eq(structures.orgId, orgId), eq(structures.propertyId, propertyId)))
    .orderBy(asc(structures.sortOrder), asc(structures.label));
  return rows.map((r) => ({ ...r.row, footprintJson: r.footprint ? (JSON.parse(r.footprint) as GeoPolygon) : null }));
}
export type LoadedStructure = Awaited<ReturnType<typeof loadStructures>>[number];

export async function loadStructure(tx: Tx, orgId: string, id: string) {
  const [r] = await tx
    .select({ row: structures, footprint: geo(structures.footprint) })
    .from(structures)
    .where(and(eq(structures.orgId, orgId), eq(structures.id, id)));
  if (!r) return null;
  return { ...r.row, footprintJson: r.footprint ? (JSON.parse(r.footprint) as GeoPolygon) : null };
}

// ------------------------------------------------------------------ DTOs
const num = (v: string | null) => (v === null ? null : Number(v));

export function structureDto(s: LoadedStructure) {
  return {
    id: s.id,
    orgId: s.orgId,
    revision: s.revision,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    propertyId: s.propertyId,
    label: s.label,
    kind: s.kind,
    scopeStatus: s.scopeStatus,
    footprint: s.footprintJson,
    stories: s.stories,
    candidateSource: s.candidateSource,
    detectionConfidence: num(s.detectionConfidence),
    scopeConfirmed: s.scopeConfirmed,
  };
}

export function propertyDto(p: LoadedProperty) {
  const candidates = (p.jurisdictionCandidates as JurisdictionCandidate[] | null) ?? [];
  const status = p.jurisdictionStatus as 'resolved' | 'ambiguous' | 'unresolved' | 'manual';
  return {
    id: p.id,
    orgId: p.orgId,
    revision: p.revision,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    label: p.label,
    originalQuery: p.originalQuery,
    address:
      p.line1 && p.locality
        ? {
            line1: p.line1,
            ...(p.line2 ? { line2: p.line2 } : {}),
            locality: p.locality,
            ...(p.region ? { region: p.region } : {}),
            ...(p.postalCode ? { postalCode: p.postalCode } : {}),
            countryCode: p.countryCode,
          }
        : null,
    normalizedAddress: p.normalizedAddress,
    geocoder: p.geocoderProvider
      ? {
          provider: p.geocoderProvider,
          placeId: p.geocoderPlaceId,
          confidence: num(p.geocodeConfidence),
          precision: p.geocodePrecision,
          attribution: p.geocoderAttribution,
          storable: p.geocodeStorable,
        }
      : null,
    location: p.locationJson,
    confirmedLocation: p.confirmedJson,
    needsReview: p.needsReview,
    reviewReason: p.reviewReason,
    parcelId: p.parcelId,
    jurisdictionId: p.jurisdictionId,
    jurisdiction: {
      status,
      jurisdictionId: p.jurisdictionId,
      candidates,
      manualVerificationRequired: status === 'ambiguous' || status === 'unresolved',
    },
    scopeConfirmedAt: p.scopeConfirmedAt?.toISOString() ?? null,
    isFictional: p.isFictional,
  };
}

/** The point decisions use: the person's confirmed pin wins over the geocoded point. */
export function effectivePoint(p: Pick<LoadedProperty, 'confirmedJson' | 'locationJson'>): GeoPoint | null {
  return p.confirmedJson ?? p.locationJson;
}

// ------------------------------------------------------------------ review reasons
export function withReason(current: string | null, add: string): string {
  const set = new Set((current ?? '').split(',').filter(Boolean));
  set.add(add);
  return [...set].sort().join(',');
}
export function withoutReason(current: string | null, remove: string): string | null {
  const set = new Set((current ?? '').split(',').filter(Boolean));
  set.delete(remove);
  return set.size ? [...set].sort().join(',') : null;
}

// ------------------------------------------------------------------ dependent estimates
/**
 * Marks every estimate priced for this property (directly, or via its curb projects / roof orders)
 * as stale. An approved estimate reverts to review_required (CP-059 S): its approved snapshot stays
 * immutable, but it may no longer be offered until it is repriced and approved again.
 */
export async function markDependentEstimatesStale(tx: Tx, orgId: string, propertyId: string, reason: string): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    update estimates e set
      stale_since = coalesce(e.stale_since, now()),
      stale_reason = ${reason},
      status = case when e.status = 'approved' then 'review_required'::estimate_status else e.status end,
      approved_revision_id = case when e.status = 'approved' then null else e.approved_revision_id end,
      revision = e.revision + 1
    where e.org_id = ${orgId} and e.status <> 'rejected' and (
      e.property_id = ${propertyId}
      or e.curb_project_id in (select id from curb_projects where org_id = ${orgId} and property_id = ${propertyId})
      or e.roof_order_id in (select id from roof_orders where org_id = ${orgId} and property_id = ${propertyId})
    )
    returning e.id`);
  return [...rows].map((r) => r.id);
}

export function assertFound<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw problem('not_found');
  return value;
}
