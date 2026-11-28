// Operational jobs and permission-checked contractor bidding. No simulated opportunities:
// only actual records from authenticated organizations are returned.
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { JOB_ORIGINS, PRODUCT_LINES } from '@fieldline/contracts';
import { z } from 'zod';
import { contacts, customers, jobs, jobEvents, bidOpportunities, bidOffers, organizations } from '../../db/schema';
import { platformTx, requireOrg, tenantTx } from '../../http/context';
import { HttpProblem, problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { createWorkAssignment } from '../../services/assignments';
import { notifyCompany } from '../../services/invoice-exchange';
import { customerStatusRoutes, moveJobStage } from './customerStatus';

const UUID = z.uuid();
const Id = z.object({ id: UUID });
const Money = z.number().int().safe().min(1).max(1_000_000_000_000);
const Trade = z.enum(['roof','curb','plumbing','hvac','electrical','concrete','general','other']);
const Stage = z.enum(['intake','estimating','scheduled','in_progress','completed']);
const JobInput = z.object({
  title: z.string().trim().min(4).max(180),
  productLine: z.enum(PRODUCT_LINES),
  /** Where the job came from. Hand-created jobs are 'manual'; 'estimate'/'permit_lead'
   * record work that arrived through an estimate or a permit lead handled outside Field Pro
   * until those flows can create jobs themselves. */
  origin: z.enum(JOB_ORIGINS).default('manual'),
  customerId: UUID.nullable().optional(),
  contactId: UUID.nullable().optional(),
  estimatedValueMinor: z.number().int().min(0).max(1_000_000_000_000).nullable().optional(),
});
const PostInput = z.object({
  title: z.string().trim().min(4).max(180),
  description: z.string().trim().min(10).max(8000),
  trade: Trade,
  city: z.string().trim().min(2).max(100),
  region: z.string().trim().min(2).max(100),
  budgetMinor: z.number().int().min(0).max(1_000_000_000_000).nullable().optional(),
  dueOn: z.iso.date().nullable().optional(),
  visibility: z.enum(['connections','marketplace']),
}).refine((post)=>!post.dueOn || post.dueOn>=new Date().toISOString().slice(0,10), {
  path:['dueOn'],
  message:'Bid deadline cannot be in the past.',
});
const OfferInput = z.object({
  amountMinor: Money,
  estimatedDays: z.number().int().min(1).max(3650).nullable().optional(),
  message: z.string().trim().min(10).max(4000),
});
const StateInput = z.object({
  decision: z.enum(['accepted','declined']),
  /** On accept, also create a work assignment to the winning bidder (only when they are
   * an active connection; otherwise the award still stands and the response says why). */
  createAssignment: z.boolean().optional(),
});

/** Whether a bid decision should attempt the award assignment (pure; unit-tested). */
export function bidAwardAssignmentPlan(input: { decision: string; createAssignment?: boolean }): { attempt: boolean } {
  return { attempt: input.decision === 'accepted' && input.createAssignment === true };
}

/** Honest note for the award-assignment outcome (pure; unit-tested). */
export function bidAwardAssignmentNote(outcome: 'created' | 'not_connected' | 'failed'): string {
  switch (outcome) {
    case 'created':
      return 'Work assignment created for the winning bidder.';
    case 'not_connected':
      return 'The bid was awarded, but no work assignment was created: the winning company is not an active connection. Connect in the Network first, then assign the work from Assignments.';
    case 'failed':
      return 'The bid was awarded, but the work assignment could not be created. Assign the work from Assignments.';
  }
}
const JobStageInput = z.object({ stage: Stage });

const jobDto = (r: typeof jobs.$inferSelect) => ({
  id:r.id, number:r.number, title:r.title, productLine:r.productLine,
  origin:r.origin, customerId:r.customerId, contactId:r.contactId,
  stage:r.stageKey, status:r.status, estimatedValueMinor:r.estimatedValueMinor,
  currency:r.currency, createdAt:r.createdAt.toISOString(), updatedAt:r.updatedAt.toISOString(),
});
const postDto = (r: typeof bidOpportunities.$inferSelect, ownerName:string,
  offerCount:number, myOfferStatus:string|null) => ({
  id:r.id, ownerOrgId:r.orgId, ownerName, title:r.title, description:r.description,
  trade:r.trade, city:r.city, region:r.region, currency:r.currency,
  budgetMinor:r.budgetMinor, dueOn:r.dueOn, visibility:r.visibility,
  status:r.status, createdAt:r.createdAt.toISOString(), offerCount, myOfferStatus,
});
const offerDto = (r: typeof bidOffers.$inferSelect) => ({
  id:r.id, opportunityId:r.opportunityId, bidderOrgId:r.bidderOrgId,
  bidderName:r.bidderName, amountMinor:r.amountMinor, estimatedDays:r.estimatedDays,
  message:r.message, status:r.status, createdAt:r.createdAt.toISOString(),
});

/** Shared only to existing project-scoped network connections, or to the opted-in marketplace. */
function allowedToBid(orgId:string) {
  return sql`(
    (p.visibility = 'marketplace' AND o.directory_opt_in = true AND o.status = 'active'
      AND o.is_demo = false)
    OR
    (p.visibility = 'connections'
      AND EXISTS (SELECT 1 FROM public.company_connections c
        WHERE c.org_id = ${orgId}::uuid AND c.partner_org_id = p.org_id
          AND c.status = 'active' AND 'projects' = ANY(c.scopes))
      AND EXISTS (SELECT 1 FROM public.company_connections c2
        WHERE c2.org_id = p.org_id AND c2.partner_org_id = ${orgId}::uuid
          AND c2.status = 'active' AND 'projects' = ANY(c2.scopes)))
  )`;
}

const jobsModule: FastifyPluginAsyncZod = async (app) => {
  app.get('/jobs', {
    config:{permission:'job:read'},
    schema:{tags:['jobs'],summary:'Jobs in your company pipeline; ?updatedSince=<ISO> returns only changes since then, plus deletedIds and serverTime for offline delta sync',
      querystring:z.object({updatedSince:z.string().datetime().optional()})},
  },async(request)=>{
    const {orgId}=requireOrg(request);
    const since=request.query.updatedSince?new Date(request.query.updatedSince):null;
    const serverTime=new Date().toISOString();
    const {rows,deleted}=await tenantTx(request,async tx=>{
      const rows=await tx.select().from(jobs)
        .where(and(eq(jobs.orgId,orgId),sql`${jobs.deletedAt} IS NULL`,
          since?sql`${jobs.updatedAt} > ${since}`:undefined))
        .orderBy(desc(jobs.createdAt)).limit(since?500:100);
      const deleted=since?await tx.select({id:jobs.id}).from(jobs)
        .where(and(eq(jobs.orgId,orgId),sql`${jobs.deletedAt} IS NOT NULL`,
          sql`${jobs.updatedAt} > ${since}`)).limit(500):[];
      return {rows,deleted};
    });
    return {items:rows.map(jobDto),deletedIds:deleted.map(d=>d.id),serverTime};
  });
  app.post('/jobs',{
    config:{permission:'job:write',rateLimit:{max:30,timeWindow:'1 minute'}},
    schema:{tags:['jobs'],body:JobInput,summary:'Create a real job in this company'},
  },async(request,reply)=>{
    const {orgId}=requireOrg(request);
    const [row]=await tenantTx(request,async tx=>{
      // A linked customer/contact must belong to this company; a stranger's id is a
      // validation error, never silently dropped or attached to the wrong company.
      if(request.body.customerId){
        const [owner]=await tx.select({id:customers.id}).from(customers).where(and(
          eq(customers.orgId,orgId),eq(customers.id,request.body.customerId),
          sql`${customers.deletedAt} IS NULL`)).limit(1);
        if(!owner)throw problem('validation_failed','That customer does not exist in this company.');
      }
      if(request.body.contactId){
        const [person]=await tx.select({id:contacts.id,customerId:contacts.customerId}).from(contacts).where(and(
          eq(contacts.orgId,orgId),eq(contacts.id,request.body.contactId),
          sql`${contacts.deletedAt} IS NULL`)).limit(1);
        if(!person)throw problem('validation_failed','That contact does not exist in this company.');
        if(request.body.customerId&&person.customerId!==request.body.customerId)
          throw problem('validation_failed','That contact does not belong to the selected customer.');
      }
      const [created]=await tx.insert(jobs).values({
        orgId,number:'JOB-'+randomUUID().slice(0,8).toUpperCase(),
        title:request.body.title,productLine:request.body.productLine,
        origin:request.body.origin,
        customerId:request.body.customerId??null,
        contactId:request.body.contactId??null,
        estimatedValueMinor:request.body.estimatedValueMinor??null,
        stageKey:'intake',status:'open',
      }).returning();
      if(created) {
        await tx.insert(jobEvents).values({
          orgId, jobId:created.id, eventType:'job_created', actorType:'user',
          actorUserId:requireOrg(request).userId, fromStage:null, toStage:created.stageKey,
          correlationId:request.id,
        });
        await auditRequest(request,tx,{orgId,action:'job.created',
          resourceType:'job',resourceId:created.id,after:{title:created.title}});
      }
      return [created];
    });
    if(!row)throw problem('internal');
    reply.code(201);return jobDto(row);
  });
  app.patch('/jobs/:id/stage',{
    config:{permission:'job:move_stage',rateLimit:{max:60,timeWindow:'1 minute'}},
    schema:{tags:['jobs'],params:Id,body:JobStageInput,summary:'Move a job to the next stage'},
  },async(request)=>{
    const {orgId}=requireOrg(request);
    const row=await tenantTx(request,async tx=>{
      const [current]=await tx.select().from(jobs).where(and(eq(jobs.orgId,orgId),
        eq(jobs.id,request.params.id))).for('update');
      if(!current||current.deletedAt)throw problem('not_found');
      return moveJobStage(request,tx,current,request.body.stage);
    });
    return jobDto(row);
  });
  await customerStatusRoutes(app,{});

  app.get('/bidding/opportunities',{
    config:{permission:'job:read'},
    schema:{tags:['bidding'],summary:'Owned and shared opportunities visible to this company'},
  },async(request,reply)=>{
    reply.header('cache-control','private, no-store');
    const org=requireOrg(request);
    const eligible=allowedToBid(org.orgId);
    const rows=await platformTx(request,'bidding.read',tx=>tx.execute(sql<{
      id:string;owner_org_id:string;owner_name:string;
      offer_count:number;my_offer_status:string|null;
    }>`SELECT p.id, p.org_id AS owner_org_id, o.display_name AS owner_name,
      (SELECT count(*)::int FROM public.bid_offers b
        WHERE b.org_id = p.org_id AND b.opportunity_id = p.id) AS offer_count,
      (SELECT b.status FROM public.bid_offers b WHERE b.org_id=p.org_id
        AND b.opportunity_id=p.id AND b.bidder_org_id=${org.orgId}::uuid LIMIT 1) AS my_offer_status
      FROM public.bid_opportunities p
      INNER JOIN public.organizations o ON o.id=p.org_id
      WHERE p.org_id=${org.orgId}::uuid OR
        (p.status='open' AND p.org_id<>${org.orgId}::uuid
          AND (p.due_on IS NULL OR p.due_on >= CURRENT_DATE) AND ${eligible})
      ORDER BY p.created_at DESC LIMIT 100`),{orgId:org.orgId,userId:org.userId});
    // Read actual rows through the restricted connection; the marketplace operation above only
    // selects authorized IDs and sanitized cross-company metadata. Do not expose private fields.
    const marketRows=rows as unknown as {id:string;owner_name:string;offer_count:number;my_offer_status:string|null}[];
    const refs=marketRows.map(row=>row.id);
    if(!refs.length)return {items:[]};
    const details=await platformTx(request,'bidding.read',tx=>tx.select()
      .from(bidOpportunities).where(sql`${bidOpportunities.id} IN (${sql.join(refs.map(id=>sql`${id}::uuid`),sql`,`)})`),
      {orgId:org.orgId,userId:org.userId});
    const byId=new Map(marketRows.map(row=>[row.id,row]));
    return {items:details.map(detail=>{
      const meta=byId.get(detail.id)!;
      return postDto(detail,meta.owner_name,meta.offer_count,meta.my_offer_status);
    }).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))};
  });
  app.post('/bidding/opportunities',{
    config:{permission:'job:write',rateLimit:{max:20,timeWindow:'1 minute'}},
    schema:{tags:['bidding'],body:PostInput,summary:'Publish a contractor job invitation'},
  },async(request,reply)=>{
    const org=requireOrg(request);
    const created=await tenantTx(request,async tx=>{
      const [owner]=await tx.select().from(organizations).where(eq(organizations.id,org.orgId));
      if(!owner)throw problem('not_found');
      if(request.body.visibility==='marketplace'&&!owner.directoryOptIn)
        throw problem('forbidden','Enable your company directory listing in Network before public bidding.');
      const [row]=await tx.insert(bidOpportunities).values({
        orgId:org.orgId,authorUserId:org.userId,...request.body,
        budgetMinor:request.body.budgetMinor??null,dueOn:request.body.dueOn??null,
        currency:owner.currency,
      }).returning();
      if(!row)throw problem('internal');
      await auditRequest(request,tx,{orgId:org.orgId,action:'bidding.posted',
        resourceType:'bid_opportunity',resourceId:row.id,after:{visibility:row.visibility,title:row.title}});
      return {row,name:owner.displayName};
    });
    reply.code(201);return postDto(created.row,created.name,0,null);
  });
  app.post('/bidding/opportunities/:id/close',{
    config:{permission:'job:write',rateLimit:{max:20,timeWindow:'1 minute'}},
    schema:{tags:['bidding'],params:Id,summary:'Close a posted opportunity'},
  },async(request)=>{
    const org=requireOrg(request);
    return tenantTx(request,async tx=>{
      const [row]=await tx.update(bidOpportunities).set({status:'closed',updatedAt:new Date(),
        revision:sql`${bidOpportunities.revision}+1`})
        .where(and(eq(bidOpportunities.orgId,org.orgId),eq(bidOpportunities.id,request.params.id),
          eq(bidOpportunities.status,'open'))).returning();
      if(!row)throw problem('conflict','This opportunity is already closed or not yours.');
      await auditRequest(request,tx,{orgId:org.orgId,action:'bidding.closed',
        resourceType:'bid_opportunity',resourceId:row.id});
      return {ok:true};
    });
  });
  app.get('/bidding/opportunities/:id/offers',{
    config:{permission:'job:read'},
    schema:{tags:['bidding'],params:Id,summary:'See bids on owned opportunities, or your own bid'},
  },async(request,reply)=>{
    reply.header('cache-control','private, no-store');
    const org=requireOrg(request);
    const rows=await platformTx(request,'bidding.read',async tx=>{
      const [post]=await tx.select({orgId:bidOpportunities.orgId}).from(bidOpportunities)
        .where(eq(bidOpportunities.id,request.params.id)).limit(1);
      if(!post)throw problem('not_found');
      return tx.select().from(bidOffers).where(and(
        eq(bidOffers.opportunityId,request.params.id),
        post.orgId===org.orgId?eq(bidOffers.orgId,org.orgId):eq(bidOffers.bidderOrgId,org.orgId),
      )).orderBy(desc(bidOffers.createdAt));
    },{orgId:org.orgId,userId:org.userId});
    return {items:rows.map(offerDto)};
  });
  app.post('/bidding/opportunities/:id/offers',{
    config:{permission:'job:write',rateLimit:{max:15,timeWindow:'1 minute'}},
    schema:{tags:['bidding'],params:Id,body:OfferInput,summary:'Submit one binding-review bid per company'},
  },async(request,reply)=>{
    const org=requireOrg(request);
    const eligible=allowedToBid(org.orgId);
    const created=await platformTx(request,'bidding.submit',async tx=>{
      const found=await tx.execute(sql<{id:string;org_id:string;title:string}>`
        SELECT p.id,p.org_id,p.title FROM public.bid_opportunities p
          JOIN public.organizations o ON o.id=p.org_id
          WHERE p.id=${request.params.id}::uuid AND p.org_id<>${org.orgId}::uuid
            AND p.status='open' AND (p.due_on IS NULL OR p.due_on >= CURRENT_DATE)
            AND ${eligible} FOR UPDATE OF p`);
      const post=found[0] as {id:string;org_id:string;title:string}|undefined;
      if(!post)throw problem('forbidden','This invitation is unavailable or not shared with your company.');
      const [bidder]=await tx.select({name:organizations.displayName})
        .from(organizations).where(eq(organizations.id,org.orgId));
      if(!bidder)throw problem('not_found');
      const [existing]=await tx.select({id:bidOffers.id}).from(bidOffers)
        .where(and(eq(bidOffers.opportunityId,post.id),eq(bidOffers.bidderOrgId,org.orgId)))
        .limit(1);
      if(existing)throw problem('conflict','Your company already submitted a bid for this job.');
      const [offer]=await tx.insert(bidOffers).values({
        orgId:post.org_id,opportunityId:post.id,bidderOrgId:org.orgId,
        bidderUserId:org.userId,bidderName:bidder.name,
        amountMinor:request.body.amountMinor,estimatedDays:request.body.estimatedDays??null,
        message:request.body.message,
      }).returning();
      if(!offer)throw problem('internal');
      await auditRequest(request,tx,{orgId:org.orgId,action:'bidding.offer_submitted',
        resourceType:'bid_offer',resourceId:offer.id,
        after:{opportunityId:post.id,recipientOrgId:post.org_id}});
      await notifyCompany(tx,{orgId:post.org_id,category:'system',
        title:'New bid for '+post.title,body:bidder.name+' submitted a job bid.',
        link:'/bidding',dedupeKey:'bid-offer:'+offer.id,correlationId:request.id});
      return offer;
    },{orgId:org.orgId,userId:org.userId});
    reply.code(201);return offerDto(created);
  });
  app.post('/bidding/offers/:id/decision',{
    config:{permission:'job:write',rateLimit:{max:30,timeWindow:'1 minute'}},
    schema:{tags:['bidding'],params:Id,body:StateInput,summary:'Owner accepts or declines a submitted offer; on accept, optionally creates a work assignment to the winner'},
  },async(request)=>{
    const org=requireOrg(request);
    const awarded=await tenantTx(request,async tx=>{
      const [offer]=await tx.select().from(bidOffers)
        .where(and(eq(bidOffers.orgId,org.orgId),eq(bidOffers.id,request.params.id))).for('update');
      if(!offer)throw problem('not_found');
      if(offer.status!=='submitted')throw problem('conflict','This offer has already been decided.');
      const [post]=await tx.select().from(bidOpportunities)
        .where(and(eq(bidOpportunities.orgId,org.orgId),eq(bidOpportunities.id,offer.opportunityId))).for('update');
      if(!post||post.status!=='open')throw problem('conflict','The job invitation is not open.');
      const [updated]=await tx.update(bidOffers).set({
        status:request.body.decision,revision:sql`${bidOffers.revision}+1`,updatedAt:new Date(),
      }).where(eq(bidOffers.id,offer.id)).returning();
      if(request.body.decision==='accepted')await tx.update(bidOpportunities).set({
        status:'awarded',revision:sql`${bidOpportunities.revision}+1`,updatedAt:new Date(),
      }).where(and(eq(bidOpportunities.orgId,org.orgId),eq(bidOpportunities.id,post.id)));
      await auditRequest(request,tx,{orgId:org.orgId,action:'bidding.offer_decided',
        resourceType:'bid_offer',resourceId:offer.id,after:{decision:request.body.decision}});
      return {offer:updated!,post};
    });
    // Optional award assignment: the award above already committed, so a failed
    // assignment (e.g. the winner is not an active connection) never fails the award —
    // the response carries an honest note instead.
    let assignmentId:string|null=null;
    let assignmentNote:string|null=null;
    if(bidAwardAssignmentPlan(request.body).attempt){
      try{
        const row=await createWorkAssignment(request,{
          orgId:org.orgId,
          userId:org.userId,
          partnerOrgId:awarded.offer.bidderOrgId,
          kind:'job',
          title:awarded.post.title,
          description:awarded.post.description,
          subjectType:'bid_opportunity',
          subjectId:awarded.post.id,
          dueOn:awarded.post.dueOn,
          payload:{
            bidAmountMinor:awarded.offer.amountMinor,
            budgetTotalMinor:awarded.offer.amountMinor,
            budgetSource:'bid_amount',
            snapshotAt:new Date().toISOString(),
          },
        });
        assignmentId=row.id;
        assignmentNote=bidAwardAssignmentNote('created');
      }catch(error){
        assignmentNote=bidAwardAssignmentNote(
          error instanceof HttpProblem&&error.init.code==='conflict'?'not_connected':'failed',
        );
      }
    }
    return {...offerDto(awarded.offer),assignmentId,assignmentNote};
  });
};
export default jobsModule;
