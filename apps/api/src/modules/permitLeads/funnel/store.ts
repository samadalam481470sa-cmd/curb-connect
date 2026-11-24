// Funnel stage + call-log store. Two implementations behind one interface:
//   - createMemoryFunnelStageStore(): in-memory, for unit tests and for running the funnel
//     before migration 0035 is applied (stages then last only for the process lifetime).
//   - createDbFunnelStageStore(): drizzle over permit_funnel_stages / permit_funnel_calls
//     (migration 0035). Tenant-scoped by orgId on every query.
import { and, desc, eq, sql } from 'drizzle-orm';
// NOTE: the barrel import below must stay first. The schema graph is circular
// (orgs <-> _tenant); importing this file's table module directly would evaluate
// _tenant before orgs and hit `tenantBase` in its temporal dead zone. Loading the
// barrel first evaluates the graph in the app's working order (orgs before the
// tenant-table files), after which the direct import below is safe.
import '../../../db/schema';
import { permitFunnelCalls, permitFunnelStages } from '../../../db/schema/permitFunnel';
import type { Tx } from '../../../db/runtime';
import {
  canMoveStage,
  isCallOutcome,
  validCallNote,
  type CallOutcome,
  type FunnelStage,
} from './stages';

export interface StageRow {
  leadKey: string;
  stage: FunnelStage;
  callCount: number;
  lastCallAt: string | null;
  lastNote: string | null;
}

export interface CallRow {
  leadKey: string;
  outcome: CallOutcome;
  note: string;
  createdAt: string;
}

export interface FunnelStageStore {
  getStages(orgId: string): Promise<StageRow[]>;
  /** Set a stage. Returns false when the transition is not allowed. */
  setStage(orgId: string, leadKey: string, stage: FunnelStage): Promise<boolean>;
  logCall(
    orgId: string,
    leadKey: string,
    outcome: CallOutcome,
    note: string,
  ): Promise<CallRow | null>;
  getCalls(orgId: string, leadKey: string): Promise<CallRow[]>;
}

const toStageRow = (r: {
  leadKey: string;
  stage: string;
  callCount: number;
  lastCallAt: Date | null;
  lastNote: string | null;
}): StageRow => ({
  leadKey: r.leadKey,
  stage: (r.stage as FunnelStage) ?? 'new',
  callCount: r.callCount,
  lastCallAt: r.lastCallAt ? r.lastCallAt.toISOString() : null,
  lastNote: r.lastNote,
});

export function createMemoryFunnelStageStore(): FunnelStageStore {
  const stages = new Map<string, StageRow>();
  const calls = new Map<string, CallRow[]>();
  const key = (orgId: string, leadKey: string) => `${orgId}::${leadKey}`;
  return {
    async getStages(orgId) {
      return [...stages.entries()]
        .filter(([k]) => k.startsWith(`${orgId}::`))
        .map(([, v]) => v);
    },
    async setStage(orgId, leadKey, stage) {
      const k = key(orgId, leadKey);
      const current = stages.get(k)?.stage ?? 'new';
      if (!canMoveStage(current, stage)) return false;
      const prev = stages.get(k);
      stages.set(k, {
        leadKey,
        stage,
        callCount: prev?.callCount ?? 0,
        lastCallAt: prev?.lastCallAt ?? null,
        lastNote: prev?.lastNote ?? null,
      });
      return true;
    },
    async logCall(orgId, leadKey, outcome, note) {
      const clean = validCallNote(note);
      if (!isCallOutcome(outcome) || clean === null) return null;
      const row: CallRow = {
        leadKey,
        outcome,
        note: clean,
        createdAt: new Date().toISOString(),
      };
      const k = key(orgId, leadKey);
      calls.set(k, [row, ...(calls.get(k) ?? [])]);
      const prev = stages.get(k);
      stages.set(k, {
        leadKey,
        // Logging a call moves a new lead to Contacted (mirrors the DB store's CASE).
        stage: !prev || prev.stage === 'new' ? 'contacted' : prev.stage,
        callCount: (prev?.callCount ?? 0) + 1,
        lastCallAt: row.createdAt,
        lastNote: clean,
      });
      return row;
    },
    async getCalls(orgId, leadKey) {
      return calls.get(key(orgId, leadKey)) ?? [];
    },
  };
}

export type DbRun = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

/** Drizzle store. The caller supplies the tenant-scoped runner (tenantTx in the API,
 *  withPlatform in the worker); this file never touches request context itself. */
export function createDbFunnelStageStore(run: DbRun): FunnelStageStore {
  return {
    async getStages(orgId) {
      return run(async (tx) => {
        const rows = await tx
          .select()
          .from(permitFunnelStages)
          .where(eq(permitFunnelStages.orgId, orgId));
        return rows.map(toStageRow);
      });
    },
    async setStage(orgId, leadKey, stage) {
      return run(async (tx) => {
        const [current] = await tx
          .select()
          .from(permitFunnelStages)
          .where(
            and(
              eq(permitFunnelStages.orgId, orgId),
              eq(permitFunnelStages.leadKey, leadKey),
            ),
          )
          .limit(1);
        const from = (current?.stage as FunnelStage | undefined) ?? 'new';
        if (!canMoveStage(from, stage)) return false;
        await tx
          .insert(permitFunnelStages)
          .values({ orgId, leadKey, stage })
          .onConflictDoUpdate({
            target: [permitFunnelStages.orgId, permitFunnelStages.leadKey],
            set: { stage, updatedAt: new Date() },
          });
        return true;
      });
    },
    async logCall(orgId, leadKey, outcome, note) {
      const clean = validCallNote(note);
      if (!isCallOutcome(outcome) || clean === null) return null;
      return run(async (tx) => {
        const [row] = await tx
          .insert(permitFunnelCalls)
          .values({ orgId, leadKey, outcome, note: clean })
          .returning();
        if (!row) return null;
        await tx
          .insert(permitFunnelStages)
          .values({
            orgId,
            leadKey,
            stage: 'contacted',
            callCount: 1,
            lastCallAt: new Date(),
            lastNote: clean,
          })
          .onConflictDoUpdate({
            target: [permitFunnelStages.orgId, permitFunnelStages.leadKey],
            set: {
              stage: sql`CASE WHEN ${permitFunnelStages.stage} = 'new' THEN 'contacted' ELSE ${permitFunnelStages.stage} END`,
              callCount: sql`${permitFunnelStages.callCount} + 1`,
              lastCallAt: new Date(),
              lastNote: clean,
              updatedAt: new Date(),
            },
          });
        return {
          leadKey: row.leadKey,
          outcome: row.outcome as CallOutcome,
          note: row.note,
          createdAt: row.createdAt.toISOString(),
        };
      });
    },
    async getCalls(orgId, leadKey) {
      return run(async (tx) => {
        const rows = await tx
          .select()
          .from(permitFunnelCalls)
          .where(
            and(
              eq(permitFunnelCalls.orgId, orgId),
              eq(permitFunnelCalls.leadKey, leadKey),
            ),
          )
          .orderBy(desc(permitFunnelCalls.createdAt))
          .limit(50);
        return rows.map((r) => ({
          leadKey: r.leadKey,
          outcome: r.outcome as CallOutcome,
          note: r.note,
          createdAt: r.createdAt.toISOString(),
        }));
      });
    },
  };
}
