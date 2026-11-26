// `attention` module (builder operations section, item 9): the proactive feed that surfaces
// what needs a human — slipping schedules, outstanding POs, overdue AP, warranty tickets
// waiting, draws awaiting a decision, contracts at risk, SWPPP inspections due, orders
// awaiting a response. Every item is computed from real records in this company and carries
// its source record plus a provenance label: `observed` (read straight from a record),
// `estimated` (computed from records with stated math, e.g. age in days), or `modeled`
// (a rule-based projection, labeled as such). Nothing is invented: when the underlying
// records don't exist, the item doesn't exist. An optional AI summary rides the existing
// Ask Field Pro hook and reports an honest not_connected state when no model answers.
import {
  AttentionFeedSchema,
  AttentionSummarySchema,
  type AttentionItem,
} from '@fieldline/contracts';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  apInvoices,
  drawRequests,
  networkOrders,
  salesContracts,
  scheduleTasks,
  swpppInspections,
  warrantyTickets,
} from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { chatOpenModel } from '../../services/open-model';

const READ = 'attention:read';

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const ms = Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`);
  return Math.floor(ms / 86_400_000);
}

export function ageDays(createdAt: Date, now: Date): number {
  return Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000);
}

async function buildFeed(tx: Tx, orgId: string, now: Date): Promise<AttentionItem[]> {
  const today = isoDay(now);
  const in7Days = isoDay(new Date(now.getTime() + 7 * 86_400_000));
  const out: AttentionItem[] = [];

        // Slipping schedules: tasks past their end date and not complete (observed dates).
        const slipping = await tx
          .select()
          .from(scheduleTasks)
          .where(
            and(
              eq(scheduleTasks.orgId, orgId),
              lt(scheduleTasks.endsOn, today),
              inArray(scheduleTasks.status, ['not_started', 'in_progress', 'on_hold']),
            ),
          )
          .limit(50);
        for (const t of slipping) {
          out.push({
            id: `schedule_slipping:${t.id}`,
            kind: 'schedule_slipping',
            severity: 'high',
            title: `Schedule slipping: ${t.title}`,
            detail: `Planned to end ${t.endsOn} (${daysBetween(t.endsOn, today)} days ago) and still ${t.status.replaceAll('_', ' ')}.`,
            provenance: 'observed',
            sourceType: 'schedule_task',
            sourceId: t.id,
            href: '/crew-board',
            observedAt: now.toISOString(),
          });
        }

        // Orders awaiting a response (buyer side, sent 3+ days ago — age math = estimated).
        const awaiting = await tx
          .select()
          .from(networkOrders)
          .where(and(eq(networkOrders.orgId, orgId), eq(networkOrders.status, 'sent')))
          .limit(100);
        for (const o of awaiting) {
          const age = ageDays(o.sentAt, now);
          if (age < 3) continue;
          out.push({
            id: `order_awaiting_response:${o.id}`,
            kind: 'order_awaiting_response',
            severity: 'normal',
            title:
              o.side === 'buyer'
                ? `Order ${o.reference} awaiting ${o.partnerDisplayName}`
                : `Order ${o.reference} from ${o.partnerDisplayName} needs your response`,
            detail: `Sent ${age} days ago with no response yet.`,
            provenance: 'estimated',
            sourceType: 'network_order',
            sourceId: o.id,
            href: '/network-orders',
            observedAt: now.toISOString(),
          });
        }

        // Outstanding POs past their requested delivery date (observed dates).
        const outstanding = await tx
          .select()
          .from(networkOrders)
          .where(
            and(
              eq(networkOrders.orgId, orgId),
              inArray(networkOrders.status, ['accepted', 'in_production', 'shipped']),
            ),
          )
          .limit(100);
        for (const o of outstanding) {
          if (!o.requestedDeliveryOn || o.requestedDeliveryOn >= today) continue;
          out.push({
            id: `po_outstanding:${o.id}`,
            kind: 'po_outstanding',
            severity: 'high',
            title: `PO ${o.reference} past requested delivery`,
            detail: `Requested delivery ${o.requestedDeliveryOn} (${daysBetween(o.requestedDeliveryOn, today)} days ago); status is ${o.status.replaceAll('_', ' ')}.`,
            provenance: 'observed',
            sourceType: 'network_order',
            sourceId: o.id,
            href: '/network-orders',
            observedAt: now.toISOString(),
          });
        }

        // AP: overdue and awaiting approval (observed statuses/dates).
        const aps = await tx
          .select()
          .from(apInvoices)
          .where(
            and(
              eq(apInvoices.orgId, orgId),
              inArray(apInvoices.status, ['captured', 'pending_approval', 'approved']),
            ),
          )
          .limit(100);
        for (const a of aps) {
          if (a.status === 'pending_approval') {
            out.push({
              id: `ap_awaiting_approval:${a.id}`,
              kind: 'ap_awaiting_approval',
              severity: 'normal',
              title: `AP invoice awaiting approval: ${a.vendorName}`,
              detail: `${a.invoiceNumber ? `Invoice ${a.invoiceNumber}, ` : ''}submitted for approval and not yet decided.`,
              provenance: 'observed',
              sourceType: 'ap_invoice',
              sourceId: a.id,
              href: '/payables',
              observedAt: now.toISOString(),
            });
          }
          if (a.dueOn && a.dueOn < today) {
            out.push({
              id: `ap_overdue:${a.id}`,
              kind: 'ap_overdue',
              severity: 'high',
              title: `AP invoice overdue: ${a.vendorName}`,
              detail: `Due ${a.dueOn} (${daysBetween(a.dueOn, today)} days ago); payment has not been recorded.`,
              provenance: 'observed',
              sourceType: 'ap_invoice',
              sourceId: a.id,
              href: '/payables',
              observedAt: now.toISOString(),
            });
          }
        }

        // Warranty tickets waiting 2+ days (age math = estimated).
        const tickets = await tx
          .select()
          .from(warrantyTickets)
          .where(
            and(
              eq(warrantyTickets.orgId, orgId),
              inArray(warrantyTickets.status, ['new', 'under_review']),
            ),
          )
          .limit(100);
        for (const t of tickets) {
          const age = ageDays(t.createdAt, now);
          if (age < 2) continue;
          out.push({
            id: `warranty_waiting:${t.id}`,
            kind: 'warranty_waiting',
            severity: 'normal',
            title: `Warranty ticket waiting: ${t.title}`,
            detail: `Open ${age} days and still ${t.status.replaceAll('_', ' ')}.`,
            provenance: 'estimated',
            sourceType: 'warranty_ticket',
            sourceId: t.id,
            href: '/warranty',
            observedAt: now.toISOString(),
          });
        }

        // Draws awaiting a decision (observed status).
        const draws = await tx
          .select()
          .from(drawRequests)
          .where(and(eq(drawRequests.orgId, orgId), eq(drawRequests.status, 'submitted')))
          .limit(50);
        for (const d of draws) {
          out.push({
            id: `draw_awaiting_decision:${d.id}`,
            kind: 'draw_awaiting_decision',
            severity: 'normal',
            title: `Draw #${d.number} awaiting a decision`,
            detail: `Submitted${d.submittedAt ? ` on ${isoDay(d.submittedAt)}` : ''} and not yet approved or rejected.`,
            provenance: 'observed',
            sourceType: 'draw_request',
            sourceId: d.id,
            href: '/job-cost',
            observedAt: now.toISOString(),
          });
        }

        // Contracts at risk: signed/in-design with no linked job after 14 days (estimated age).
        const contracts = await tx
          .select()
          .from(salesContracts)
          .where(
            and(
              eq(salesContracts.orgId, orgId),
              inArray(salesContracts.status, ['signed', 'in_design']),
            ),
          )
          .limit(100);
        for (const c of contracts) {
          if (c.jobId) continue;
          const age = ageDays(c.createdAt, now);
          if (age < 14) continue;
          out.push({
            id: `contract_at_risk:${c.id}`,
            kind: 'contract_at_risk',
            severity: 'normal',
            title: `Contract at risk: ${c.planName ?? 'unnamed plan'}${c.lotLabel ? ` on lot ${c.lotLabel}` : ''}`,
            detail: `${c.status.replaceAll('_', ' ')} for ${age} days with no construction job linked yet.`,
            provenance: 'estimated',
            sourceType: 'sales_contract',
            sourceId: c.id,
            href: '/home-sales',
            observedAt: now.toISOString(),
          });
        }

        // SWPPP: scheduled within 7 days, or corrective action past due (observed dates).
        const swppp = await tx
          .select()
          .from(swpppInspections)
          .where(
            and(
              eq(swpppInspections.orgId, orgId),
              inArray(swpppInspections.status, ['scheduled', 'corrective_action']),
            ),
          )
          .limit(100);
        for (const s of swppp) {
          if (s.status === 'corrective_action' && s.correctiveActionDueOn && s.correctiveActionDueOn < today) {
            out.push({
              id: `swppp_due:${s.id}`,
              kind: 'swppp_due',
              severity: 'high',
              title: 'SWPPP corrective action overdue',
              detail: `Corrective action was due ${s.correctiveActionDueOn} (${daysBetween(s.correctiveActionDueOn, today)} days ago).`,
              provenance: 'observed',
              sourceType: 'swppp_inspection',
              sourceId: s.id,
              href: '/land-management',
              observedAt: now.toISOString(),
            });
          } else if (s.status === 'scheduled' && s.scheduledOn <= in7Days) {
            out.push({
              id: `swppp_due:${s.id}`,
              kind: 'swppp_due',
              severity: 'low',
              title: 'SWPPP inspection coming up',
              detail: `Scheduled for ${s.scheduledOn}${s.inspectorName ? ` with ${s.inspectorName}` : ''}.`,
              provenance: 'observed',
              sourceType: 'swppp_inspection',
              sourceId: s.id,
              href: '/land-management',
              observedAt: now.toISOString(),
            });
          }
        }

  const severityRank = { high: 0, normal: 1, low: 2 } as const;
  out.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  return out;
}

const attentionModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/attention/feed',
    {
      config: { permission: READ },
      schema: {
        tags: ['attention'],
        summary: 'Proactive attention feed computed from this company\u2019s records',
        response: { 200: AttentionFeedSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const now = new Date();
      const items = await tenantTx(request, (tx) => buildFeed(tx, orgId, now));
      const counts: Record<string, number> = {};
      for (const item of items) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
      return { items, generatedAt: now.toISOString(), counts };
    },
  );

  app.post(
    '/attention/summary',
    {
      config: { permission: READ, rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['attention'],
        summary: 'AI summary of the attention feed (honest not_connected state when no model answers)',
        body: z.object({}).optional(),
        response: { 200: AttentionSummarySchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { homeAi, openModel } = request.server.config;
      const tries = [homeAi, openModel].filter(
        (s): s is NonNullable<typeof s> => s !== null && s !== undefined,
      );
      if (!tries.length) {
        return {
          summary: null,
          state: 'not_connected' as const,
          note: 'No AI model is set up on this server, so there is no AI summary. The feed below is computed from your records and works without AI.',
        };
      }
      // The model only ever sees feed items computed from records — it never invents them.
      const items = await tenantTx(request, (tx) => buildFeed(tx, orgId, new Date()));
      const lines = items
        .slice(0, 40)
        .map((i) => `- [${i.severity}] ${i.title} — ${i.detail}`)
        .join('\n');
      const prompt =
        'You are summarizing a construction company\u2019s attention feed for its owner. ' +
        'Write a short plain-language summary (3-5 sentences) of what needs attention first. ' +
        'Use ONLY the items below; do not invent numbers, names, or records.\n\n' +
        (lines || '(The feed is empty — nothing needs attention.)');
      for (const settings of tries) {
        try {
          const answer = await chatOpenModel(settings, {
            messages: [{ role: 'user', content: prompt }],
            maxTokens: 400,
          });
          return {
            summary: answer,
            state: 'ok' as const,
            note: 'AI summary of the feed items above. The items themselves come from your records.',
          };
        } catch (error) {
          request.log.warn({ err: error }, 'attention summary model failed, trying the next one');
        }
      }
      return {
        summary: null,
        state: 'not_connected' as const,
        note: 'No AI model answered right now, so there is no AI summary. The feed below is computed from your records and works without AI.',
      };
    },
  );
};

export default attentionModule;
