// Roof orders, reports and versions (RF-006, RF-021, RF-024, RF-030, RR-033, RR-037, RR-039,
// COS-201, COS-210, ADD-034, ADD-036, ADD-037). Every status change goes through the contracts
// state machine and is written as an immutable roof_order_events row (actor, time, reason, data).
// Credits for assisted orders are a usage_ledger reservation: reserved at submit, consumed when the
// report is approved, released exactly once when the order fails or is cancelled.
import { type RoofOrderStatus, type RoofSla, roofDeliveryState, roofOrderMachine, roofReportVersionMachine } from '@fieldline/contracts';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { roofGeometryOps, roofOrderEvents, roofOrders, roofReports, roofReportVersions, usageLedger } from '../../db/schema';
import { problem } from '../../http/problem';

export type RoofOrderRow = typeof roofOrders.$inferSelect;
export type RoofReportRow = typeof roofReports.$inferSelect;
export type RoofVersionRow = typeof roofReportVersions.$inferSelect;

export interface Actor {
  orgId: string;
  userId: string | null;
  correlationId?: string | null;
  actorType?: 'user' | 'system';
}

export async function loadOrder(tx: Tx, orgId: string, id: string, forUpdate = false): Promise<RoofOrderRow | null> {
  const q = tx.select().from(roofOrders).where(and(eq(roofOrders.orgId, orgId), eq(roofOrders.id, id)));
  const [row] = forUpdate ? await q.for('update') : await q;
  return row ?? null;
}

export async function requireOrder(tx: Tx, orgId: string, id: string, forUpdate = false): Promise<RoofOrderRow> {
  const row = await loadOrder(tx, orgId, id, forUpdate);
  if (!row) throw problem('not_found', 'Roof order not found.');
  return row;
}

export async function nextOrderNumber(tx: Tx, orgId: string): Promise<string> {
  const rows = await tx.execute<{ n: number }>(sql`select count(*)::int + 1 as n from roof_orders where org_id = ${orgId}`);
  return `RO-${String([...rows][0]!.n).padStart(5, '0')}`;
}

export async function recordEvent(
  tx: Tx,
  actor: Actor,
  orderId: string,
  from: RoofOrderStatus | null,
  to: RoofOrderStatus,
  reason: string | null,
  data: Record<string, unknown> | null = null,
): Promise<void> {
  await tx.insert(roofOrderEvents).values({
    orgId: actor.orgId,
    roofOrderId: orderId,
    fromStatus: from,
    toStatus: to,
    actorType: actor.actorType ?? (actor.userId ? 'user' : 'system'),
    actorUserId: actor.userId,
    reason,
    data: { ...(data ?? {}), nextStates: roofOrderMachine.nextStates(to) },
    correlationId: actor.correlationId ?? null,
  });
}

/** RF-006 D: assertTransition + immutable event; returns the updated order. */
export async function transitionOrder(
  tx: Tx,
  actor: Actor,
  order: RoofOrderRow,
  to: RoofOrderStatus,
  reason: string | null,
  data: Record<string, unknown> | null = null,
  extra: Partial<typeof roofOrders.$inferInsert> = {},
): Promise<RoofOrderRow> {
  if (!roofOrderMachine.canTransition(order.status, to)) {
    throw problem('invalid_transition', `A roof order cannot go from ${order.status} to ${to}.`);
  }
  const [row] = await tx
    .update(roofOrders)
    .set({ status: to, revision: order.revision + 1, ...extra })
    .where(and(eq(roofOrders.orgId, actor.orgId), eq(roofOrders.id, order.id)))
    .returning();
  await recordEvent(tx, actor, order.id, order.status, to, reason, data);
  if (to === 'failed' || to === 'cancelled') await releaseCredit(tx, actor.orgId, row!, `order ${to}`);
  return row!;
}

// ------------------------------------------------------------------ credits (usage ledger)
export async function creditBalance(tx: Tx, orgId: string): Promise<number> {
  const rows = await tx.execute<{ n: number }>(sql`select coalesce(sum(quantity), 0)::int as n from usage_ledger where org_id = ${orgId} and meter = 'roof_report'`);
  return [...rows][0]!.n;
}

export async function reserveCredit(tx: Tx, orgId: string, orderId: string): Promise<string> {
  // Serialize reservations per org so two concurrent orders cannot both spend the last credit.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`roof-credit:${orgId}`}))`);
  const balance = await creditBalance(tx, orgId);
  if (balance < 1) throw problem('entitlement_exceeded', 'No roof report credits are available for an assisted measurement. DIY tracing needs no credit.');
  const [row] = await tx
    .insert(usageLedger)
    .values({ orgId, meter: 'roof_report', kind: 'reserved', quantity: -1, subjectType: 'roof_order', subjectId: orderId, idempotencyKey: `roof-order:${orderId}:reserve`, note: 'assisted roof report' })
    .returning({ id: usageLedger.id });
  return row!.id;
}

async function settled(tx: Tx, orgId: string, reservationId: string): Promise<boolean> {
  const rows = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from usage_ledger where org_id = ${orgId} and reservation_id = ${reservationId} and kind in ('released', 'consumed')`,
  );
  return [...rows][0]!.n > 0;
}

/** Exactly once (idempotency keys are unique per org): a failed/cancelled order gets its credit back. */
export async function releaseCredit(tx: Tx, orgId: string, order: RoofOrderRow, note: string): Promise<void> {
  if (!order.usageReservationId || (await settled(tx, orgId, order.usageReservationId))) return;
  await tx.insert(usageLedger).values({ orgId, meter: 'roof_report', kind: 'released', quantity: 1, reservationId: order.usageReservationId, subjectType: 'roof_order', subjectId: order.id, idempotencyKey: `roof-order:${order.id}:release`, note });
}

/** Converts the hold into a charge: +1 release of the hold and -1 consumption (balance unchanged). */
export async function consumeCredit(tx: Tx, orgId: string, order: RoofOrderRow): Promise<void> {
  if (!order.usageReservationId || (await settled(tx, orgId, order.usageReservationId))) return;
  await tx.insert(usageLedger).values([
    { orgId, meter: 'roof_report', kind: 'released', quantity: 1, reservationId: order.usageReservationId, subjectType: 'roof_order', subjectId: order.id, idempotencyKey: `roof-order:${order.id}:settle-release`, note: 'hold converted' },
    { orgId, meter: 'roof_report', kind: 'consumed', quantity: -1, reservationId: order.usageReservationId, subjectType: 'roof_order', subjectId: order.id, idempotencyKey: `roof-order:${order.id}:consume`, note: 'report approved' },
  ]);
}

// ------------------------------------------------------------------ reports + versions
export async function createReport(tx: Tx, orgId: string, order: RoofOrderRow): Promise<{ report: RoofReportRow; version: RoofVersionRow }> {
  const [report] = await tx.insert(roofReports).values({ orgId, roofOrderId: order.id, status: 'drafting' }).returning();
  const [version] = await tx
    .insert(roofReportVersions)
    .values({ orgId, roofReportId: report!.id, versionNumber: 1, status: 'draft', imageryAssetId: order.imageryAssetId, geometryRevision: 0 })
    .returning();
  const [upd] = await tx.update(roofReports).set({ currentVersionId: version!.id, revision: report!.revision + 1 }).where(eq(roofReports.id, report!.id)).returning();
  return { report: upd!, version: version! };
}

export async function reportForOrder(tx: Tx, orgId: string, orderId: string): Promise<RoofReportRow | null> {
  const [r] = await tx.select().from(roofReports).where(and(eq(roofReports.orgId, orgId), eq(roofReports.roofOrderId, orderId))).orderBy(desc(roofReports.createdAt)).limit(1);
  return r ?? null;
}

export async function requireReport(tx: Tx, orgId: string, id: string, forUpdate = false): Promise<RoofReportRow> {
  const q = tx.select().from(roofReports).where(and(eq(roofReports.orgId, orgId), eq(roofReports.id, id)));
  const [row] = forUpdate ? await q.for('update') : await q;
  if (!row) throw problem('not_found', 'Roof report not found.');
  return row;
}

export async function loadVersion(tx: Tx, orgId: string, id: string): Promise<RoofVersionRow | null> {
  const [row] = await tx.select().from(roofReportVersions).where(and(eq(roofReportVersions.orgId, orgId), eq(roofReportVersions.id, id)));
  return row ?? null;
}

export async function requireVersion(tx: Tx, orgId: string, id: string): Promise<RoofVersionRow> {
  const v = await loadVersion(tx, orgId, id);
  if (!v) throw problem('not_found', 'Report version not found.');
  return v;
}

export async function setVersionStatus(tx: Tx, orgId: string, v: RoofVersionRow, to: RoofVersionRow['status'], extra: Partial<typeof roofReportVersions.$inferInsert> = {}): Promise<RoofVersionRow> {
  roofReportVersionMachine.assertTransition(v.status, to);
  const [row] = await tx.update(roofReportVersions).set({ status: to, revision: v.revision + 1, ...extra }).where(and(eq(roofReportVersions.orgId, orgId), eq(roofReportVersions.id, v.id))).returning();
  return row!;
}

/** RR-037: a new draft continues from the previous version's command log (history kept). */
export async function newDraftFrom(tx: Tx, orgId: string, report: RoofReportRow, from: RoofVersionRow, userId: string | null): Promise<RoofVersionRow> {
  const [last] = await tx
    .select({ n: roofReportVersions.versionNumber })
    .from(roofReportVersions)
    .where(and(eq(roofReportVersions.orgId, orgId), eq(roofReportVersions.roofReportId, report.id)))
    .orderBy(desc(roofReportVersions.versionNumber))
    .limit(1);
  const [draft] = await tx
    .insert(roofReportVersions)
    .values({
      orgId,
      roofReportId: report.id,
      versionNumber: (last?.n ?? 0) + 1,
      status: 'draft',
      imageryAssetId: from.imageryAssetId,
      supersedesVersionId: from.id,
      geometryRevision: 0,
    })
    .returning();
  const ops = await tx.select().from(roofGeometryOps).where(and(eq(roofGeometryOps.orgId, orgId), eq(roofGeometryOps.reportVersionId, from.id))).orderBy(roofGeometryOps.sequence);
  if (ops.length) {
    // One seed op carrying the previous version's applied commands keeps the replay identical.
    await tx.insert(roofGeometryOps).values({
      orgId,
      reportVersionId: draft!.id,
      sequence: 1,
      op: 'seed_from_version',
      payload: { commands: ops.flatMap((o) => (o.payload as { commands: unknown[] }).commands), fromVersionId: from.id },
      baseGeometryRevision: 0,
      actorUserId: userId,
      clientOpId: `seed:${from.id}`,
    });
  }
  await tx.update(roofReports).set({ currentVersionId: draft!.id, status: 'drafting', revision: report.revision + 1 }).where(eq(roofReports.id, report.id));
  return draft!;
}

/** RR-037: changed measurements make dependent roof estimates stale (approved ones need review). */
export async function markRoofEstimatesStale(tx: Tx, orgId: string, orderId: string, reason: string): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    update estimates e set
      stale_since = coalesce(e.stale_since, now()),
      stale_reason = ${reason},
      status = case when e.status = 'approved' then 'review_required'::estimate_status else e.status end,
      approved_revision_id = case when e.status = 'approved' then null else e.approved_revision_id end,
      revision = e.revision + 1
    where e.org_id = ${orgId} and e.roof_order_id = ${orderId} and e.status <> 'rejected'
    returning e.id`);
  return [...rows].map((r) => r.id);
}

// ------------------------------------------------------------------ DTOs
export async function slaOf(tx: Tx, orgId: string, orderId: string): Promise<RoofSla | null> {
  const [first] = await tx
    .select({ data: roofOrderEvents.data })
    .from(roofOrderEvents)
    .where(and(eq(roofOrderEvents.orgId, orgId), eq(roofOrderEvents.roofOrderId, orderId), eq(roofOrderEvents.toStatus, 'draft')))
    .limit(1);
  return ((first?.data as { sla?: RoofSla } | null)?.sla ?? null) as RoofSla | null;
}

export async function orderDto(tx: Tx, o: RoofOrderRow) {
  const report = await reportForOrder(tx, o.orgId, o.id);
  return {
    id: o.id,
    number: o.number,
    propertyId: o.propertyId,
    mode: o.mode,
    deliverySpeed: o.deliverySpeed,
    status: o.status,
    deliveryState: roofDeliveryState(o.status),
    nextStates: [...roofOrderMachine.nextStates(o.status)],
    structureIds: o.structureIds,
    imageryAssetId: o.imageryAssetId,
    dueAt: o.dueAt ? o.dueAt.toISOString() : null,
    sla: await slaOf(tx, o.orgId, o.id),
    creditReservationId: o.usageReservationId,
    failureReason: o.failureReason,
    reportId: report?.id ?? null,
    revision: o.revision,
    createdAt: o.createdAt.toISOString(),
  };
}
