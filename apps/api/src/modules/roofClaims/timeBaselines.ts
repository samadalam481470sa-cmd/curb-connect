// Agent time baselines (audit-gaps round 2): contractor-editable minutes
// saved per agent task type, stored per organization. When an agent action
// completes, its activity-log row is auto-filled with the baseline minutes
// for that task type — but only from rows the contractor actually saved.
// The starting template below is a labeled estimate ("starting estimate —
// edit to your numbers", the same pattern as the GL chart template): it is
// shown in the baseline panel and can be applied with one click, but it is
// never counted as measured time until the contractor adopts it.
//
// Two implementations behind one interface (same pattern as the labor rate
// book): drizzle over agent_time_baselines (migration 0108), and an
// in-memory store for tests and as the pre-migration fallback.
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
// NOTE: the barrel import below must stay first (circular schema graph — see
// permitLeads/funnel/store.ts for why).
import '../../db/schema';
import { agentTimeBaselines } from '../../db/schema/roofClaims';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';

export type TxRunner = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export interface TaskTypeDef {
  id: string;
  label: string;
  /** Starting estimate in minutes — a placeholder the contractor edits. */
  templateMinutes: number;
}

/** The task types agent actions log today (action prefix before ':detail'). */
export const TASK_TYPES: readonly TaskTypeDef[] = [
  { id: 'follow_up_completed', label: 'Follow-up completed', templateMinutes: 10 },
  { id: 'follow_up_snoozed', label: 'Follow-up snoozed', templateMinutes: 2 },
  { id: 'inspection_booked', label: 'Inspection booked', templateMinutes: 15 },
  { id: 'inspection_confirmed', label: 'Inspection confirmed', templateMinutes: 5 },
  { id: 'inspection_completed', label: 'Inspection completed', templateMinutes: 10 },
  { id: 'inspection_cancelled', label: 'Inspection cancelled', templateMinutes: 5 },
];

export const TEMPLATE_LABEL = 'Starting estimate — edit to your numbers';

export const BASELINES_NOTE =
  'Minutes saved per task type, used to auto-log time when an agent action completes. ' +
  'Rows marked "Starting estimate" are placeholders — edit them to your numbers. ' +
  'Nothing is counted until you save your own numbers.';

/** The task type of a logged action: the part before any ':detail'. */
export function taskTypeOf(action: string): string {
  return action.split(':')[0]?.trim() ?? '';
}

export function taskTypeDef(taskType: string): TaskTypeDef | null {
  return TASK_TYPES.find((t) => t.id === taskType) ?? null;
}

export interface TimeBaseline {
  taskType: string;
  label: string;
  /** Effective minutes: the contractor's saved value, else the template. */
  minutes: number;
  source: 'contractor' | 'template';
  templateMinutes: number;
}

export interface TimeBaselineStore {
  /** Merged view over every known task type (contractor rows + template). */
  list(orgId: string): Promise<TimeBaseline[]>;
  /** Save the contractor's minutes for a task type; null for an unknown type. */
  set(orgId: string, taskType: string, minutes: number): Promise<TimeBaseline | null>;
  /** Write template rows for task types the contractor has not set yet. */
  applyTemplate(orgId: string): Promise<TimeBaseline[]>;
  /** Minutes to auto-log for an action — contractor rows only, else null. */
  minutesForAction(orgId: string, action: string): Promise<number | null>;
}

type BaselineRow = typeof agentTimeBaselines.$inferSelect;

export function rowToBaseline(row: BaselineRow): { taskType: string; minutes: number } {
  return { taskType: row.taskType, minutes: row.minutes };
}

function mergeBaselines(saved: Map<string, number>): TimeBaseline[] {
  return TASK_TYPES.map((t) => {
    const own = saved.get(t.id);
    return {
      taskType: t.id,
      label: t.label,
      minutes: own ?? t.templateMinutes,
      source: own !== undefined ? ('contractor' as const) : ('template' as const),
      templateMinutes: t.templateMinutes,
    };
  });
}

export function createMemoryTimeBaselineStore(): TimeBaselineStore {
  const byOrg = new Map<string, Map<string, number>>();
  const savedFor = (orgId: string): Map<string, number> => {
    let m = byOrg.get(orgId);
    if (!m) {
      m = new Map();
      byOrg.set(orgId, m);
    }
    return m;
  };
  return {
    async list(orgId) {
      return mergeBaselines(savedFor(orgId));
    },
    async set(orgId, taskType, minutes) {
      if (!taskTypeDef(taskType)) return null;
      savedFor(orgId).set(taskType, minutes);
      return mergeBaselines(savedFor(orgId)).find((b) => b.taskType === taskType) ?? null;
    },
    async applyTemplate(orgId) {
      const saved = savedFor(orgId);
      for (const t of TASK_TYPES) {
        if (!saved.has(t.id)) saved.set(t.id, t.templateMinutes);
      }
      return mergeBaselines(saved);
    },
    async minutesForAction(orgId, action) {
      return savedFor(orgId).get(taskTypeOf(action)) ?? null;
    },
  };
}

export function createDbTimeBaselineStore(run: TxRunner): TimeBaselineStore {
  const loadSaved = (orgId: string): Promise<Map<string, number>> =>
    run(async (tx) => {
      const rows = await tx
        .select()
        .from(agentTimeBaselines)
        .where(eq(agentTimeBaselines.orgId, orgId));
      return new Map(rows.map((r) => [r.taskType, r.minutes]));
    });
  const upsert = async (orgId: string, taskType: string, minutes: number): Promise<void> => {
    await run(async (tx) => {
      await tx
        .insert(agentTimeBaselines)
        .values({ orgId, taskType, minutes })
        .onConflictDoUpdate({
          target: [agentTimeBaselines.orgId, agentTimeBaselines.taskType],
          set: { minutes, revision: sql`${agentTimeBaselines.revision} + 1`, updatedAt: new Date() },
        });
    });
  };
  return {
    async list(orgId) {
      return mergeBaselines(await loadSaved(orgId));
    },
    async set(orgId, taskType, minutes) {
      if (!taskTypeDef(taskType)) return null;
      await upsert(orgId, taskType, minutes);
      return mergeBaselines(await loadSaved(orgId)).find((b) => b.taskType === taskType) ?? null;
    },
    async applyTemplate(orgId) {
      const saved = await loadSaved(orgId);
      for (const t of TASK_TYPES) {
        if (!saved.has(t.id)) await upsert(orgId, t.id, t.templateMinutes);
      }
      return mergeBaselines(await loadSaved(orgId));
    },
    async minutesForAction(orgId, action) {
      const taskType = taskTypeOf(action);
      if (!taskType) return null;
      return run(async (tx) => {
        const [row] = await tx
          .select({ minutes: agentTimeBaselines.minutes })
          .from(agentTimeBaselines)
          .where(
            and(eq(agentTimeBaselines.orgId, orgId), eq(agentTimeBaselines.taskType, taskType)),
          )
          .limit(1);
        return row?.minutes ?? null;
      });
    },
  };
}

/**
 * DB store with an in-memory fallback: if the database call fails (e.g.
 * migration 0108 not applied yet), the memory store answers so the
 * endpoints keep working with process-lifetime state.
 */
export function createResilientTimeBaselineStore(
  db: TimeBaselineStore,
  memory: TimeBaselineStore,
): TimeBaselineStore {
  const wrap = <T>(fn: (s: TimeBaselineStore) => Promise<T>): Promise<T> =>
    fn(db).catch(() => fn(memory));
  return {
    list: (orgId) => wrap((s) => s.list(orgId)),
    set: (orgId, taskType, minutes) => wrap((s) => s.set(orgId, taskType, minutes)),
    applyTemplate: (orgId) => wrap((s) => s.applyTemplate(orgId)),
    minutesForAction: (orgId, action) => wrap((s) => s.minutesForAction(orgId, action)),
  };
}

const sharedMemory = createMemoryTimeBaselineStore();

export function timeBaselineStoreFor(request: FastifyRequest): TimeBaselineStore {
  return createResilientTimeBaselineStore(
    createDbTimeBaselineStore((fn) => tenantTx(request, fn)),
    sharedMemory,
  );
}

/**
 * Minutes to auto-log for a completed agent action: the contractor's saved
 * baseline for the action's task type, or null when they have not set one
 * (the activity row then stays unmeasured — never a template guess).
 * Best-effort: any failure resolves to null so logging never breaks the action.
 */
export async function resolveBaselineMinutes(
  request: FastifyRequest,
  orgId: string,
  action: string,
): Promise<number | null> {
  try {
    return await timeBaselineStoreFor(request).minutesForAction(orgId, action);
  } catch {
    return null;
  }
}

export const TimeBaselineSchema = z.object({
  taskType: z.string(),
  label: z.string(),
  minutes: z.number().int(),
  source: z.enum(['contractor', 'template']),
  templateMinutes: z.number().int(),
});
export type TimeBaselineOut = z.infer<typeof TimeBaselineSchema>;

export const TimeBaselinesResponseSchema = z.object({
  baselines: z.array(TimeBaselineSchema),
  note: z.string(),
});

export const TimeBaselineSetSchema = z.object({
  minutes: z.number().int().min(0).max(60 * 24),
});

const TaskTypeParamsSchema = z.object({ taskType: z.string().min(1).max(80) });

export function registerTimeBaselineRoutes(app: Parameters<FastifyPluginAsyncZod>[0]): void {
  app.get(
    '/roof-agents/time-baselines',
    {
      config: { permission: 'roof_order:read' },
      schema: {
        tags: ['roof'],
        summary:
          'Time baselines per agent task type (contractor-entered minutes; unset types show the labeled starting estimate)',
        response: { 200: TimeBaselinesResponseSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const baselines = await timeBaselineStoreFor(request).list(org.orgId);
      return { baselines, note: BASELINES_NOTE };
    },
  );

  app.put(
    '/roof-agents/time-baselines/:taskType',
    {
      config: { permission: 'roof_order:create', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['roof'],
        summary: 'Save your minutes-saved baseline for one agent task type',
        params: TaskTypeParamsSchema,
        body: TimeBaselineSetSchema,
        response: { 200: TimeBaselineSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const saved = await timeBaselineStoreFor(request).set(
        org.orgId,
        request.params.taskType,
        request.body.minutes,
      );
      if (!saved) throw problem('not_found', 'That task type does not exist.');
      return saved;
    },
  );

  app.post(
    '/roof-agents/time-baselines/apply-template',
    {
      config: { permission: 'roof_order:create', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['roof'],
        summary:
          'Adopt the starting-estimate baselines for task types you have not set yet (your saved numbers are kept)',
        response: { 200: TimeBaselinesResponseSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const baselines = await timeBaselineStoreFor(request).applyTemplate(org.orgId);
      return { baselines, note: BASELINES_NOTE };
    },
  );
}
