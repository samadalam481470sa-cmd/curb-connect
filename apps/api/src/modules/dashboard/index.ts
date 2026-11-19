import {
  type Action,
  type DASHBOARD_QUEUES,
  DashboardResponseSchema,
} from '@fieldline/contracts';
import { and, asc, desc, eq, inArray, isNotNull, lt, lte, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import {
  curbProjects,
  dispatches,
  estimates,
  invoices,
  jobs,
  leads,
  networkBills,
  permitRequirements,
  proposals,
  roofOrders,
  tasks,
} from '../../db/schema';
import { assertCan, requireOrg, tenantTx } from '../../http/context';
const GroupSchema=z.object({
 currency:z.string(), draftToInvoiceMinor:z.number().int().safe().nonnegative(),
 draftCount:z.number().int().nonnegative(), sentMinor:z.number().int().safe().nonnegative(),
 sentCount:z.number().int().nonnegative(),receivableMinor:z.number().int().safe().nonnegative(),
 receivedMinor:z.number().int().safe().nonnegative(),receivedCount:z.number().int().nonnegative(),
 payableMinor:z.number().int().safe().nonnegative(),paidIncomingMinor:z.number().int().safe().nonnegative(),
});
const ResponseSchema=z.object({generatedAt:z.iso.datetime(),
 scope:z.literal('all_company_invoices_and_received_bills'),groups:z.array(GroupSchema)});
type Group=z.infer<typeof GroupSchema>;
const empty=(currency:string):Group=>({currency,draftToInvoiceMinor:0,draftCount:0,
 sentMinor:0,sentCount:0,receivableMinor:0,receivedMinor:0,receivedCount:0,
 payableMinor:0,paidIncomingMinor:0});
const minor=(v:unknown)=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<0)throw Error('Unsafe financial total');return n;};
/** Tenant-scoped SQL sums over ALL invoices, not one page of results. */
const dashboardModule:FastifyPluginAsyncZod=async(app)=>{
 app.get('/dashboard/invoices-summary',{config:{permission:'invoice:read'},
  schema:{tags:['dashboard'],summary:'Company-wide outgoing and incoming invoice balances',
   response:{200:ResponseSchema}}},async(request)=>{
  assertCan(request,'bill:read');
  const org=requireOrg(request);
  return tenantTx(request,async(tx)=>{
   const outgoing=await tx.select({
    currency:invoices.currency,status:invoices.status,
    count:sql<number>`count(*)::int`,
    total:sql<string>`coalesce(sum(${invoices.totalMinor}),0)::text`,
    paid:sql<string>`coalesce(sum(${invoices.amountPaidMinor}),0)::text`,
    refunds:sql<string>`coalesce(sum(${invoices.amountRefundedMinor}),0)::text`,
    sent:sql<string>`coalesce(sum(${invoices.totalMinor}) filter (where ${invoices.sentAt} is not null),0)::text`,
    sentCount:sql<number>`count(*) filter (where ${invoices.sentAt} is not null)::int`,
   }).from(invoices).where(eq(invoices.orgId,org.orgId)).groupBy(invoices.currency,invoices.status);
   const incoming=await tx.select({
    currency:networkBills.currency,status:networkBills.status,
    count:sql<number>`count(*)::int`,
    total:sql<string>`coalesce(sum(${networkBills.totalMinor}),0)::text`,
   }).from(networkBills).where(eq(networkBills.orgId,org.orgId))
    .groupBy(networkBills.currency,networkBills.status);
   const groups=new Map<string,Group>();
   const get=(currency:string)=>{if(!groups.has(currency))groups.set(currency,empty(currency));return groups.get(currency)!;};
   for(const row of outgoing){
    const g=get(row.currency),total=minor(row.total);
    if(row.status==='draft'||row.status==='pending_approval'){
     g.draftToInvoiceMinor+=total;g.draftCount+=Number(row.count);
    }
    g.sentMinor+=minor(row.sent);g.sentCount+=Number(row.sentCount);
    if(['issued','partially_paid','partially_refunded'].includes(row.status))
     g.receivableMinor+=Math.max(0,total-minor(row.paid)+minor(row.refunds));
   }
   for(const row of incoming){
    const g=get(row.currency),total=minor(row.total);
    g.receivedMinor+=total;g.receivedCount+=Number(row.count);
    if(['received','approved','disputed'].includes(row.status))g.payableMinor+=total;
    if(row.status==='paid')g.paidIncomingMinor+=total;
   }
   return {generatedAt:new Date().toISOString(),
    scope:'all_company_invoices_and_received_bills' as const,
    groups:[...groups.values()].sort((a,b)=>a.currency.localeCompare(b.currency))};
  });
 });

  // PLT-016 B: the home screen's attention queues, each a live tenant-scoped count.
  app.get('/dashboard',{
   config:{permission:'dashboard:read'},
   schema:{tags:['dashboard'],
    summary:'Home attention queues: counts and the first items of real company records',
    response:{200:DashboardResponseSchema}}},async(request)=>{
   const org=requireOrg(request);
   const now=new Date();
   const queues=await tenantTx(request,(tx)=>Promise.all(QUEUES.map(async(queue)=>{
    if(queue.permission&&!org.permissions.has(queue.permission))
     return {key:queue.key,label:`${queue.label} — not available for your role`,
      count:0,items:[]};
    const loaded=await queue.load({tx,orgId:org.orgId,membershipId:org.membershipId,
     today:now.toISOString().slice(0,10),permitHorizon:addDays(now,30)});
    return {key:queue.key,label:queue.label,...loaded};
   })));
   return {queues,generatedAt:now.toISOString()};
  });
};
// ------------------------------------------------------------------ attention queues (PLT-016 B)
// Every count below is a live tenant-scoped query (RLS plus an explicit org filter). Nothing is
// sampled, estimated or cached, and a queue with no rows reports zero rather than invented work.
// A queue whose source records the role may not read is returned empty with the restriction in
// its label: the screen never shows a number the role is not allowed to see, and never pretends
// the queue has no meaning for that role.

type QueueKey = (typeof DASHBOARD_QUEUES)[number];
interface QueueItem {
  subjectType: string;
  subjectId: string;
  title: string;
  status: string;
  dueAt: string | null;
  href: string;
}
interface QueueLoad {
  count: number;
  items: QueueItem[];
}
interface QueueContext {
  tx: Tx;
  orgId: string;
  membershipId: string;
  /** UTC calendar date (`YYYY-MM-DD`), used against date-only columns. */
  today: string;
  /** Last calendar date a permit may expire on and still count as expiring soon. */
  permitHorizon: string;
}
interface QueueDefinition {
  key: QueueKey;
  label: string;
  /** When set, the required read permission. Absent means every member may read the queue. */
  permission?: Action;
  load: (context: QueueContext) => Promise<QueueLoad>;
}

const countSql = sql<number>`count(*)::int`;
const isoOrNull = (value: Date | null) => (value ? value.toISOString() : null);
/** The contract needs an ISO datetime; date-only columns carry no time zone, so UTC midnight. */
const calendarDate = (value: string | null) => (value ? `${value}T00:00:00.000Z` : null);

/** Up to ten items, most urgent first (soonest due, then oldest). */
const QUEUES: readonly QueueDefinition[] = [
  {
    key: 'roof_reviews',
    label: 'Roof measurements awaiting review',
    load: async ({ tx, orgId }) => {
      const where = and(
        eq(roofOrders.orgId, orgId),
        inArray(roofOrders.status, ['review_required', 'clarification_needed']),
      );
      const [counts, rows] = await Promise.all([
        tx.select({ count: countSql }).from(roofOrders).where(where),
        tx
          .select({
            id: roofOrders.id,
            number: roofOrders.number,
            status: roofOrders.status,
            dueAt: roofOrders.dueAt,
          })
          .from(roofOrders)
          .where(where)
          .orderBy(asc(roofOrders.dueAt), desc(roofOrders.createdAt))
          .limit(10),
      ]);
      return {
        count: counts[0]?.count ?? 0,
        items: rows.map((row) => ({
          subjectType: 'roof_order',
          subjectId: row.id,
          title: `Roof order ${row.number}`,
          status: row.status,
          dueAt: isoOrNull(row.dueAt),
          href: '/roof',
        })),
      };
    },
  },
  {
    key: 'curb_reviews',
    label: 'Curb estimates awaiting measurements or review',
    load: async ({ tx, orgId }) => {
      const where = and(
        eq(curbProjects.orgId, orgId),
        inArray(curbProjects.status, ['measurement', 'review']),
      );
      const [counts, rows] = await Promise.all([
        tx.select({ count: countSql }).from(curbProjects).where(where),
        tx
          .select({
            id: curbProjects.id,
            number: curbProjects.number,
            status: curbProjects.status,
            createdAt: curbProjects.createdAt,
          })
          .from(curbProjects)
          .where(where)
          .orderBy(desc(curbProjects.createdAt))
          .limit(10),
      ]);
      return {
        count: counts[0]?.count ?? 0,
        items: rows.map((row) => ({
          subjectType: 'curb_project',
          subjectId: row.id,
          title: `Curb project ${row.number}`,
          status: row.status,
          dueAt: null,
          href: '/curb',
        })),
      };
    },
  },
  {
    key: 'estimates_awaiting_approval',
    label: 'Estimates awaiting approval',
    load: async ({ tx, orgId }) => {
      const where = and(
        eq(estimates.orgId, orgId),
        inArray(estimates.status, ['pricing_ready', 'review_required']),
      );
      const [counts, rows] = await Promise.all([
        tx.select({ count: countSql }).from(estimates).where(where),
        tx
          .select({
            id: estimates.id,
            number: estimates.number,
            productLine: estimates.productLine,
            status: estimates.status,
            createdAt: estimates.createdAt,
          })
          .from(estimates)
          .where(where)
          .orderBy(desc(estimates.createdAt))
          .limit(10),
      ]);
      return {
        count: counts[0]?.count ?? 0,
        items: rows.map((row) => ({
          subjectType: 'estimate',
          subjectId: row.id,
          title: `Estimate ${row.number}`,
          status: row.status,
          dueAt: null,
          // Linked to the product screen that owns the estimate; there is no estimate screen.
          href: row.productLine === 'curb' ? '/curb' : '/roof',
        })),
      };
    },
  },
  {
    key: 'dispatch_blocked',
    label: 'Jobs blocked from dispatch',
    load: async ({ tx, orgId }) => {
      const where = and(eq(dispatches.orgId, orgId), eq(dispatches.status, 'blocked'));
      const [counts, rows] = await Promise.all([
        tx.select({ count: countSql }).from(dispatches).where(where),
        tx
          .select({
            id: dispatches.id,
            jobTitle: jobs.title,
            blockedReasons: dispatches.blockedReasons,
          })
          .from(dispatches)
          .innerJoin(
            jobs,
            and(eq(jobs.orgId, dispatches.orgId), eq(jobs.id, dispatches.jobId)),
          )
          .where(where)
          .orderBy(desc(dispatches.createdAt))
          .limit(10),
      ]);
      return {
        count: counts[0]?.count ?? 0,
        items: rows.map((row) => ({
          subjectType: 'dispatch',
          subjectId: row.id,
          title: row.jobTitle,
          // The recorded blocking reason is the status text; never a generic "blocked".
          status: row.blockedReasons[0] ?? 'blocked',
          dueAt: null,
          href: '/jobs',
        })),
      };
    },
  },
  {
    key: 'permits_expiring',
    label: 'Permits expiring soon',
    load: async ({ tx, orgId, permitHorizon }) => {
      const where = and(
        eq(permitRequirements.orgId, orgId),
        inArray(permitRequirements.status, ['application_prepared', 'submitted', 'approved']),
        isNotNull(permitRequirements.expiresOn),
        lte(permitRequirements.expiresOn, permitHorizon),
      );
      const [counts, rows] = await Promise.all([
        tx.select({ count: countSql }).from(permitRequirements).where(where),
        tx
          .select({
            id: permitRequirements.id,
            permitType: permitRequirements.permitType,
            status: permitRequirements.status,
            expiresOn: permitRequirements.expiresOn,
            projectNumber: curbProjects.number,
          })
          .from(permitRequirements)
          .innerJoin(
            curbProjects,
            and(
              eq(curbProjects.orgId, permitRequirements.orgId),
              eq(curbProjects.id, permitRequirements.curbProjectId),
            ),
          )
          .where(where)
          .orderBy(asc(permitRequirements.expiresOn))
          .limit(10),
      ]);
      return {
        count: counts[0]?.count ?? 0,
        items: rows.map((row) => ({
          subjectType: 'permit_requirement',
          subjectId: row.id,
          title: `${row.permitType} permit · ${row.projectNumber}`,
          status: row.status,
          dueAt: calendarDate(row.expiresOn),
          href: '/curb',
        })),
      };
    },
  },
  {
    key: 'invoices_overdue',
    label: 'Unpaid invoices',
    // Invoice numbers and balances are financial data (PLT-015: not every role may read them).
    permission: 'invoice:read',
    load: async ({ tx, orgId, today }) => {
      const where = and(
        eq(invoices.orgId, orgId),
        inArray(invoices.status, ['issued', 'partially_paid']),
        isNotNull(invoices.dueOn),
        lt(invoices.dueOn, today),
      );
      const [counts, rows] = await Promise.all([
        tx.select({ count: countSql }).from(invoices).where(where),
        tx
          .select({
            id: invoices.id,
            number: invoices.number,
            status: invoices.status,
            dueOn: invoices.dueOn,
          })
          .from(invoices)
          .where(where)
          .orderBy(asc(invoices.dueOn))
          .limit(10),
      ]);
      return {
        count: counts[0]?.count ?? 0,
        items: rows.map((row) => ({
          subjectType: 'invoice',
          subjectId: row.id,
          title: `Invoice ${row.number}`,
          status: row.status,
          dueAt: calendarDate(row.dueOn),
          href: '/invoice-dashboard',
        })),
      };
    },
  },
  {
    key: 'proposals_awaiting_response',
    label: 'Proposals awaiting response',
    load: async ({ tx, orgId }) => {
      const where = and(
        eq(proposals.orgId, orgId),
        inArray(proposals.status, ['sent', 'viewed']),
      );
      const [counts, rows] = await Promise.all([
        tx.select({ count: countSql }).from(proposals).where(where),
        tx
          .select({
            id: proposals.id,
            number: proposals.number,
            title: proposals.title,
            status: proposals.status,
            expiresOn: proposals.expiresOn,
          })
          .from(proposals)
          .where(where)
          .orderBy(asc(proposals.expiresOn), desc(proposals.createdAt))
          .limit(10),
      ]);
      return {
        count: counts[0]?.count ?? 0,
        items: rows.map((row) => ({
          subjectType: 'proposal',
          subjectId: row.id,
          title: `Proposal ${row.number} · ${row.title}`,
          status: row.status,
          dueAt: calendarDate(row.expiresOn),
          href: '/proposals',
        })),
      };
    },
  },
  {
    key: 'leads_new',
    label: 'New leads',
    load: async ({ tx, orgId }) => {
      const where = and(
        eq(leads.orgId, orgId),
        eq(leads.status, 'new'),
        sql`${leads.deletedAt} is null`,
      );
      const [counts, rows] = await Promise.all([
        tx.select({ count: countSql }).from(leads).where(where),
        tx
          .select({
            id: leads.id,
            summary: leads.summary,
            status: leads.status,
            createdAt: leads.createdAt,
          })
          .from(leads)
          .where(where)
          .orderBy(desc(leads.createdAt))
          .limit(10),
      ]);
      return {
        count: counts[0]?.count ?? 0,
        items: rows.map((row) => ({
          subjectType: 'lead',
          subjectId: row.id,
          title: row.summary ?? `Lead ${row.id.slice(0, 8).toUpperCase()}`,
          status: row.status,
          dueAt: null,
          href: '/leads',
        })),
      };
    },
  },
  {
    key: 'my_tasks',
    label: 'My tasks',
    load: async ({ tx, orgId, membershipId }) => {
      const where = and(
        eq(tasks.orgId, orgId),
        eq(tasks.assigneeMembershipId, membershipId),
        inArray(tasks.status, ['open', 'in_progress']),
      );
      const [counts, rows] = await Promise.all([
        tx.select({ count: countSql }).from(tasks).where(where),
        tx
          .select({
            id: tasks.id,
            title: tasks.title,
            status: tasks.status,
            dueAt: tasks.dueAt,
          })
          .from(tasks)
          .where(where)
          .orderBy(asc(tasks.dueAt), asc(tasks.createdAt))
          .limit(10),
      ]);
      return {
        count: counts[0]?.count ?? 0,
        items: rows.map((row) => ({
          subjectType: 'task',
          subjectId: row.id,
          title: row.title,
          status: row.status,
          dueAt: isoOrNull(row.dueAt),
          href: '/jobs',
        })),
      };
    },
  },
];

const addDays = (from: Date, days: number) => {
  const date = new Date(from);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export default dashboardModule;
