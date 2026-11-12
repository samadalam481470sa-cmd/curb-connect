import { eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { invoices, networkBills } from '../../db/schema';
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
};
export default dashboardModule;
