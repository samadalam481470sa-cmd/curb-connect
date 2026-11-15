// Roof geometry edits on the shared command bus (COS starter C/D, ADD-014, ADD-027, ADD-034).
// PATCH /v1/roof/reports/{id}/geometry and POST /v1/commands {command_type: RoofGeometryEdited}
// run the same handler: lock the report, receipt lookup, draft-only check, geometry revision check
// (409 + diff), then one transaction appends the op to the log, rewrites the derived rows and the
// version snapshot, and writes audit + outbox + receipt.
import type { RoofGeometryCommand } from '@fieldline/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import { structures } from '../../db/schema';
import { roofGeometryOps } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { problem } from '../../http/problem';
import { type CommandContext, commandHandler, registerCommand } from '../commands/registry';
import { createHistory } from '@fieldline/geometry';
import { analyse, geometryState, loadOps, opsToCommands, persistDerived, step } from './geometry';
import { requireOrder, type RoofOrderRow, type RoofReportRow, type RoofVersionRow } from './service';
import { roofReports, roofReportVersions } from '../../db/schema';

export interface GeometryAggregate {
  report: RoofReportRow;
  version: RoofVersionRow;
  order: RoofOrderRow;
  scope: { scopeStructureIds: string[]; excludedStructureIds: string[] };
}

export async function scopeOf(tx: Tx, orgId: string, order: RoofOrderRow) {
  const rows = order.structureIds.length
    ? await tx.select({ id: structures.id, scopeStatus: structures.scopeStatus }).from(structures).where(and(eq(structures.orgId, orgId), inArray(structures.id, order.structureIds)))
    : [];
  return {
    scopeStructureIds: [...order.structureIds],
    excludedStructureIds: rows.filter((r) => r.scopeStatus === 'excluded').map((r) => r.id),
    unmeasuredAllowed: rows.filter((r) => r.scopeStatus === 'unmeasured').map((r) => r.id),
  };
}

export async function loadGeometryAggregate(tx: Tx, orgId: string, reportId: string, lock: boolean): Promise<GeometryAggregate | null> {
  const q = tx.select().from(roofReports).where(and(eq(roofReports.orgId, orgId), eq(roofReports.id, reportId)));
  const [report] = lock ? await q.for('update') : await q;
  if (!report || !report.currentVersionId) return null;
  const [version] = await tx.select().from(roofReportVersions).where(and(eq(roofReportVersions.orgId, orgId), eq(roofReportVersions.id, report.currentVersionId)));
  if (!version) return null;
  const order = await requireOrder(tx, orgId, report.roofOrderId);
  const s = await scopeOf(tx, orgId, order);
  return { report, version, order, scope: { scopeStructureIds: s.scopeStructureIds, excludedStructureIds: s.excludedStructureIds } };
}

/** RF-024 R: a facet belongs to exactly one in-scope structure (defaults to the first one). */
export function normalizeCommands(commands: RoofGeometryCommand[], scopeStructureIds: readonly string[]): RoofGeometryCommand[] {
  return commands.map((c) => {
    if (c.type !== 'add_facet') return c;
    const sid = c.structureId ?? scopeStructureIds[0];
    if (!sid || !scopeStructureIds.includes(sid)) {
      throw problem('validation_failed', `Facet ${c.id} must belong to a structure in the order's scope.`, {
        errors: [{ path: 'body.commands.structureId', message: 'not in order scope' }],
      });
    }
    return { ...c, structureId: sid };
  });
}

export async function applyGeometryEdit(ctx: { tx: Tx; orgId: string; userId: string }, agg: GeometryAggregate, input: { clientOpId: string; commands: RoofGeometryCommand[] }) {
  const ops = await loadOps(ctx.tx, ctx.orgId, agg.version.id);
  const commands = normalizeCommands(input.commands, agg.scope.scopeStructureIds);
  let history = createHistory();
  for (const c of opsToCommands(ops)) history = step(history, c);
  for (const c of commands) history = step(history, c);
  const r = analyse(history, agg.scope.excludedStructureIds);
  const nextRevision = agg.version.geometryRevision + 1;
  await ctx.tx.insert(roofGeometryOps).values({
    orgId: ctx.orgId,
    reportVersionId: agg.version.id,
    sequence: (ops.at(-1)?.sequence ?? 0) + 1,
    op: commands.length === 1 ? commands[0]!.type : 'batch',
    payload: { commands },
    baseGeometryRevision: agg.version.geometryRevision,
    actorUserId: ctx.userId,
    clientOpId: input.clientOpId,
  });
  const state = geometryState(r, {
    reportId: agg.report.id,
    versionId: agg.version.id,
    versionNumber: agg.version.versionNumber,
    versionStatus: agg.version.status,
    geometryRevision: nextRevision,
    ...agg.scope,
  });
  await persistDerived(ctx.tx, ctx.orgId, agg.version.id, state, r);
  return state;
}

export function registerRoofCommands(): void {
  if (commandHandler('RoofGeometryEdited')) return;
  registerCommand<'RoofGeometryEdited', GeometryAggregate>({
    type: 'RoofGeometryEdited',
    aggregateType: 'roof_report',
    permission: 'roof_report:edit_geometry',
    async load(ctx: CommandContext, id: string) {
      const agg = await loadGeometryAggregate(ctx.tx, ctx.orgId, id, true);
      return agg ? { revision: agg.version.geometryRevision, state: agg } : null;
    },
    validate(_ctx, s) {
      if (s.version.status !== 'draft') {
        throw problem('immutable_record', `Version ${s.version.versionNumber} is ${s.version.status}; start a new revision to change the geometry.`);
      }
      if (s.order.status !== 'measuring' && s.order.status !== 'clarification_needed') {
        throw problem('invalid_transition', `Geometry can be edited while the order is measuring (it is ${s.order.status}).`);
      }
    },
    diff(s, p) {
      return [
        { field: 'geometryRevision', server: s.version.geometryRevision, yours: null },
        { field: 'commands', server: null, yours: p.commands.length },
      ];
    },
    async execute(ctx, { state }, p) {
      const before = state.version.totals;
      const geo = await applyGeometryEdit(ctx, state, { clientOpId: p.client_op_id, commands: p.commands });
      return {
        serverRevision: geo.geometryRevision,
        changed: true,
        audit: {
          action: 'roof.geometry_edited',
          before: { geometryRevision: state.version.geometryRevision, totals: before },
          after: { geometryRevision: geo.geometryRevision, property: geo.property, valid: geo.valid, commandTypes: p.commands.map((c) => c.type) },
        },
        event: { type: 'roof.geometry_edited', payload: { reportId: state.report.id, versionId: state.version.id, geometryRevision: geo.geometryRevision, valid: geo.valid } },
      };
    },
  });
}
