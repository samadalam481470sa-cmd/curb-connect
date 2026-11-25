// Follow-Up Queue: due re-contacts for dry roofing leads.
//
//   GET  /v1/follow-ups                      due items (quoted roof orders + quoted /
//                                            interested / lost funnel leads), most overdue first
//   GET  /v1/follow-ups/templates            follow-up message templates (honest, no fake urgency)
//   GET  /v1/follow-ups/automation           automation gate state (off by default; see below)
//   POST /v1/follow-ups/:id/complete         log the outcome + note; advances the lead stage if given
//   POST /v1/follow-ups/:id/snooze           new due date (days from now; optional per-item cadence)
//   POST /v1/follow-ups/:id/cadence          per-item cadence override in days (1–90)
//
// (Registered under the /v1 prefix by the coordinator; see apps/api/src/modules/registry.ts.)
//
// What is due comes from real records only: funnel stage rows (permit_funnel_stages,
// via the funnel store) and roof orders in status 'quoted'. Nothing is invented and
// no lead is ever contacted automatically.
//
// Automation (auto-creating follow-ups / auto-sending messages) does not exist in this
// build: there is no code path that sends anything. The `roof.follow_up_automation`
// flag (packages/contracts/src/flags.ts, default off) is read for the automation
// status endpoint only, so the gate is visible before any automation is ever built.
// Manual complete / snooze is the only live path. Follow-up state (snoozes,
// completions, cadence overrides) is in-memory for the process lifetime — there is
// no follow_ups table yet; see store.ts.
//
// Follow-up actions are also written to agent_activity_log (same shape as the claims
// module's POST /v1/roof-agents/activity) under agent 'follow-ups', so the per-agent
// hours-saved totals include them.
import { roofOrderMachine } from '@fieldline/contracts';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { agentActivityLog, roofOrderEvents, roofOrders } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import {
  createDbFunnelStageStore,
  createMemoryFunnelStageStore,
  type FunnelStageStore,
} from '../permitLeads/funnel/store';
import {
  CALL_OUTCOMES,
  canMoveStage,
  FUNNEL_STAGE_LABEL,
  isCallOutcome,
  isFunnelStage,
  validCallNote,
  type CallOutcome,
  type FunnelStage,
} from '../permitLeads/funnel/stages';
import { flagsFor } from '../../services/flags';
import {
  deriveFollowUpById,
  deriveFollowUps,
  FOLLOW_UP_CADENCE_DAYS,
  FOLLOW_UP_STAGES,
  isFollowUpStage,
  parseFollowUpId,
  validCadenceDays,
  type FollowUpItem,
  type FunnelFollowUpInput,
  type RoofOrderFollowUpInput,
} from './queue';
import { createMemoryFollowUpStore, type FollowUpStore } from './store';
import { FOLLOW_UP_TEMPLATES } from './templates';

export const FOLLOW_UP_AUTOMATION_FLAG = 'roof.follow_up_automation' as const;

const FollowUpItemSchema: z.ZodType<FollowUpItem> = z.object({
  id: z.string(),
  source: z.enum(['funnel', 'roof_order']),
  leadKey: z.string().nullable(),
  roofOrderId: z.string().nullable(),
  roofOrderNumber: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  stage: z.enum(FOLLOW_UP_STAGES),
  stageLabel: z.string(),
  callCount: z.number(),
  lastContactAt: z.string().nullable(),
  lastOutcome: z.enum(CALL_OUTCOMES as [CallOutcome, ...CallOutcome[]]).nullable(),
  lastNote: z.string().nullable(),
  dueAt: z.string(),
  overdueDays: z.number(),
  dueReason: z.string(),
  suggestedTemplateId: z.string(),
  snoozedUntil: z.string().nullable(),
  cadenceDays: z.number(),
});

const CompleteBody = z.object({
  outcome: z.string(),
  note: z.string().max(1000),
  /** Funnel stage to move to (funnel leads), or 'won' / 'cancelled' (roof orders). */
  stage: z.string().optional(),
});

const SnoozeBody = z.object({
  /** Days from now until the item is due again (1–90). */
  days: z.number().int().min(1).max(90),
  /** Optional per-item cadence override in days (1–90) for future due dates. */
  cadenceDays: z.number().int().min(1).max(90).optional(),
});

const CadenceBody = z.object({
  cadenceDays: z.number().int().min(1).max(90),
});

const AUTOMATION_NOTE =
  'Automation is off and not built: no follow-up is created or sent automatically. ' +
  'Manual complete and snooze are the only live paths.';

export function createFollowUpRoutes(deps: {
  now?: Date;
  funnelStore?: FunnelStageStore;
  followUpStore?: FollowUpStore;
} = {}): FastifyPluginAsyncZod {
  const sharedStore = deps.followUpStore ?? createMemoryFollowUpStore();
  const followUpsModule: FastifyPluginAsyncZod = async (app) => {
    const store = sharedStore;

    app.get(
      '/follow-ups',
      {
        config: { permission: 'job:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          tags: ['roof'],
          summary: 'Due follow-ups: quoted roof orders and quoted / interested / lost funnel leads',
          querystring: z.object({
            stage: z.string().optional(),
            source: z.enum(['funnel', 'roof_order']).optional(),
          }),
          response: {
            200: z.object({
              items: z.array(FollowUpItemSchema),
              automation: z.object({
                enabled: z.boolean(),
                autoCreate: z.boolean(),
                autoSend: z.boolean(),
                note: z.string(),
              }),
              cadenceDays: z.object({
                quoted: z.number(),
                interested: z.number(),
                lost: z.number(),
              }),
            }),
          },
        },
      },
      async (request) => {
        const { orgId } = requireOrg(request);
        const now = deps.now ?? new Date();
        const { funnelRows, roofOrderRows } = await loadDueInputs(request, orgId, deps.funnelStore);
        const overrides = await store.getOverrides();
        let items = deriveFollowUps(funnelRows, roofOrderRows, now, overrides);
        if (request.query.stage) {
          if (!isFollowUpStage(request.query.stage)) {
            throw problem('validation_failed', `Unknown follow-up stage: ${request.query.stage}`);
          }
          items = items.filter((i) => i.stage === request.query.stage);
        }
        if (request.query.source) {
          items = items.filter((i) => i.source === request.query.source);
        }
        return {
          items,
          automation: await automationState(request, orgId),
          cadenceDays: { ...FOLLOW_UP_CADENCE_DAYS },
        };
      },
    );

    app.get(
      '/follow-ups/templates',
      {
        config: { permission: 'job:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          tags: ['roof'],
          summary: 'Follow-up message templates (short, honest, no fake urgency)',
          response: {
            200: z.object({
              templates: z.array(
                z.object({
                  id: z.string(),
                  stage: z.enum(FOLLOW_UP_STAGES),
                  label: z.string(),
                  body: z.string(),
                }),
              ),
            }),
          },
        },
      },
      async () => ({ templates: [...FOLLOW_UP_TEMPLATES] }),
    );

    app.get(
      '/follow-ups/automation',
      {
        config: { permission: 'job:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          tags: ['roof'],
          summary: 'Follow-up automation gate state (off by default; nothing auto-sends)',
          response: {
            200: z.object({
              flag: z.string(),
              enabled: z.boolean(),
              autoCreate: z.boolean(),
              autoSend: z.boolean(),
              note: z.string(),
            }),
          },
        },
      },
      async (request) => {
        const { orgId } = requireOrg(request);
        return { flag: FOLLOW_UP_AUTOMATION_FLAG, ...(await automationState(request, orgId)) };
      },
    );

    app.post(
      '/follow-ups/:id/complete',
      {
        config: { permission: 'job:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          tags: ['roof'],
          summary: 'Log a follow-up outcome and note; advances the lead stage when given',
          params: z.object({ id: z.string().min(1).max(300) }),
          body: CompleteBody,
          response: {
            200: z.object({
              item: FollowUpItemSchema,
              outcome: z.string(),
              stage: z.string().nullable(),
              note: z.string(),
            }),
          },
        },
      },
      async (request) => {
        const org = requireOrg(request);
        const now = deps.now ?? new Date();
        if (!isCallOutcome(request.body.outcome)) {
          throw problem('validation_failed', `Unknown call outcome: ${request.body.outcome}`);
        }
        const outcome: CallOutcome = request.body.outcome;
        const note = validCallNote(request.body.note);
        if (note === null) {
          throw problem('validation_failed', 'A follow-up note is required (up to 1000 characters).');
        }
        const parsed = parseFollowUpId(request.params.id);
        if (!parsed) throw problem('not_found', 'No follow-up with that id.');
        const { funnelRows, roofOrderRows } = await loadDueInputs(request, org.orgId, deps.funnelStore);
        const overrides = await store.getOverrides();
        const item = deriveFollowUpById(request.params.id, funnelRows, roofOrderRows, now, overrides);
        if (!item) throw problem('not_found', 'No due follow-up with that id for this company.');
        const funnelStore =
          deps.funnelStore ?? createDbFunnelStageStore((fn) => tenantTx(request, fn));
        let newStage: string | null = null;
        if (item.source === 'funnel') {
          const row = await funnelStore.logCall(org.orgId, item.leadKey!, outcome, note);
          if (!row) throw problem('validation_failed', 'The follow-up could not be logged.');
          if (request.body.stage !== undefined) {
            if (!isFunnelStage(request.body.stage)) {
              throw problem('validation_failed', `Unknown funnel stage: ${request.body.stage}`);
            }
            const to: FunnelStage = request.body.stage;
            if (!canMoveStage(item.stage, to)) {
              throw problem(
                'validation_failed',
                `Cannot move a lead from ${FUNNEL_STAGE_LABEL[item.stage]} to ${FUNNEL_STAGE_LABEL[to]}.`,
              );
            }
            const ok = await funnelStore.setStage(org.orgId, item.leadKey!, to);
            if (!ok) throw problem('validation_failed', 'The stage could not be changed.');
            newStage = to;
          }
        } else {
          // Roof order: only a win (or a cancellation) is a legal move from quoted.
          if (request.body.stage !== undefined) {
            const to = request.body.stage;
            if (to !== 'won' && to !== 'cancelled') {
              throw problem(
                'validation_failed',
                'A roof quote can only be marked won or cancelled from a follow-up; other status changes happen in the roof order.',
              );
            }
            if (!roofOrderMachine.canTransition('quoted', to)) {
              throw problem('validation_failed', `A quoted roof order cannot move to ${to}.`);
            }
            await tenantTx(request, async (tx) => {
              const [current] = await tx
                .select()
                .from(roofOrders)
                .where(and(eq(roofOrders.orgId, org.orgId), eq(roofOrders.id, item.roofOrderId!)))
                .for('update');
              if (!current) throw problem('not_found');
              if (current.status !== 'quoted') {
                throw problem('conflict', `This roof order is ${current.status}, not quoted.`);
              }
              await tx.insert(roofOrderEvents).values({
                orgId: org.orgId,
                roofOrderId: current.id,
                fromStatus: 'quoted',
                toStatus: to,
                actorType: 'user',
                actorUserId: org.userId,
                reason: `Follow-up completed: ${outcome}. ${note}`,
                correlationId: request.id,
                occurredAt: sql`clock_timestamp()`,
              });
              await tx
                .update(roofOrders)
                .set({ status: to, revision: sql`${roofOrders.revision} + 1` })
                .where(eq(roofOrders.id, current.id));
            });
            newStage = to;
          }
        }
        await store.complete(request.params.id, outcome, note, now.toISOString());
        await logAgentActivity(request, org.orgId, 'follow-ups', `follow_up_completed:${outcome}`, {
          relatedType: item.source === 'roof_order' ? 'roof_order' : undefined,
          relatedId: item.roofOrderId ?? undefined,
        });
        const freshInputs = await loadDueInputs(request, org.orgId, deps.funnelStore);
        const fresh = deriveFollowUpById(
          request.params.id,
          freshInputs.funnelRows,
          freshInputs.roofOrderRows,
          now,
          await store.getOverrides(),
        );
        // A won/cancelled roof order leaves the queue; a funnel lead that moved stage
        // may too. Return the fresh item when it still exists, else the completed one.
        return { item: fresh ?? item, outcome, stage: newStage, note };
      },
    );

    app.post(
      '/follow-ups/:id/snooze',
      {
        config: { permission: 'job:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          tags: ['roof'],
          summary: 'Snooze a follow-up to a new due date (days from now)',
          params: z.object({ id: z.string().min(1).max(300) }),
          body: SnoozeBody,
          response: { 200: z.object({ item: FollowUpItemSchema, snoozedUntil: z.string() }) },
        },
      },
      async (request) => {
        const { orgId } = requireOrg(request);
        const now = deps.now ?? new Date();
        const parsed = parseFollowUpId(request.params.id);
        if (!parsed) throw problem('not_found', 'No follow-up with that id.');
        const { funnelRows, roofOrderRows } = await loadDueInputs(request, orgId, deps.funnelStore);
        const item = deriveFollowUpById(
          request.params.id,
          funnelRows,
          roofOrderRows,
          now,
          await store.getOverrides(),
        );
        if (!item) throw problem('not_found', 'No due follow-up with that id for this company.');
        const snoozedUntil = new Date(now.getTime() + request.body.days * 86_400_000).toISOString();
        if (request.body.cadenceDays !== undefined) {
          const cadence = validCadenceDays(request.body.cadenceDays);
          if (cadence === null) throw problem('validation_failed', 'Cadence must be 1–90 days.');
          await store.setCadence(request.params.id, cadence);
        }
        await store.snooze(request.params.id, snoozedUntil);
        await logAgentActivity(request, orgId, 'follow-ups', 'follow_up_snoozed', {
          relatedType: item.source === 'roof_order' ? 'roof_order' : undefined,
          relatedId: item.roofOrderId ?? undefined,
        });
        const fresh = deriveFollowUpById(
          request.params.id,
          funnelRows,
          roofOrderRows,
          now,
          await store.getOverrides(),
        );
        return { item: fresh ?? item, snoozedUntil };
      },
    );

    app.post(
      '/follow-ups/:id/cadence',
      {
        config: { permission: 'job:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          tags: ['roof'],
          summary: 'Set the per-item follow-up cadence in days (1–90)',
          params: z.object({ id: z.string().min(1).max(300) }),
          body: CadenceBody,
          response: { 200: z.object({ item: FollowUpItemSchema }) },
        },
      },
      async (request) => {
        const { orgId } = requireOrg(request);
        const now = deps.now ?? new Date();
        const parsed = parseFollowUpId(request.params.id);
        if (!parsed) throw problem('not_found', 'No follow-up with that id.');
        const { funnelRows, roofOrderRows } = await loadDueInputs(request, orgId, deps.funnelStore);
        const item = deriveFollowUpById(
          request.params.id,
          funnelRows,
          roofOrderRows,
          now,
          await store.getOverrides(),
        );
        if (!item) throw problem('not_found', 'No due follow-up with that id for this company.');
        const cadence = validCadenceDays(request.body.cadenceDays);
        if (cadence === null) throw problem('validation_failed', 'Cadence must be 1–90 days.');
        await store.setCadence(request.params.id, cadence);
        const fresh = deriveFollowUpById(
          request.params.id,
          funnelRows,
          roofOrderRows,
          now,
          await store.getOverrides(),
        );
        return { item: fresh ?? item };
      },
    );
  };
  return followUpsModule;
}

async function automationState(
  request: FastifyRequest,
  orgId: string,
): Promise<{ enabled: boolean; autoCreate: boolean; autoSend: boolean; note: string }> {
  let enabled: boolean;
  try {
    const flags = await tenantTx(request, (tx) => flagsFor(tx, orgId));
    enabled = flags[FOLLOW_UP_AUTOMATION_FLAG] ?? false;
  } catch {
    enabled = false;
  }
  // Even if the flag were ever enabled, this build has no auto-create / auto-send
  // code path, so both stay false until automation is actually built.
  return { enabled, autoCreate: false, autoSend: false, note: AUTOMATION_NOTE };
}

/** Best-effort agent-activity log row (same shape as POST /v1/roof-agents/activity). */
async function logAgentActivity(
  request: FastifyRequest,
  orgId: string,
  agent: 'follow-ups' | 'front_desk',
  action: string,
  opts: { relatedType?: string; relatedId?: string } = {},
): Promise<void> {
  try {
    await tenantTx(request, async (tx) => {
      await tx.insert(agentActivityLog).values({
        orgId,
        agent,
        action,
        minutesSaved: null,
        relatedType: opts.relatedType ?? null,
        relatedId: opts.relatedId ?? null,
      });
    });
  } catch {
    // Logging must never fail the follow-up itself (e.g. before the activity table exists).
  }
}

async function loadDueInputs(
  request: FastifyRequest,
  orgId: string,
  funnelStore?: FunnelStageStore,
): Promise<{
  funnelRows: FunnelFollowUpInput[];
  roofOrderRows: RoofOrderFollowUpInput[];
}> {
  const funnelRows: FunnelFollowUpInput[] = [];
  try {
    const store =
      funnelStore ?? createDbFunnelStageStore((fn) => tenantTx(request, fn));
    const stages = await store.getStages(orgId);
    for (const s of stages) {
      if (!isFollowUpStage(s.stage)) continue;
      funnelRows.push({
        leadKey: s.leadKey,
        stage: s.stage,
        callCount: s.callCount,
        lastCallAt: s.lastCallAt,
        lastNote: s.lastNote,
      });
    }
  } catch {
    // No funnel stages readable (e.g. before migration 0035): the queue still works
    // from roof orders. The funnel store itself falls back to memory in its routes.
    try {
      const memory = await createMemoryFunnelStageStore().getStages(orgId);
      for (const s of memory) {
        if (!isFollowUpStage(s.stage)) continue;
        funnelRows.push({
          leadKey: s.leadKey,
          stage: s.stage,
          callCount: s.callCount,
          lastCallAt: s.lastCallAt,
          lastNote: s.lastNote,
        });
      }
    } catch {
      // Nothing readable; continue with roof orders only.
    }
  }
  let roofOrderRows: RoofOrderFollowUpInput[];
  try {
    roofOrderRows = await tenantTx(request, async (tx) => {
      const rows = await tx
        .select({
          id: roofOrders.id,
          number: roofOrders.number,
          updatedAt: roofOrders.updatedAt,
          jobId: roofOrders.jobId,
        })
        .from(roofOrders)
        .where(eq(roofOrders.status, 'quoted'))
        .limit(200);
      return rows.map((r) => ({
        id: r.id,
        number: r.number,
        updatedAt: r.updatedAt.toISOString(),
        jobId: r.jobId,
      }));
    });
  } catch {
    roofOrderRows = [];
  }
  return { funnelRows, roofOrderRows };
}

const followUpsModule: FastifyPluginAsyncZod = createFollowUpRoutes();

export default followUpsModule;
