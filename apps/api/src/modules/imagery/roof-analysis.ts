// Roof analysis runs for the Google Solar adapter (ROOF-AI-001).
//
// Safety rules:
//   - Only a property with a human-confirmed pin and confirmation timestamp may be analysed.
//   - The job snapshots that address and those coordinates. If either changes before the worker
//     runs, the job fails instead of quietly analysing a different building.
//   - Solar returns structured insights only, never measurement pixels. They are stored as a
//     candidate/reference result for review, not as certified roof geometry.
//   - A succeeded job is the cache: a run for the same provider + rounded coordinates reuses the
//     newest succeeded result for 30 days, so quota is not spent twice.
import { and, desc, eq, gte, ne, sql } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { auditEvents, properties, roofAnalysisJobs, roofOrders } from '../../db/schema';
import { problem } from '../../http/problem';
import { enqueue } from '../../jobs/outbox';
import type { BuildingInsights, ImageryProvider, ProviderErrorCode } from './providers';

/** Google imagery/insight metadata changes slowly; 30 days avoids repeat quota for re-opens. */
export const SOLAR_ANALYSIS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const CACHE_VERSION = 'v1';
const REQUIRED_QUALITY = 'HIGH';

export type RoofAnalysisJobRow = typeof roofAnalysisJobs.$inferSelect;
type RunFailureCode = ProviderErrorCode | 'address_confirmation_required';

export interface ConfirmedPropertyLocation {
  propertyId: string;
  address: string;
  latitude: number;
  longitude: number;
  confirmedAt: Date;
  confirmedByUserId: string | null;
}

export type PropertyConfirmation =
  | { kind: 'confirmed'; location: ConfirmedPropertyLocation }
  | { kind: 'not_found' }
  | { kind: 'unconfirmed'; propertyId: string; reason: 'missing_pin' | 'missing_confirmation' };

/**
 * Stable cache key: provider version + six decimal places (about 0.1 m) + required quality.
 * Six places distinguishes neighbouring buildings without treating sub-centimetre drift as a
 * different location.
 */
export function solarCacheKey(latitude: number, longitude: number): string {
  return `google_solar:${CACHE_VERSION}:${latitude.toFixed(6)}:${longitude.toFixed(6)}:${REQUIRED_QUALITY}`;
}

/** Reads the property and its confirmed pin inside the caller's tenant transaction. */
export async function loadConfirmedProperty(
  tx: Tx,
  orgId: string,
  propertyId: string,
): Promise<PropertyConfirmation> {
  const [row] = await tx
    .select({
      id: properties.id,
      address: sql<
        string | null
      >`coalesce(nullif(${properties.normalizedAddress}, ''), nullif(${properties.line1}, ''), ${properties.originalQuery})`,
      latitude: sql<
        number | null
      >`case when ${properties.confirmedLocation} is null then null else ST_Y((${properties.confirmedLocation})::geometry) end`,
      longitude: sql<
        number | null
      >`case when ${properties.confirmedLocation} is null then null else ST_X((${properties.confirmedLocation})::geometry) end`,
      confirmedAt: properties.confirmedAt,
      confirmedByUserId: properties.confirmedByUserId,
      deletedAt: properties.deletedAt,
    })
    .from(properties)
    .where(and(eq(properties.orgId, orgId), eq(properties.id, propertyId)))
    .limit(1);

  if (!row || row.deletedAt) return { kind: 'not_found' };
  if (row.latitude === null || row.longitude === null) {
    return { kind: 'unconfirmed', propertyId, reason: 'missing_pin' };
  }
  if (!row.confirmedAt) {
    return { kind: 'unconfirmed', propertyId, reason: 'missing_confirmation' };
  }
  return {
    kind: 'confirmed',
    location: {
      propertyId,
      address: row.address ?? 'Confirmed property',
      latitude: row.latitude,
      longitude: row.longitude,
      confirmedAt: row.confirmedAt,
      confirmedByUserId: row.confirmedByUserId,
    },
  };
}

export interface RequestRoofAnalysisInput {
  orgId: string;
  propertyId: string;
  roofOrderId?: string | null;
  requestedByUserId: string;
  correlationId?: string | null;
}

/**
 * Creates a queued analysis job in the caller's transaction, so the outbox job and the row commit
 * together. Throws `address_confirmation_required` until a person has confirmed the pin/address.
 */
export async function requestRoofAnalysis(
  tx: Tx,
  input: RequestRoofAnalysisInput,
): Promise<RoofAnalysisJobRow> {
  const confirmation = await loadConfirmedProperty(tx, input.orgId, input.propertyId);
  if (confirmation.kind === 'not_found') throw problem('not_found');
  if (confirmation.kind === 'unconfirmed') {
    throw problem(
      'address_confirmation_required',
      confirmation.reason === 'missing_pin'
        ? 'Drop the roof pin on the correct building and confirm it before analysis.'
        : 'Confirm the property address before requesting a roof analysis.',
    );
  }

  if (input.roofOrderId) {
    const [order] = await tx
      .select({ id: roofOrders.id })
      .from(roofOrders)
      .where(
        and(
          eq(roofOrders.orgId, input.orgId),
          eq(roofOrders.id, input.roofOrderId),
          eq(roofOrders.propertyId, input.propertyId),
        ),
      )
      .limit(1);
    if (!order) throw problem('not_found', 'No such roof order for this property.');
  }

  const { location } = confirmation;
  const [job] = await tx
    .insert(roofAnalysisJobs)
    .values({
      orgId: input.orgId,
      propertyId: input.propertyId,
      roofOrderId: input.roofOrderId ?? null,
      requestedByUserId: input.requestedByUserId,
      provider: 'google_solar',
      cacheKey: solarCacheKey(location.latitude, location.longitude),
      confirmedAddress: location.address,
      confirmedLatitude: location.latitude,
      confirmedLongitude: location.longitude,
      status: 'queued',
    })
    .returning();
  if (!job) throw new Error('roof analysis job insert returned no row');

  await enqueue(tx, {
    orgId: input.orgId,
    task: 'roof.analysis',
    aggregateType: 'roof_analysis_job',
    aggregateId: job.id,
    payload: { analysisJobId: job.id },
    correlationId: input.correlationId ?? null,
    jobKey: `roof.analysis:${job.id}`,
  });
  return job;
}

export interface RunRoofAnalysisInput {
  orgId: string;
  analysisJobId: string;
  provider: ImageryProvider;
  now?: Date;
  cacheTtlMs?: number;
}

export interface RoofAnalysisRunResult {
  status: 'succeeded' | 'failed' | 'skipped';
  cached: boolean;
  errorCode: RunFailureCode | null;
  retryable: boolean;
}

async function failJob(
  tx: Tx,
  job: RoofAnalysisJobRow,
  code: RunFailureCode,
  message: string,
  retryable: boolean,
): Promise<RoofAnalysisRunResult> {
  await tx
    .update(roofAnalysisJobs)
    .set({
      status: 'failed',
      errorCode: code,
      errorMessage: message.slice(0, 500),
      finishedAt: new Date(),
      revision: sql`${roofAnalysisJobs.revision} + 1`,
    })
    .where(and(eq(roofAnalysisJobs.orgId, job.orgId), eq(roofAnalysisJobs.id, job.id)));
  await tx.insert(auditEvents).values({
    orgId: job.orgId,
    actorType: 'worker',
    actorLabel: 'roof.analysis',
    action: 'roof.analysis_failed',
    resourceType: 'roof_analysis_job',
    resourceId: job.id,
    after: { provider: job.provider, errorCode: code, retryable },
  });
  return { status: 'failed', cached: false, errorCode: code, retryable };
}

/**
 * Worker side of the run. Idempotent: a succeeded job returns immediately, and a retry re-runs a
 * failed/running job against the same snapped coordinates. The property's current confirmation is
 * checked again before any provider call.
 */
export async function runRoofAnalysis(
  tx: Tx,
  input: RunRoofAnalysisInput,
): Promise<RoofAnalysisRunResult> {
  const now = input.now ?? new Date();
  const [job] = await tx
    .select()
    .from(roofAnalysisJobs)
    .where(
      and(eq(roofAnalysisJobs.orgId, input.orgId), eq(roofAnalysisJobs.id, input.analysisJobId)),
    )
    .limit(1);
  if (!job) return { status: 'skipped', cached: false, errorCode: null, retryable: false };
  if (job.status === 'succeeded') {
    return { status: 'succeeded', cached: job.cached, errorCode: null, retryable: false };
  }

  await tx
    .update(roofAnalysisJobs)
    .set({
      status: 'running',
      startedAt: now,
      errorCode: null,
      errorMessage: null,
      revision: sql`${roofAnalysisJobs.revision} + 1`,
    })
    .where(and(eq(roofAnalysisJobs.orgId, job.orgId), eq(roofAnalysisJobs.id, job.id)));

  const confirmation = await loadConfirmedProperty(tx, job.orgId, job.propertyId);
  if (confirmation.kind !== 'confirmed') {
    return failJob(
      tx,
      job,
      'address_confirmation_required',
      'The property is no longer confirmed. Re-confirm the address and request a new analysis.',
      false,
    );
  }
  const { location } = confirmation;
  if (
    Math.abs(location.latitude - job.confirmedLatitude) > 1e-6 ||
    Math.abs(location.longitude - job.confirmedLongitude) > 1e-6
  ) {
    return failJob(
      tx,
      job,
      'address_confirmation_required',
      'The confirmed roof pin changed after this analysis was requested. Request a new analysis.',
      false,
    );
  }

  const cutoff = new Date(now.getTime() - (input.cacheTtlMs ?? SOLAR_ANALYSIS_CACHE_TTL_MS));
  const [cached] = await tx
    .select({ result: roofAnalysisJobs.result })
    .from(roofAnalysisJobs)
    .where(
      and(
        eq(roofAnalysisJobs.orgId, job.orgId),
        eq(roofAnalysisJobs.status, 'succeeded'),
        eq(roofAnalysisJobs.cacheKey, job.cacheKey),
        gte(roofAnalysisJobs.finishedAt, cutoff),
        ne(roofAnalysisJobs.id, job.id),
      ),
    )
    .orderBy(desc(roofAnalysisJobs.finishedAt))
    .limit(1);

  if (cached && cached.result !== null) {
    await tx
      .update(roofAnalysisJobs)
      .set({
        status: 'succeeded',
        result: cached.result,
        cached: true,
        finishedAt: new Date(),
        revision: sql`${roofAnalysisJobs.revision} + 1`,
      })
      .where(and(eq(roofAnalysisJobs.orgId, job.orgId), eq(roofAnalysisJobs.id, job.id)));
    return { status: 'succeeded', cached: true, errorCode: null, retryable: false };
  }

  const insights = await input.provider.findBuildingInsights({
    latitude: location.latitude,
    longitude: location.longitude,
    requiredQuality: REQUIRED_QUALITY,
  });
  if (!insights.ok) {
    return failJob(tx, job, insights.code, insights.message, insights.retryable);
  }

  const value: BuildingInsights = insights.value;
  await tx
    .update(roofAnalysisJobs)
    .set({
      status: 'succeeded',
      result: value,
      cached: false,
      errorCode: null,
      errorMessage: null,
      finishedAt: new Date(),
      revision: sql`${roofAnalysisJobs.revision} + 1`,
    })
    .where(and(eq(roofAnalysisJobs.orgId, job.orgId), eq(roofAnalysisJobs.id, job.id)));
  await tx.insert(auditEvents).values({
    orgId: job.orgId,
    actorType: 'worker',
    actorLabel: 'roof.analysis',
    action: 'roof.analysis_succeeded',
    resourceType: 'roof_analysis_job',
    resourceId: job.id,
    after: {
      provider: value.provider,
      imageryQuality: value.imageryQuality,
      dataUse: value.dataUse,
      imageryRights: value.imageryRights,
    },
  });
  return { status: 'succeeded', cached: false, errorCode: null, retryable: false };
}
