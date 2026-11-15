// Curb project persistence helpers: loading, DTOs, rule synchronisation (permits, safety reviews,
// rule-engine risk flags), derived estimate inputs/site conditions and readiness gates.
import type { CurbServiceCode, Measurement, SiteCondition } from '@fieldline/contracts';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import {
  calibrations,
  curbMeasurements,
  curbObservations,
  curbProjects,
  curbSegments,
  estimates,
  jurisdictions,
  mediaAssets,
  permitRequirements,
  riskFlags,
  safetyReviews,
} from '../../db/schema';
import { problem } from '../../http/problem';
import { loadProperty } from '../properties/service';
import {
  CURB_RULES_VERSION,
  type CurbFacts,
  evaluateRuleFlags,
  type ObservationFact,
  OVERRIDABLE_RULE_FLAGS,
  requiredPermits,
  requiredReviews,
  siteConditions,
} from './rules';

export type ProjectRow = typeof curbProjects.$inferSelect;
const num = (v: string | null | undefined) => (v === null || v === undefined ? null : Number(v));
const TRUSTED = new Set(['field_verified', 'survey_supplied']);

export async function loadProject(tx: Tx, orgId: string, id: string, forUpdate = false): Promise<ProjectRow | null> {
  const q = tx.select().from(curbProjects).where(and(eq(curbProjects.orgId, orgId), eq(curbProjects.id, id)));
  const [row] = forUpdate ? await q.for('update') : await q;
  return row ?? null;
}

export async function siteLocationOf(tx: Tx, id: string): Promise<unknown> {
  const rows = await tx.execute<{ g: string | null }>(sql`select ST_AsGeoJSON(site_location) as g from curb_projects where id = ${id}`);
  const g = [...rows][0]?.g;
  return g ? JSON.parse(g) : null;
}

export async function projectDto(tx: Tx, p: ProjectRow) {
  return {
    id: p.id,
    orgId: p.orgId,
    revision: p.revision,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    number: p.number,
    propertyId: p.propertyId,
    jobId: p.jobId,
    customerId: p.customerId,
    serviceCode: p.serviceCode,
    status: p.status,
    jurisdictionId: p.jurisdictionId,
    jurisdictionRulesVersion: p.jurisdictionRulesVersion,
    curbProfile: p.curbProfile,
    isPublicRightOfWay: p.isPublicRightOfWay,
    siteLocation: (await siteLocationOf(tx, p.id)) as never,
    description: p.description,
  };
}

export function observationAnswer(o: typeof curbObservations.$inferSelect) {
  if (o.state !== 'known') return { state: 'unknown' as const, reason: o.unknownReason ?? 'not_provided' };
  const value = o.valueBoolean ?? (o.valueNumber !== null ? Number(o.valueNumber) : o.valueText);
  return { state: 'known' as const, value, ...(o.unit && { unit: o.unit }), source: o.source, ...(o.evidenceSource && { evidenceSource: o.evidenceSource }) };
}

export function measurementOf(m: typeof curbMeasurements.$inferSelect): Measurement {
  if (m.state !== 'known' || m.value === null) return { state: 'unknown', reason: (m.unknownReason as never) ?? 'not_measured_yet' };
  const precision = m.low !== null && m.high !== null ? Math.max(0, (Number(m.high) - Number(m.low)) / 2) : 0;
  return {
    state: 'known',
    value: Number(m.value),
    unit: (m.unit ?? 'm') as never,
    source: m.source ?? 'user_entered',
    measuredAt: (m.measuredAt ?? m.updatedAt).toISOString(),
    precision,
    ...(m.calibrationId && { evidence: { mediaAssetIds: m.mediaAssetId ? [m.mediaAssetId] : [], calibrationId: m.calibrationId, inferenceResultId: null } }),
  };
}

export async function projectDetail(tx: Tx, p: ProjectRow) {
  const where = <T extends { orgId: unknown; curbProjectId: unknown }>(t: T) =>
    and(eq(t.orgId as never, p.orgId), eq(t.curbProjectId as never, p.id));
  const [obs, cals, segs, meas, flags, permits, reviews] = await Promise.all([
    tx.select().from(curbObservations).where(where(curbObservations)).orderBy(asc(curbObservations.questionKey)),
    tx.select().from(calibrations).where(where(calibrations)).orderBy(asc(calibrations.createdAt)),
    tx.select().from(curbSegments).where(where(curbSegments)).orderBy(asc(curbSegments.sortOrder), asc(curbSegments.createdAt)),
    tx.select().from(curbMeasurements).where(where(curbMeasurements)).orderBy(asc(curbMeasurements.createdAt)),
    tx.select().from(riskFlags).where(where(riskFlags)).orderBy(asc(riskFlags.createdAt)),
    tx.select().from(permitRequirements).where(where(permitRequirements)).orderBy(asc(permitRequirements.permitType)),
    tx.select().from(safetyReviews).where(where(safetyReviews)).orderBy(asc(safetyReviews.kind)),
  ]);
  return {
    project: await projectDto(tx, p),
    observations: obs.map((o) => ({ id: o.id, questionKey: o.questionKey, answer: observationAnswer(o), mediaAssetIds: o.mediaAssetIds, answeredViaPortal: o.answeredViaPortal, revision: o.revision, updatedAt: o.updatedAt.toISOString() })),
    calibrations: cals.map(calibrationDto),
    segments: segs.map((s) => ({ id: s.id, kind: s.kind, label: s.label, mediaAssetId: s.mediaAssetId, calibrationId: s.calibrationId, source: s.source, geometry: s.imageGeometry, revision: s.revision })),
    measurements: meas.map((m) => ({ id: m.id, segmentId: m.segmentId, kind: m.kind, measurement: measurementOf(m), low: num(m.low), high: num(m.high), calibrationId: m.calibrationId, revision: m.revision })),
    riskFlags: flags.map((f) => ({ id: f.id, kind: f.kind, severity: f.severity, status: f.status, evidenceSource: f.evidenceSource, ruleVersion: f.ruleVersion, message: f.message, resolutionNote: f.resolutionNote, revision: f.revision })),
    permits: permits.map((x) => ({ id: x.id, permitType: x.permitType, status: x.status, jurisdictionId: x.jurisdictionId, rulesVersion: x.rulesVersion, applicationReference: x.applicationReference, expiresOn: x.expiresOn, checklist: (x.evidence as { checklist?: unknown } | null)?.checklist ?? [], revision: x.revision })),
    safetyReviews: reviews.map((r) => ({ id: r.id, kind: r.kind, status: r.status, reviewerMembershipId: r.reviewerMembershipId, checklist: r.checklist ?? [], reviewedAt: r.reviewedAt?.toISOString() ?? null, expiresAt: r.expiresAt?.toISOString() ?? null, revision: r.revision })),
  };
}

export function calibrationDto(c: typeof calibrations.$inferSelect) {
  const cp = c.controlPoints as { failure?: { reason: string; message: string; next: string } | null; engineVersion?: string };
  return {
    id: c.id,
    curbProjectId: c.curbProjectId,
    mediaAssetId: c.mediaAssetId,
    method: c.method,
    status: c.status,
    referenceLabel: c.referenceLabel,
    referenceLengthM: num(c.referenceLengthM),
    metersPerPixel: num(c.metersPerPixel),
    residualErrorM: num(c.residualErrorM),
    uncertainty: num(c.uncertainty),
    failure: cp.failure ?? null,
    engineVersion: cp.engineVersion ?? 'unknown',
    supersedesId: c.supersedesId,
    createdAt: c.createdAt.toISOString(),
  };
}

/** Media asset of this project (owner check under RLS). */
export async function projectMedia(tx: Tx, p: ProjectRow, assetId: string) {
  const [m] = await tx
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.orgId, p.orgId), eq(mediaAssets.id, assetId), eq(mediaAssets.ownerType, 'curb_project'), eq(mediaAssets.ownerId, p.id), sql`${mediaAssets.deletedAt} is null`));
  if (!m) throw problem('not_found', 'No such photo on this curb project.');
  return m;
}

// ------------------------------------------------------------------ facts + rule sync
export async function loadFacts(tx: Tx, p: ProjectRow, now = new Date()): Promise<CurbFacts> {
  const [obs, permits, reviews, depth, property] = await Promise.all([
    tx.select().from(curbObservations).where(and(eq(curbObservations.orgId, p.orgId), eq(curbObservations.curbProjectId, p.id))),
    tx.select().from(permitRequirements).where(and(eq(permitRequirements.orgId, p.orgId), eq(permitRequirements.curbProjectId, p.id))),
    tx.select().from(safetyReviews).where(and(eq(safetyReviews.orgId, p.orgId), eq(safetyReviews.curbProjectId, p.id))),
    tx
      .select({ source: curbMeasurements.source })
      .from(curbMeasurements)
      .where(and(eq(curbMeasurements.orgId, p.orgId), eq(curbMeasurements.curbProjectId, p.id), eq(curbMeasurements.state, 'known'), inArray(curbMeasurements.kind, ['cut_depth', 'thickness']))),
    loadProperty(tx, p.orgId, p.propertyId),
  ]);
  const observations = new Map<string, ObservationFact>();
  for (const o of obs) {
    const a = observationAnswer(o);
    observations.set(o.questionKey, { state: a.state, value: a.state === 'known' ? (a.value ?? null) : null, source: o.source });
  }
  return {
    serviceCode: p.serviceCode as CurbServiceCode,
    isPublicRightOfWay: p.isPublicRightOfWay,
    jurisdictionStatus: property?.jurisdictionStatus ?? null,
    observations,
    permits: permits.map((x) => ({ permitType: x.permitType, status: x.status, expiresOn: x.expiresOn })),
    reviews: reviews.map((r) => ({ kind: r.kind, status: r.status, expiresAt: r.expiresAt })),
    depthVerified: depth.some((d) => d.source !== null && TRUSTED.has(d.source)),
    now,
  };
}

/**
 * Creates missing required permits/reviews, opens rule flags whose condition holds and closes
 * rule flags whose condition cleared. Manual flags are never touched. Runs inside the command
 * transaction, so the rule result is part of the same commit.
 */
export async function syncRules(tx: Tx, p: ProjectRow, userId: string): Promise<{ opened: string[]; closed: string[] }> {
  let facts = await loadFacts(tx, p);
  const AUTO = { auto: CURB_RULES_VERSION };
  const permitsNeeded = new Set(requiredPermits(facts));
  const permitRows = await tx.select().from(permitRequirements).where(and(eq(permitRequirements.orgId, p.orgId), eq(permitRequirements.curbProjectId, p.id)));
  for (const t of permitsNeeded) {
    const ex = permitRows.find((x) => x.permitType === t);
    if (!ex) {
      await tx.insert(permitRequirements).values({ orgId: p.orgId, curbProjectId: p.id, permitType: t, status: 'unknown', jurisdictionId: p.jurisdictionId, rulesVersion: p.jurisdictionRulesVersion ?? CURB_RULES_VERSION, evidence: AUTO });
    } else if (ex.status === 'not_required' && (ex.evidence as { auto?: string } | null)?.auto) {
      await tx.update(permitRequirements).set({ status: 'unknown', notes: 'Required again by the rules.', revision: ex.revision + 1 }).where(eq(permitRequirements.id, ex.id));
    }
  }
  // A rule-created requirement that no longer applies (e.g. private site confirmed) and that no
  // person has touched is closed as not required by the rules, with the reason recorded.
  for (const ex of permitRows) {
    if (!permitsNeeded.has(ex.permitType) && ex.status === 'unknown' && (ex.evidence as { auto?: string } | null)?.auto) {
      await tx.update(permitRequirements).set({ status: 'not_required', notes: `Not required by ${CURB_RULES_VERSION}: work confirmed outside the public right-of-way.`, revision: ex.revision + 1 }).where(eq(permitRequirements.id, ex.id));
    }
  }
  const reviewsNeeded = new Set(requiredReviews(facts));
  const reviewRows = await tx.select().from(safetyReviews).where(and(eq(safetyReviews.orgId, p.orgId), eq(safetyReviews.curbProjectId, p.id)));
  for (const k of reviewsNeeded) {
    const ex = reviewRows.find((r) => r.kind === k);
    if (!ex) await tx.insert(safetyReviews).values({ orgId: p.orgId, curbProjectId: p.id, kind: k, status: 'pending', evidence: AUTO });
    else if (ex.status === 'not_applicable' && (ex.evidence as { auto?: string } | null)?.auto) await tx.update(safetyReviews).set({ status: 'pending', revision: ex.revision + 1 }).where(eq(safetyReviews.id, ex.id));
  }
  for (const ex of reviewRows) {
    if (!reviewsNeeded.has(ex.kind) && ex.status === 'pending' && (ex.evidence as { auto?: string } | null)?.auto) {
      await tx.update(safetyReviews).set({ status: 'not_applicable', revision: ex.revision + 1 }).where(eq(safetyReviews.id, ex.id));
    }
  }
  facts = await loadFacts(tx, p);
  const desired = evaluateRuleFlags(facts);
  const existing = await tx
    .select()
    .from(riskFlags)
    .where(and(eq(riskFlags.orgId, p.orgId), eq(riskFlags.curbProjectId, p.id), eq(riskFlags.evidenceSource, 'rule_engine')))
    .orderBy(desc(riskFlags.createdAt));
  const opened: string[] = [];
  const closed: string[] = [];
  const wanted = new Set(desired.map((d) => d.kind));
  for (const d of desired) {
    const openFlag = existing.find((f) => f.kind === d.kind && f.status === 'open');
    if (openFlag) {
      if (openFlag.message !== d.message) await tx.update(riskFlags).set({ message: d.message, evidence: { fingerprint: d.evidence }, revision: openFlag.revision + 1 }).where(eq(riskFlags.id, openFlag.id));
      continue;
    }
    const overridden = existing.find(
      (f) => f.kind === d.kind && f.status !== 'open' && f.resolvedByUserId !== null && OVERRIDABLE_RULE_FLAGS.has(d.kind) && (f.evidence as { fingerprint?: string } | null)?.fingerprint === d.evidence,
    );
    if (overridden) continue;
    await tx.insert(riskFlags).values({ orgId: p.orgId, curbProjectId: p.id, kind: d.kind, severity: 'blocking', status: 'open', evidenceSource: 'rule_engine', evidence: { fingerprint: d.evidence }, ruleVersion: CURB_RULES_VERSION, message: d.message });
    opened.push(d.kind);
  }
  for (const f of existing) {
    if (f.status === 'open' && !wanted.has(f.kind)) {
      await tx.update(riskFlags).set({ status: 'resolved', resolvedAt: new Date(), resolutionNote: `Condition cleared on re-evaluation (${CURB_RULES_VERSION}).`, revision: f.revision + 1 }).where(eq(riskFlags.id, f.id));
      closed.push(f.kind);
    }
  }
  void userId;
  return { opened, closed };
}

/** Bumps the project revision (every committed curb command) and marks its estimates stale. */
export async function bumpProject(tx: Tx, p: ProjectRow, reason: string, set: Partial<typeof curbProjects.$inferInsert> = {}): Promise<ProjectRow> {
  const [u] = await tx.update(curbProjects).set({ ...set, revision: p.revision + 1 }).where(eq(curbProjects.id, p.id)).returning();
  await tx.execute(sql`
    update estimates e set
      stale_since = coalesce(e.stale_since, now()),
      stale_reason = ${reason},
      status = case when e.status = 'approved' then 'review_required'::estimate_status else e.status end,
      approved_revision_id = case when e.status = 'approved' then null else e.approved_revision_id end,
      revision = e.revision + 1
    where e.org_id = ${p.orgId} and e.curb_project_id = ${p.id} and e.status <> 'rejected'`);
  return u!;
}

// ------------------------------------------------------------------ estimate inputs
/**
 * Estimate inputs keyed by measurement kind (e.g. cut_length). A project-level measurement wins;
 * otherwise segment-level lengths of the same kind are summed. A sum is only as trusted as its
 * weakest part, and any unknown part makes the total unknown (never a partial number).
 */
export async function estimateInputs(tx: Tx, p: ProjectRow): Promise<Record<string, Measurement>> {
  const rows = await tx.select().from(curbMeasurements).where(and(eq(curbMeasurements.orgId, p.orgId), eq(curbMeasurements.curbProjectId, p.id))).orderBy(asc(curbMeasurements.createdAt));
  const out: Record<string, Measurement> = {};
  const byKind = new Map<string, (typeof rows)[number][]>();
  for (const r of rows) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
  for (const [kind, list] of byKind) {
    const project = list.filter((r) => r.segmentId === null);
    if (project.length) {
      out[kind] = measurementOf(project[project.length - 1]!);
      continue;
    }
    const parts = list.map(measurementOf);
    if (parts.some((m) => m.state === 'unknown')) {
      out[kind] = { state: 'unknown', reason: 'not_measured_yet', note: 'a segment measurement is unknown' };
      continue;
    }
    const known = parts as Extract<Measurement, { state: 'known' }>[];
    const rank = ['field_verified', 'survey_supplied', 'user_entered', 'imagery_derived', 'machine_estimated'];
    const weakest = known.map((k) => k.source).sort((a, b) => rank.indexOf(b) - rank.indexOf(a))[0]!;
    out[kind] = {
      state: 'known',
      value: Number(known.reduce((s, k) => s + k.value, 0).toFixed(6)),
      unit: known[0]!.unit,
      source: weakest,
      measuredAt: known.map((k) => k.measuredAt).sort().at(-1)!,
      precision: Number(Math.sqrt(known.reduce((s, k) => s + k.precision * k.precision, 0)).toFixed(6)),
    };
  }
  return out;
}

export async function derivedSiteConditions(tx: Tx, p: ProjectRow): Promise<Record<string, SiteCondition>> {
  return siteConditions(await loadFacts(tx, p));
}

// ------------------------------------------------------------------ readiness (CP-059, CP-060)
export async function readiness(tx: Tx, p: ProjectRow) {
  const sc = await derivedSiteConditions(tx, p);
  const gates: { code: string; message: string; resolution: string }[] = [];
  const flags = await tx.select().from(riskFlags).where(and(eq(riskFlags.orgId, p.orgId), eq(riskFlags.curbProjectId, p.id), eq(riskFlags.status, 'open'))).orderBy(asc(riskFlags.kind));
  for (const f of flags) gates.push({ code: `risk_flag:${f.kind}`, message: f.message, resolution: f.evidenceSource === 'rule_engine' ? 'Record the missing evidence (permit, review, measurement or answer).' : 'Resolve the risk flag.' });
  for (const [k, v] of Object.entries(sc)) {
    if (v.state === 'unknown') gates.push({ code: `unknown:${k}`, message: `${k.replaceAll('_', ' ')} is unknown.`, resolution: 'Confirm with evidence.' });
  }
  if (sc.permit_required?.state === 'known' && sc.permit_required.value) gates.push({ code: 'permit_implicated', message: 'Permit-implicated work: only a labeled budgetary range can be offered automatically.', resolution: 'Permit reviewer sign-off on the approved permit.' });
  if (sc.public_right_of_way?.state === 'known' && sc.public_right_of_way.value) gates.push({ code: 'public_right_of_way', message: 'Work in the public right-of-way.', resolution: 'Municipal authorization on file.' });
  const canApproveFirm = gates.length === 0;
  const [approved] = await tx.select({ id: estimates.id }).from(estimates).where(and(eq(estimates.orgId, p.orgId), eq(estimates.curbProjectId, p.id), eq(estimates.status, 'approved'))).limit(1);
  const dispatchGates = approved ? [] : [{ code: 'estimate_not_approved', message: 'No approved estimate for this project.', resolution: 'Approve a firm estimate.' }];
  const reviewRequired = gates.some((g) => g.code.startsWith('risk_flag:scope') || g.code.startsWith('risk_flag:jurisdiction'));
  return {
    curbProjectId: p.id,
    canApproveFirm,
    canDispatch: canApproveFirm && dispatchGates.length === 0,
    quoteKind: canApproveFirm ? ('firm' as const) : reviewRequired ? ('review_required' as const) : ('budgetary_range' as const),
    gates: [...gates, ...dispatchGates],
    siteConditions: sc,
    rulesVersion: CURB_RULES_VERSION,
  };
}

/**
 * CP-060 / COS-24x: dispatch guard for the jobs/dispatch module. Throws dispatch_blocked with the
 * open gates; never lets a crew go out with missing permits, utility checks or safety reviews.
 */
export async function assertCurbDispatchReady(tx: Tx, orgId: string, curbProjectId: string): Promise<void> {
  const p = await loadProject(tx, orgId, curbProjectId);
  if (!p) throw problem('not_found');
  const r = await readiness(tx, p);
  if (!r.canDispatch) {
    throw problem('dispatch_blocked', `Dispatch blocked: ${r.gates.map((g) => g.code).join(', ')}.`, {
      errors: r.gates.map((g) => ({ path: 'curbProject', message: g.message, code: g.code })),
    });
  }
}

export async function nextProjectNumber(tx: Tx, orgId: string): Promise<string> {
  const rows = await tx.execute<{ n: number }>(sql`select count(*)::int + 1 as n from curb_projects where org_id = ${orgId}`);
  return `CP-${String([...rows][0]!.n).padStart(5, '0')}`;
}

export async function jurisdictionRulesVersion(tx: Tx, id: string | null): Promise<string | null> {
  if (!id) return null;
  const [j] = await tx.select({ v: jurisdictions.rulesVersion }).from(jurisdictions).where(eq(jurisdictions.id, id));
  return j?.v ?? null;
}
