// Labor rate book (audit-gaps round 2): contractor-entered hourly rates per
// Plan-to-Bid trade, stored per organization and reusable across bids.
//
// Two implementations behind one interface (same pattern as the follow-up
// store):
//   - createDbLaborRateStore(): drizzle over labor_rates (migration 0107).
//     Tenant-scoped by orgId on every query. The production store.
//   - createMemoryLaborRateStore(): in-memory, for unit tests and as the
//     graceful fallback before migration 0107 is applied.
//
// A rate is applied to a bid ONLY when the contractor picks it in the UI.
// There are no default rates — an empty book stays empty. Money is integer
// minor units (cents per hour).
import {
  LaborRateCreateSchema,
  LaborRateDeleteResponseSchema,
  LaborRateSchema,
  LaborRateUpdateSchema,
  LaborRatesListResponseSchema,
  type LaborRate,
  type LaborRateCreate,
  type LaborRateUpdate,
  type PlanToBidTrade,
} from '@fieldline/contracts';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
// NOTE: the barrel import below must stay first (circular schema graph — see
// permitLeads/funnel/store.ts for why).
import '../../db/schema';
import { laborRates } from '../../db/schema/laborRates';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';

export type TxRunner = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export type CreateResult = { ok: true; rate: LaborRate } | { ok: false; reason: 'duplicate' };
export type UpdateResult =
  | { ok: true; rate: LaborRate }
  | { ok: false; reason: 'not_found' | 'duplicate' };

export interface LaborRateStore {
  list(orgId: string): Promise<LaborRate[]>;
  create(orgId: string, input: LaborRateCreate): Promise<CreateResult>;
  update(orgId: string, id: string, patch: LaborRateUpdate): Promise<UpdateResult>;
  remove(orgId: string, id: string): Promise<boolean>;
}

type LaborRateRow = typeof laborRates.$inferSelect;

export function rowToLaborRate(row: LaborRateRow): LaborRate {
  return {
    id: row.id,
    trade: row.trade as PlanToBidTrade,
    label: row.label,
    rateCentsPerHour: row.rateCentsPerHour,
    note: row.note,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const sortRates = (rates: LaborRate[]): LaborRate[] =>
  [...rates].sort((a, b) => a.trade.localeCompare(b.trade) || a.label.localeCompare(b.label));

export function createMemoryLaborRateStore(): LaborRateStore {
  const byId = new Map<string, { orgId: string; rate: LaborRate }>();
  let seq = 0;
  const duplicate = (orgId: string, trade: string, label: string, exceptId?: string): boolean =>
    [...byId.values()].some(
      (e) =>
        e.orgId === orgId &&
        e.rate.trade === trade &&
        e.rate.label === label &&
        e.rate.id !== exceptId,
    );
  return {
    async list(orgId) {
      return sortRates(
        [...byId.values()].filter((e) => e.orgId === orgId).map((e) => e.rate),
      );
    },
    async create(orgId, input) {
      if (duplicate(orgId, input.trade, input.label)) return { ok: false, reason: 'duplicate' };
      seq += 1;
      const rate: LaborRate = {
        id: `memory-rate-${seq}`,
        trade: input.trade,
        label: input.label,
        rateCentsPerHour: input.rateCentsPerHour,
        note: input.note ?? '',
        updatedAt: new Date().toISOString(),
      };
      byId.set(rate.id, { orgId, rate });
      return { ok: true, rate };
    },
    async update(orgId, id, patch) {
      const found = byId.get(id);
      if (!found || found.orgId !== orgId) return { ok: false, reason: 'not_found' };
      const next: LaborRate = {
        ...found.rate,
        label: patch.label ?? found.rate.label,
        rateCentsPerHour: patch.rateCentsPerHour ?? found.rate.rateCentsPerHour,
        note: patch.note ?? found.rate.note,
        updatedAt: new Date().toISOString(),
      };
      if (duplicate(orgId, next.trade, next.label, id)) return { ok: false, reason: 'duplicate' };
      byId.set(id, { orgId, rate: next });
      return { ok: true, rate: next };
    },
    async remove(orgId, id) {
      const found = byId.get(id);
      if (!found || found.orgId !== orgId) return false;
      byId.delete(id);
      return true;
    },
  };
}

export function createDbLaborRateStore(run: TxRunner): LaborRateStore {
  return {
    async list(orgId) {
      return run(async (tx) => {
        const rows = await tx
          .select()
          .from(laborRates)
          .where(eq(laborRates.orgId, orgId));
        return sortRates(rows.map(rowToLaborRate));
      });
    },
    async create(orgId, input) {
      return run(async (tx) => {
        const [existing] = await tx
          .select({ id: laborRates.id })
          .from(laborRates)
          .where(
            and(
              eq(laborRates.orgId, orgId),
              eq(laborRates.trade, input.trade),
              eq(laborRates.label, input.label),
            ),
          )
          .limit(1);
        if (existing) return { ok: false as const, reason: 'duplicate' as const };
        const [row] = await tx
          .insert(laborRates)
          .values({
            orgId,
            trade: input.trade,
            label: input.label,
            rateCentsPerHour: input.rateCentsPerHour,
            note: input.note ?? '',
          })
          .returning();
        if (!row) throw new Error('labor rate insert returned no row');
        return { ok: true as const, rate: rowToLaborRate(row) };
      });
    },
    async update(orgId, id, patch) {
      return run(async (tx) => {
        const [current] = await tx
          .select()
          .from(laborRates)
          .where(and(eq(laborRates.orgId, orgId), eq(laborRates.id, id)))
          .limit(1);
        if (!current) return { ok: false as const, reason: 'not_found' as const };
        const nextLabel = patch.label ?? current.label;
        if (nextLabel !== current.label) {
          const [clash] = await tx
            .select({ id: laborRates.id })
            .from(laborRates)
            .where(
              and(
                eq(laborRates.orgId, orgId),
                eq(laborRates.trade, current.trade),
                eq(laborRates.label, nextLabel),
                ne(laborRates.id, id),
              ),
            )
            .limit(1);
          if (clash) return { ok: false as const, reason: 'duplicate' as const };
        }
        const [row] = await tx
          .update(laborRates)
          .set({
            label: nextLabel,
            rateCentsPerHour: patch.rateCentsPerHour ?? current.rateCentsPerHour,
            note: patch.note ?? current.note,
            revision: sql`${laborRates.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(and(eq(laborRates.orgId, orgId), eq(laborRates.id, id)))
          .returning();
        if (!row) throw new Error('labor rate update returned no row');
        return { ok: true as const, rate: rowToLaborRate(row) };
      });
    },
    async remove(orgId, id) {
      return run(async (tx) => {
        const deleted = await tx
          .delete(laborRates)
          .where(and(eq(laborRates.orgId, orgId), eq(laborRates.id, id)))
          .returning({ id: laborRates.id });
        return deleted.length > 0;
      });
    },
  };
}

/**
 * DB store with an in-memory fallback: if the database call fails (e.g.
 * migration 0107 not applied yet), the memory store answers so the endpoints
 * keep working with process-lifetime state.
 */
export function createResilientLaborRateStore(
  db: LaborRateStore,
  memory: LaborRateStore,
): LaborRateStore {
  const wrap = <T>(fn: (s: LaborRateStore) => Promise<T>): Promise<T> =>
    fn(db).catch(() => fn(memory));
  return {
    list: (orgId) => wrap((s) => s.list(orgId)),
    create: (orgId, input) => wrap((s) => s.create(orgId, input)),
    update: (orgId, id, patch) => wrap((s) => s.update(orgId, id, patch)),
    remove: (orgId, id) => wrap((s) => s.remove(orgId, id)),
  };
}

const LIST_NOTE =
  'Rates you saved. A rate is used on a bid only when you pick it — Field Pro never fills in a labor rate.';

const IdParamsSchema = z.object({ id: z.string().uuid() });

export function registerLaborRateRoutes(app: Parameters<FastifyPluginAsyncZod>[0]): void {
  const memory = createMemoryLaborRateStore();
  const storeFor = (request: FastifyRequest): LaborRateStore =>
    createResilientLaborRateStore(
      createDbLaborRateStore((fn) => tenantTx(request, fn)),
      memory,
    );

  app.get(
    '/plan-to-bid/labor-rates',
    {
      config: { permission: 'estimate:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['plan-to-bid'],
        summary: 'List the labor rate book (contractor-entered rates, per organization)',
        response: { 200: LaborRatesListResponseSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const rates = await storeFor(request).list(orgId);
      return { rates, note: LIST_NOTE };
    },
  );

  app.post(
    '/plan-to-bid/labor-rates',
    {
      config: { permission: 'estimate:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['plan-to-bid'],
        summary: 'Save a labor rate to the book (contractor-entered; never auto-applied)',
        body: LaborRateCreateSchema,
        response: { 200: LaborRateSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const result = await storeFor(request).create(orgId, request.body);
      if (!result.ok) {
        throw problem(
          'conflict',
          'A rate with that name already exists for this trade. Pick a different name or edit the saved rate.',
        );
      }
      return result.rate;
    },
  );

  app.patch(
    '/plan-to-bid/labor-rates/:id',
    {
      config: { permission: 'estimate:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['plan-to-bid'],
        summary: 'Edit a saved labor rate',
        params: IdParamsSchema,
        body: LaborRateUpdateSchema,
        response: { 200: LaborRateSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const result = await storeFor(request).update(orgId, request.params.id, request.body);
      if (!result.ok) {
        if (result.reason === 'not_found') {
          throw problem('not_found', 'That saved rate does not exist in your rate book.');
        }
        throw problem(
          'conflict',
          'Another rate with that name already exists for this trade. Pick a different name.',
        );
      }
      return result.rate;
    },
  );

  app.delete(
    '/plan-to-bid/labor-rates/:id',
    {
      config: { permission: 'estimate:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['plan-to-bid'],
        summary: 'Delete a saved labor rate',
        params: IdParamsSchema,
        response: { 200: LaborRateDeleteResponseSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const removed = await storeFor(request).remove(orgId, request.params.id);
      if (!removed) {
        throw problem('not_found', 'That saved rate does not exist in your rate book.');
      }
      return { ok: true };
    },
  );
}
