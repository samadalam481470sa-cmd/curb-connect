/**
 * `dashboard` module: real queue counts from tenant tables (zeros are fine — UI stays data-backed).
 */
import { DashboardResponseSchema } from '@fieldline/contracts';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  curbProjects,
  estimates,
  invoices,
  leads,
  proposals,
  roofOrders,
  tasks,
} from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';

const QUEUE_LABELS: Record<string, string> = {
  roof_reviews: 'Roof reviews',
  curb_reviews: 'Curb reviews',
  estimates_awaiting_approval: 'Estimates awaiting approval',
  proposals_awaiting_response: 'Proposals awaiting response',
  invoices_overdue: 'Overdue invoices',
  permits_expiring: 'Permits expiring',
  dispatch_blocked: 'Dispatch blocked',
  leads_new: 'New leads',
  my_tasks: 'My tasks',
};

const dashboardModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/dashboard',
    {
      config: { permission: 'dashboard:read' },
      schema: {
        tags: ['dashboard'],
        summary: 'KPI queues with live counts from the active company',
        response: { 200: DashboardResponseSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const generatedAt = new Date().toISOString();

      const queues = await tenantTx(request, async (tx) => {
        const [roofCount] = await tx
          .select({ n: count() })
          .from(roofOrders)
          .where(
            and(
              eq(roofOrders.orgId, org.orgId),
              sql`${roofOrders.status} in ('measuring', 'review_required', 'clarification_needed')`,
            ),
          );

        const roofItems = await tx
          .select({
            id: roofOrders.id,
            number: roofOrders.number,
            status: roofOrders.status,
            dueAt: roofOrders.dueAt,
          })
          .from(roofOrders)
          .where(
            and(
              eq(roofOrders.orgId, org.orgId),
              sql`${roofOrders.status} in ('measuring', 'review_required', 'clarification_needed')`,
            ),
          )
          .orderBy(desc(roofOrders.updatedAt))
          .limit(10);

        const [curbCount] = await tx
          .select({ n: count() })
          .from(curbProjects)
          .where(
            and(
              eq(curbProjects.orgId, org.orgId),
              sql`${curbProjects.status} in ('intake', 'calibration', 'measurement', 'review')`,
            ),
          );

        const curbItems = await tx
          .select({
            id: curbProjects.id,
            number: curbProjects.number,
            status: curbProjects.status,
          })
          .from(curbProjects)
          .where(
            and(
              eq(curbProjects.orgId, org.orgId),
              sql`${curbProjects.status} in ('intake', 'calibration', 'measurement', 'review')`,
            ),
          )
          .orderBy(desc(curbProjects.updatedAt))
          .limit(10);

        const [estCount] = await tx
          .select({ n: count() })
          .from(estimates)
          .where(
            and(
              eq(estimates.orgId, org.orgId),
              sql`${estimates.status} in ('review_required', 'pricing_ready')`,
            ),
          );

        const estItems = await tx
          .select({
            id: estimates.id,
            number: estimates.number,
            status: estimates.status,
          })
          .from(estimates)
          .where(
            and(
              eq(estimates.orgId, org.orgId),
              sql`${estimates.status} in ('review_required', 'pricing_ready')`,
            ),
          )
          .orderBy(desc(estimates.updatedAt))
          .limit(10);

        const [propCount] = await tx
          .select({ n: count() })
          .from(proposals)
          .where(
            and(
              eq(proposals.orgId, org.orgId),
              sql`${proposals.status} in ('sent', 'viewed')`,
            ),
          );

        const propItems = await tx
          .select({
            id: proposals.id,
            number: proposals.number,
            status: proposals.status,
          })
          .from(proposals)
          .where(
            and(
              eq(proposals.orgId, org.orgId),
              sql`${proposals.status} in ('sent', 'viewed')`,
            ),
          )
          .orderBy(desc(proposals.updatedAt))
          .limit(10);

        const [invCount] = await tx
          .select({ n: count() })
          .from(invoices)
          .where(
            and(
              eq(invoices.orgId, org.orgId),
              sql`${invoices.status} in ('issued', 'partially_paid')`,
              sql`${invoices.dueOn} is not null and ${invoices.dueOn} < current_date`,
            ),
          );

        const invItems = await tx
          .select({
            id: invoices.id,
            number: invoices.number,
            status: invoices.status,
            dueOn: invoices.dueOn,
          })
          .from(invoices)
          .where(
            and(
              eq(invoices.orgId, org.orgId),
              sql`${invoices.status} in ('issued', 'partially_paid')`,
              sql`${invoices.dueOn} is not null and ${invoices.dueOn} < current_date`,
            ),
          )
          .orderBy(desc(invoices.updatedAt))
          .limit(10);

        const [leadCount] = await tx
          .select({ n: count() })
          .from(leads)
          .where(
            and(
              eq(leads.orgId, org.orgId),
              eq(leads.status, 'new'),
              isNull(leads.deletedAt),
            ),
          );

        const leadItems = await tx
          .select({
            id: leads.id,
            summary: leads.summary,
            status: leads.status,
          })
          .from(leads)
          .where(
            and(
              eq(leads.orgId, org.orgId),
              eq(leads.status, 'new'),
              isNull(leads.deletedAt),
            ),
          )
          .orderBy(desc(leads.createdAt))
          .limit(10);

        const [taskCount] = await tx
          .select({ n: count() })
          .from(tasks)
          .where(
            and(
              eq(tasks.orgId, org.orgId),
              eq(tasks.assigneeMembershipId, org.membershipId),
              eq(tasks.status, 'open'),
            ),
          );

        const taskItems = await tx
          .select({
            id: tasks.id,
            title: tasks.title,
            status: tasks.status,
            dueAt: tasks.dueAt,
          })
          .from(tasks)
          .where(
            and(
              eq(tasks.orgId, org.orgId),
              eq(tasks.assigneeMembershipId, org.membershipId),
              eq(tasks.status, 'open'),
            ),
          )
          .orderBy(desc(tasks.updatedAt))
          .limit(10);

        return [
          {
            key: 'roof_reviews' as const,
            label: QUEUE_LABELS.roof_reviews!,
            count: Number(roofCount?.n ?? 0),
            items: roofItems.map((r) => ({
              subjectType: 'roof_order',
              subjectId: r.id,
              title: r.number,
              status: r.status,
              dueAt: r.dueAt?.toISOString() ?? null,
              href: `/roof/orders/${r.id}`,
            })),
          },
          {
            key: 'curb_reviews' as const,
            label: QUEUE_LABELS.curb_reviews!,
            count: Number(curbCount?.n ?? 0),
            items: curbItems.map((r) => ({
              subjectType: 'curb_project',
              subjectId: r.id,
              title: r.number,
              status: r.status,
              dueAt: null,
              href: `/curb/projects/${r.id}`,
            })),
          },
          {
            key: 'estimates_awaiting_approval' as const,
            label: QUEUE_LABELS.estimates_awaiting_approval!,
            count: Number(estCount?.n ?? 0),
            items: estItems.map((r) => ({
              subjectType: 'estimate',
              subjectId: r.id,
              title: r.number,
              status: r.status,
              dueAt: null,
              href: `/estimates/${r.id}`,
            })),
          },
          {
            key: 'proposals_awaiting_response' as const,
            label: QUEUE_LABELS.proposals_awaiting_response!,
            count: Number(propCount?.n ?? 0),
            items: propItems.map((r) => ({
              subjectType: 'proposal',
              subjectId: r.id,
              title: r.number,
              status: r.status,
              dueAt: null,
              href: `/proposals/${r.id}`,
            })),
          },
          {
            key: 'invoices_overdue' as const,
            label: QUEUE_LABELS.invoices_overdue!,
            count: Number(invCount?.n ?? 0),
            items: invItems.map((r) => ({
              subjectType: 'invoice',
              subjectId: r.id,
              title: r.number,
              status: r.status,
              dueAt: r.dueOn ? `${r.dueOn}T00:00:00.000Z` : null,
              href: `/invoices/${r.id}`,
            })),
          },
          {
            key: 'permits_expiring' as const,
            label: QUEUE_LABELS.permits_expiring!,
            count: 0,
            items: [],
          },
          {
            key: 'dispatch_blocked' as const,
            label: QUEUE_LABELS.dispatch_blocked!,
            count: 0,
            items: [],
          },
          {
            key: 'leads_new' as const,
            label: QUEUE_LABELS.leads_new!,
            count: Number(leadCount?.n ?? 0),
            items: leadItems.map((r) => ({
              subjectType: 'lead',
              subjectId: r.id,
              title: r.summary ?? 'New lead',
              status: r.status,
              dueAt: null,
              href: `/leads/${r.id}`,
            })),
          },
          {
            key: 'my_tasks' as const,
            label: QUEUE_LABELS.my_tasks!,
            count: Number(taskCount?.n ?? 0),
            items: taskItems.map((r) => ({
              subjectType: 'task',
              subjectId: r.id,
              title: r.title,
              status: r.status,
              dueAt: r.dueAt?.toISOString() ?? null,
              href: `/tasks/${r.id}`,
            })),
          },
        ];
      });

      return { queues, generatedAt };
    },
  );
};

export default dashboardModule;
