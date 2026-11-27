import { createHash } from 'node:crypto';
import {
  CreateEnterpriseSalesLead,
  CreateEnterpriseSalesLeadSource,
  EnterpriseSalesLead,
  EnterpriseSalesLeadInput,
  EnterpriseSalesLeadOptions,
  EnterpriseSalesLeadPage,
  EnterpriseSalesLeadPreview,
  EnterpriseSalesLeadSource,
} from '@fieldline/contracts';
import { and, asc, desc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import {
  enterpriseSalesLeadActivities as activities,
  enterpriseSalesLeadSources as sources,
  enterpriseSalesLeads as leads,
} from '../../db/schema/enterpriseSalesLeads';
import { landCommunities as communities } from '../../db/schema/landManagement';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { checkEnabled } from './access';

const path = '/enterprise/sales/leads';
const intake = { permission: 'enterprise_sales:intake' } as const;
const manage = { permission: 'enterprise_sales:manage' } as const;
const cache = 'private, no-store';

type Input = z.infer<typeof EnterpriseSalesLeadInput>;
type Actor = ReturnType<typeof requireOrg>;
type Lead = typeof leads.$inferSelect;

function digest(data: unknown) {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

function permittedChannels(input: Pick<Input, 'email' | 'phone' | 'consent'>) {
  const channels = ['email', 'phone'] as const;
  const granted = (purpose: keyof Input['consent']) =>
    channels.filter(
      (channel) => Boolean(input[channel]) && input.consent[purpose][channel] === 'granted',
    );
  return {
    permittedInquiryChannels: granted('inquiry'),
    permittedMarketingChannels: granted('marketing'),
  };
}

export function leadScope(actor: Actor) {
  return and(
    eq(leads.orgId, actor.orgId),
    actor.permissions.has('enterprise_sales:manage')
      ? undefined
      : or(
          eq(leads.ownerMembershipId, actor.membershipId),
          and(isNull(leads.ownerMembershipId), eq(leads.createdByUserId, actor.userId)),
        ),
  );
}

function readLeads(tx: Tx) {
  return tx
    .select({
      lead: leads,
      source: { id: sources.id, name: sources.name },
      community: { id: communities.id, name: communities.name },
    })
    .from(leads)
    .innerJoin(sources, and(eq(sources.orgId, leads.orgId), eq(sources.id, leads.sourceId)))
    .leftJoin(
      communities,
      and(eq(communities.orgId, leads.orgId), eq(communities.id, leads.communityId)),
    );
}

function dto({
  lead,
  source,
  community,
}: {
  lead: Lead;
  source: z.infer<typeof EnterpriseSalesLeadSource>;
  community: { id: string; name: string } | null;
}) {
  const { id, name, email, phone, contactMethod, consent, possibleDuplicate, revision, createdAt } =
    lead;
  return {
    id,
    name,
    email,
    phone,
    source,
    community,
    contactMethod,
    consent,
    possibleDuplicate,
    revision,
    createdAt: createdAt.toISOString(),
    ...permittedChannels({ email: email ?? undefined, phone: phone ?? undefined, consent }),
  };
}

async function review(tx: Tx, actor: Actor, input: Input) {
  const { orgId } = actor;
  const [source] = await tx
    .select({ id: sources.id, name: sources.name })
    .from(sources)
    .where(and(eq(sources.orgId, orgId), eq(sources.id, input.sourceId)));
  if (!source) throw problem('not_found', 'Choose an available lead source.');
  let community = null;
  if (input.communityId) {
    const [current] = await tx
      .select({ id: communities.id, name: communities.name })
      .from(communities)
      .where(
        and(
          eq(communities.orgId, orgId),
          eq(communities.id, input.communityId),
          ne(communities.status, 'built_out'),
        ),
      );
    if (!current) throw problem('not_found', 'Choose an available community.');
    community = current;
  }
  const identity = or(
    input.email ? eq(leads.email, input.email) : undefined,
    input.phone ? eq(leads.phone, input.phone) : undefined,
  );
  const matches = identity
    ? await tx
        .select({ id: leads.id, name: leads.name })
        .from(leads)
        .where(and(leadScope(actor), identity))
        .orderBy(asc(leads.id))
        .limit(51)
    : [];
  return {
    source,
    community,
    possibleDuplicate: matches.length > 0,
    duplicateCandidates: matches.slice(0, 10),
    ...permittedChannels(input),
    previewFingerprint: digest({ input, source, community, matches: matches.map(({ id }) => id) }),
  };
}

async function lockIntake(tx: Tx, orgId: string, input: z.infer<typeof CreateEnterpriseSalesLead>) {
  const keys = ['request:' + input.clientRequestId];
  if (input.inboundEventId) keys.push('event:' + input.sourceId + ':' + input.inboundEventId);
  if (input.email) keys.push('email:' + input.email);
  if (input.phone) keys.push('phone:' + input.phone);
  for (const key of keys.sort()) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${'sales-lead:' + orgId + ':' + key}, 0))`,
    );
  }
}

const enterpriseSalesLeads: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path + '/options',
    {
      config: intake,
      schema: { tags: ['enterprise'], response: { 200: EnterpriseSalesLeadOptions } },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const data = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const [companySources, activeCommunities] = await Promise.all([
          tx
            .select({ id: sources.id, name: sources.name })
            .from(sources)
            .where(eq(sources.orgId, orgId))
            .orderBy(asc(sources.name), asc(sources.id)),
          tx
            .select({ id: communities.id, name: communities.name })
            .from(communities)
            .where(and(eq(communities.orgId, orgId), ne(communities.status, 'built_out')))
            .orderBy(asc(communities.name), asc(communities.id)),
        ]);
        return { sources: companySources, communities: activeCommunities };
      });
      return reply.header('cache-control', cache).send(data);
    },
  );

  app.post(
    path + '/sources',
    {
      config: { ...manage, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        body: CreateEnterpriseSalesLeadSource,
        response: { 200: EnterpriseSalesLeadSource, 201: EnterpriseSalesLeadSource },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { name } = request.body;
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const [created] = await tx
          .insert(sources)
          .values({ orgId, name, createdByUserId: userId })
          .onConflictDoNothing()
          .returning({ id: sources.id, name: sources.name });
        if (created) {
          await auditRequest(request, tx, {
            orgId,
            action: 'sales.lead_source_created',
            resourceType: 'enterprise_sales_lead_source',
            resourceId: created.id,
            after: created,
          });
          return { created: true, data: created };
        }
        const [existing] = await tx
          .select({ id: sources.id, name: sources.name })
          .from(sources)
          .where(and(eq(sources.orgId, orgId), sql`lower(${sources.name}) = lower(${name})`));
        if (!existing)
          throw problem('conflict', 'The source could not be added. Refresh and try again.');
        return { created: false, data: existing };
      });
      return reply
        .header('cache-control', cache)
        .code(result.created ? 201 : 200)
        .send(result.data);
    },
  );

  app.get(
    path,
    {
      config: intake,
      schema: {
        tags: ['enterprise'],
        querystring: z.object({
          cursor: z.string().max(256).optional(),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        }),
        response: { 200: EnterpriseSalesLeadPage },
      },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const { limit, cursor } = request.query;
      const data = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, actor.orgId);
        const rows = await readLeads(tx)
          .where(
            and(leadScope(actor), beforeCursor(leads.createdAt, leads.id, decodeCursor(cursor))),
          )
          .orderBy(desc(msTrunc(leads.createdAt)), desc(leads.id))
          .limit(limit + 1);
        return pageResult(rows, limit, ({ lead }) => ({ at: lead.createdAt, id: lead.id }), dto);
      });
      return reply.header('cache-control', cache).send(data);
    },
  );

  app.post(
    path + '/preview',
    {
      config: { ...intake, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        body: EnterpriseSalesLeadInput,
        response: { 200: EnterpriseSalesLeadPreview },
      },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const data = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, actor.orgId);
        return review(tx, actor, request.body);
      });
      return reply.header('cache-control', cache).send(data);
    },
  );

  app.post(
    path,
    {
      config: { ...intake, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        body: CreateEnterpriseSalesLead,
        response: { 200: EnterpriseSalesLead, 201: EnterpriseSalesLead },
      },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const { orgId, userId } = actor;
      assertRevision(0, parseIfMatch(request));
      const { clientRequestId, inboundEventId, previewFingerprint, confirmSeparateLead, ...input } =
        request.body;
      const requestHash = digest({ input, inboundEventId });
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await lockIntake(tx, orgId, request.body);
        const receipts = await readLeads(tx).where(
          and(
            eq(leads.orgId, orgId),
            or(
              eq(leads.clientRequestId, clientRequestId),
              inboundEventId
                ? and(eq(leads.sourceId, input.sourceId), eq(leads.inboundEventId, inboundEventId))
                : undefined,
            ),
          ),
        );
        if (receipts.length > 0) {
          const [receipt] = receipts;
          if (
            receipts.length !== 1 ||
            !receipt ||
            receipt.lead.createdByUserId !== userId ||
            (receipt.lead.ownerMembershipId &&
              receipt.lead.ownerMembershipId !== actor.membershipId &&
              !actor.permissions.has('enterprise_sales:manage')) ||
            receipt.lead.requestHash !== requestHash
          )
            throw problem('conflict', 'This intake request was already recorded.');
          return { created: false, data: dto(receipt) };
        }
        const reviewed = await review(tx, actor, input);
        if (reviewed.previewFingerprint !== previewFingerprint)
          throw problem(
            'precondition_failed',
            'Review the current contact consent and duplicate check before adding the lead.',
          );
        if (reviewed.possibleDuplicate && !confirmSeparateLead)
          throw problem('conflict', 'Confirm that the possible duplicate should remain separate.');
        const [saved] = await tx
          .insert(leads)
          .values({
            ...input,
            orgId,
            possibleDuplicate: reviewed.possibleDuplicate,
            createdByUserId: userId,
            clientRequestId,
            inboundEventId,
            requestHash,
          })
          .returning();
        if (!saved) throw problem('internal');
        await tx
          .insert(activities)
          .values({ orgId, leadId: saved.id, kind: 'created', actorUserId: userId });
        await enqueue(tx, {
          orgId,
          task: 'sales.lead_created',
          aggregateType: 'enterprise_sales_lead',
          aggregateId: saved.id,
          payload: { leadId: saved.id },
          correlationId: request.id,
          jobKey: 'sales.lead_created:' + saved.id,
        });
        await auditRequest(request, tx, {
          orgId,
          action: 'sales.lead_created',
          resourceType: 'enterprise_sales_lead',
          resourceId: saved.id,
          after: {
            sourceId: saved.sourceId,
            communityId: saved.communityId,
            possibleDuplicate: saved.possibleDuplicate,
            revision: saved.revision,
          },
        });
        return {
          created: true,
          data: dto({ lead: saved, source: reviewed.source, community: reviewed.community }),
        };
      });
      setEtag(reply, result.data.revision);
      return reply
        .header('cache-control', cache)
        .code(result.created ? 201 : 200)
        .send(result.data);
    },
  );
};

export default enterpriseSalesLeads;
