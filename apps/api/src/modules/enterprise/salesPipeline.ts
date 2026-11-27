import { createHash } from 'node:crypto';
import {
  AdvanceSalesStage,
  SALES_PIPELINE_STAGES,
  SalesOpportunity,
  SalesPipelineFilters,
  SalesPipelineFilterOptions,
  SalesPipelinePage,
  type SalesPipelineSort,
  SalesStageEvent,
  type SalesStageKey,
} from '@fieldline/contracts';
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { users } from '../../db/schema/auth';
import {
  salesLeadFollowUps as followUps,
  salesLeadInteractions as interactions,
} from '../../db/schema/enterpriseSalesInteractions';
import {
  enterpriseSalesLeadSources as sources,
  enterpriseSalesLeads as leads,
} from '../../db/schema/enterpriseSalesLeads';
import { salesStageEvents as events } from '../../db/schema/enterpriseSalesPipeline';
import { salesEstimateDrafts as drafts } from '../../db/schema/enterpriseSalesEstimates';
import { salesEstimatePricingApprovals as pricing } from '../../db/schema/enterpriseSalesEstimatePricing';
import { salesOpportunityProbabilities as probabilities } from '../../db/schema/enterpriseSalesRevenue';
import { salesProposalIssues as issues } from '../../db/schema/enterpriseSalesProposals';
import { proposals, proposalVersions } from '../../db/schema/proposals';
import { landCommunities as communities, landLots as lots } from '../../db/schema/landManagement';
import { organizations } from '../../db/schema/orgs';
import { memberships } from '../../db/schema/team';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, encodeCursor, msTrunc } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { checkEnabled } from './access';
import { leadScope } from './salesLeads';
import { companyPricing } from './salesEstimateSources';

const config = { permission: 'enterprise_sales:intake' } as const;
const pipeline = '/enterprise/sales/pipeline';
const opportunity = '/enterprise/sales/opportunities/:opportunityId';
const params = z.object({ opportunityId: z.uuid() });
const tags = ['enterprise'];
const cache = 'private, no-store';

const transitions: Record<SalesStageKey, readonly SalesStageKey[]> = {
  new: ['attempting_contact', 'qualified', 'nurture', 'lost'],
  attempting_contact: ['qualified', 'nurture', 'lost'],
  qualified: ['consultation', 'estimating', 'nurture', 'lost'],
  consultation: ['estimating', 'nurture', 'lost'],
  estimating: ['proposal_sent', 'nurture', 'lost'],
  proposal_sent: ['negotiation', 'contract_sent', 'nurture', 'lost'],
  negotiation: ['contract_sent', 'nurture', 'lost'],
  contract_sent: ['contract_signed', 'negotiation', 'lost'],
  contract_signed: ['project_created'],
  lost: [],
  nurture: ['attempting_contact', 'lost'],
  project_created: [],
};

const evidenceNeeded: Partial<Record<SalesStageKey, string>> = {
  estimating: 'Create an estimate from this opportunity before advancing.',
  proposal_sent: 'Issue a proposal linked to this opportunity before advancing.',
  negotiation: 'Verify the issued proposal and the next activity before advancing.',
  contract_sent: 'Send an approved contract through the signature workflow before advancing.',
  contract_signed: 'A verified signed contract is required.',
  project_created: 'An approved signed-contract conversion is required.',
};

const pipelineStages = new Map(SALES_PIPELINE_STAGES.map((stage) => [stage.key, stage]));
const stage = (key: SalesStageKey) => pipelineStages.get(key)!;
type Actor = ReturnType<typeof requireOrg>;
type Entry = typeof leads.$inferSelect;
type Event = typeof events.$inferSelect;
type Person = { id: string; name: string };
type PipelineRow = {
  lead: Entry;
  source: Person;
  community: Person | null;
  owner: { id: string | null; name: string | null } | null;
  lastActivity: string | null;
  nextActivity: string | null;
  lot: Person | null;
  approvedMinor: string | null;
  approvedCurrency: string | null;
  probabilityBasisPoints: number | null;
  sortValue: string | null;
};

export function salesPipelineScope(actor: Actor, filters: z.infer<typeof SalesPipelineFilters>) {
  const search = filters.search?.replace(/[\\%_]/g, (character) => '\\' + character);
  const boundaryZone = sql`coalesce((
    select case when exists (select 1 from pg_catalog.pg_timezone_names where name = ${organizations.timezone})
      then ${organizations.timezone} else 'UTC' end
    from ${organizations} where ${organizations.id} = ${actor.orgId}
  ), 'UTC')`;
  const scheduled = sql`exists (
    select 1 from ${followUps}
    where ${followUps.orgId} = ${leads.orgId} and ${followUps.leadId} = ${leads.id} and ${followUps.dueAt} > now()
  )`;
  const value = sql`(
    select ${pricing.approvalSnapshot} from ${pricing}
    where ${pricing.orgId} = ${leads.orgId} and ${pricing.opportunityId} = ${leads.id}
    order by ${pricing.revision} desc limit 1
  )`;
  const requestedRange =
    (filters.minValueMinor || filters.maxValueMinor) && filters.currency
      ? and(
          sql`${value}->>'currency' = ${filters.currency}`,
          filters.minValueMinor
            ? sql`(${value}->>'totalMinor')::numeric >= ${filters.minValueMinor}::numeric`
            : undefined,
          filters.maxValueMinor
            ? sql`(${value}->>'totalMinor')::numeric <= ${filters.maxValueMinor}::numeric`
            : undefined,
        )
      : undefined;
  return and(
    leadScope(actor),
    filters.stage ? eq(leads.pipelineStage, filters.stage) : undefined,
    filters.sourceId ? eq(leads.sourceId, filters.sourceId) : undefined,
    filters.communityId ? eq(leads.communityId, filters.communityId) : undefined,
    filters.ownerMembershipId ? eq(leads.ownerMembershipId, filters.ownerMembershipId) : undefined,
    search ? ilike(leads.name, `%${search}%`) : undefined,
    filters.lotId
      ? sql`exists (
      select 1 from ${drafts}
      where ${drafts.orgId} = ${leads.orgId} and ${drafts.opportunityId} = ${leads.id} and ${drafts.lotId} = ${filters.lotId}
    )`
      : undefined,
    filters.createdFrom
      ? sql`${leads.createdAt} >= (${filters.createdFrom}::date::timestamp at time zone ${boundaryZone})`
      : undefined,
    filters.createdThrough
      ? sql`${leads.createdAt} < ((${filters.createdThrough}::date + 1)::timestamp at time zone ${boundaryZone})`
      : undefined,
    filters.nextActivity === 'scheduled'
      ? scheduled
      : filters.nextActivity === 'unscheduled'
        ? sql`not ${scheduled}`
        : undefined,
    requestedRange,
    filters.consentPurpose && filters.consentChannel && filters.consentStatus
      ? sql`coalesce(${leads.consent}->${filters.consentPurpose}::text->>${filters.consentChannel}::text, 'not_recorded') = ${filters.consentStatus}`
      : undefined,
  );
}

export function salesPipelineRows(tx: Tx, sort: SalesPipelineSort = 'created_desc') {
  const approved = tx
    .select({ snapshot: pricing.approvalSnapshot })
    .from(pricing)
    .where(and(eq(pricing.orgId, leads.orgId), eq(pricing.opportunityId, leads.id)))
    .orderBy(desc(pricing.revision))
    .limit(1)
    .as('approved_pricing');
  const probability = tx
    .select({ basisPoints: probabilities.basisPoints })
    .from(probabilities)
    .where(and(eq(probabilities.orgId, leads.orgId), eq(probabilities.leadId, leads.id)))
    .orderBy(desc(probabilities.revision))
    .limit(1)
    .as('recorded_probability');
  const next = sql`(
    select min(${followUps.dueAt}) from ${followUps}
    where ${followUps.orgId} = ${leads.orgId} and ${followUps.leadId} = ${leads.id} and ${followUps.dueAt} > now()
  )`;
  const money = sql`((${approved.snapshot}->>'currency') || ':' || lpad(${approved.snapshot}->>'totalMinor', 16, '0')) collate "C"`;
  const text = (column: SQL) => sql`lower(${column}) collate "C"`;
  const stageEntered = sql`date_trunc('milliseconds', coalesce(${leads.stageEnteredAt}, ${leads.createdAt}))`;
  const created = msTrunc(leads.createdAt);
  const probabilityBasisPoints = sql`${probability.basisPoints}`;
  const ordered: Record<
    SalesPipelineSort,
    { key: SQL; direction: 'asc' | 'desc'; valueType: 'text' | 'timestamptz' | 'integer' }
  > = {
    created_desc: { key: created, direction: 'desc', valueType: 'timestamptz' },
    created_asc: { key: created, direction: 'asc', valueType: 'timestamptz' },
    name_asc: { key: text(sql`${leads.name}`), direction: 'asc', valueType: 'text' },
    name_desc: { key: text(sql`${leads.name}`), direction: 'desc', valueType: 'text' },
    stage_age_desc: { key: stageEntered, direction: 'asc', valueType: 'timestamptz' },
    stage_age_asc: { key: stageEntered, direction: 'desc', valueType: 'timestamptz' },
    source_asc: { key: text(sql`${sources.name}`), direction: 'asc', valueType: 'text' },
    source_desc: { key: text(sql`${sources.name}`), direction: 'desc', valueType: 'text' },
    community_asc: { key: text(sql`${communities.name}`), direction: 'asc', valueType: 'text' },
    community_desc: { key: text(sql`${communities.name}`), direction: 'desc', valueType: 'text' },
    owner_asc: { key: text(sql`${users.displayName}`), direction: 'asc', valueType: 'text' },
    owner_desc: { key: text(sql`${users.displayName}`), direction: 'desc', valueType: 'text' },
    next_activity_asc: { key: next, direction: 'asc', valueType: 'timestamptz' },
    next_activity_desc: { key: next, direction: 'desc', valueType: 'timestamptz' },
    approved_value_desc: { key: money, direction: 'desc', valueType: 'text' },
    approved_value_asc: { key: money, direction: 'asc', valueType: 'text' },
    probability_desc: { key: probabilityBasisPoints, direction: 'desc', valueType: 'integer' },
    probability_asc: { key: probabilityBasisPoints, direction: 'asc', valueType: 'integer' },
  };
  const { key, direction, valueType } = ordered[sort];
  const orderDirection = direction === 'asc' ? sql`asc` : sql`desc`;
  const comparison = direction === 'asc' ? sql`>` : sql`<`;
  const cursorCast = { text: sql`text`, timestamptz: sql`timestamptz`, integer: sql`integer` }[
    valueType
  ];

  const query = tx
    .select({
      lead: leads,
      sortValue: sql<string | null>`(${key})::text`,
      source: { id: sources.id, name: sources.name },
      community: { id: communities.id, name: communities.name },
      owner: { id: memberships.id, name: users.displayName },
      lot: { id: lots.id, name: lots.lotNumber },
      approvedMinor: sql<string | null>`${approved.snapshot}->>'totalMinor'`,
      approvedCurrency: sql<string | null>`${approved.snapshot}->>'currency'`,
      probabilityBasisPoints: sql<number | null>`${probability.basisPoints}`,
      lastActivity: sql<string | null>`(
      select max(${interactions.occurredAt})::text from ${interactions}
      where ${interactions.orgId} = ${leads.orgId} and ${interactions.leadId} = ${leads.id}
    )`,
      nextActivity: sql<string | null>`${next}::text`,
    })
    .from(leads)
    .innerJoin(sources, and(eq(sources.orgId, leads.orgId), eq(sources.id, leads.sourceId)))
    .leftJoin(
      communities,
      and(eq(communities.orgId, leads.orgId), eq(communities.id, leads.communityId)),
    )
    .leftJoin(
      memberships,
      and(eq(memberships.orgId, leads.orgId), eq(memberships.id, leads.ownerMembershipId)),
    )
    .leftJoin(users, eq(users.id, memberships.userId))
    .leftJoin(drafts, and(eq(drafts.orgId, leads.orgId), eq(drafts.opportunityId, leads.id)))
    .leftJoin(lots, and(eq(lots.orgId, drafts.orgId), eq(lots.id, drafts.lotId)))
    .leftJoinLateral(approved, sql`true`)
    .leftJoinLateral(probability, sql`true`);
  return {
    query,
    order: [sql`${key} ${orderDirection} nulls last`, sql`${leads.id} ${orderDirection}`],
    after: (cursor?: string) => {
      if (!cursor) return undefined;
      if (sort === 'created_desc')
        return beforeCursor(leads.createdAt, leads.id, decodeCursor(cursor));
      const token = parseSortCursor(cursor, sort, valueType);
      const idAfter = sql`${leads.id} ${comparison} ${token.id}::uuid`;
      if (token.value === null) return sql`(${key} is null and ${idAfter})`;
      return sql`(
        ${key} is null or
        (${key}, ${leads.id}) ${comparison} (${token.value}::${cursorCast}, ${token.id}::uuid)
      )`;
    },
  };
}

const SortCursor = z.object({
  sort: z.string(),
  id: z.uuid(),
  value: z.string().max(200).nullable(),
});

function parseSortCursor(cursor: string, sort: SalesPipelineSort, valueType: string) {
  try {
    const result = SortCursor.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    if (result.sort !== sort) throw new Error('mismatched sort');
    const value = result.value;
    if (
      value !== null &&
      ((valueType === 'integer' && !/^\d{1,5}$/.test(value)) ||
        (valueType === 'timestamptz' && Number.isNaN(Date.parse(value))))
    ) {
      throw new Error('invalid cursor key');
    }
    return result;
  } catch {
    throw problem(
      'validation_failed',
      'The cursor does not match this ordering. Start from the first page.',
    );
  }
}

function sortedPipelinePage(rows: PipelineRow[], limit: number, sort: SalesPipelineSort) {
  const shown = rows.slice(0, limit);
  const last = shown.at(-1);
  const nextCursor =
    last && rows.length > limit
      ? sort === 'created_desc'
        ? encodeCursor(last.lead.createdAt, last.lead.id)
        : Buffer.from(JSON.stringify({ sort, id: last.lead.id, value: last.sortValue })).toString(
            'base64url',
          )
      : null;
  return { items: shown.map(leadDto), nextCursor };
}

export function leadDto({
  lead,
  source,
  community,
  owner,
  lastActivity,
  nextActivity,
  lot,
  approvedMinor,
  approvedCurrency,
  probabilityBasisPoints,
}: PipelineRow) {
  const entered = lead.stageEnteredAt ?? lead.createdAt;
  return {
    id: lead.id,
    name: lead.name,
    revision: lead.revision,
    stage: stage(lead.pipelineStage),
    stageEnteredAt: entered.toISOString(),
    lot,
    approvedValue:
      approvedMinor !== null && approvedCurrency
        ? { amountMinor: approvedMinor, currency: approvedCurrency }
        : null,
    probabilityBasisPoints,
    daysInStage: Math.max(0, Math.floor((Date.now() - entered.getTime()) / 86_400_000)),
    source,
    community,
    owner: owner?.id && owner.name ? { id: owner.id, name: owner.name } : null,
    lastActivityAt: lastActivity ? new Date(lastActivity).toISOString() : null,
    nextActivityAt: nextActivity ? new Date(nextActivity).toISOString() : null,
  };
}

function eventDto(event: Event) {
  return {
    id: event.id,
    from: stage(event.fromStage),
    to: stage(event.toStage),
    reason: event.reason,
    recordedAt: event.createdAt.toISOString(),
    previousStageDurationMs: event.previousStageDurationMs,
    revision: event.revision,
  };
}

async function evidence(tx: Tx, actor: Actor, leadId: string) {
  const [[latest], [next], [estimate], [issued]] = await Promise.all([
    tx
      .select({ outcome: interactions.outcome })
      .from(interactions)
      .where(and(eq(interactions.orgId, actor.orgId), eq(interactions.leadId, leadId)))
      .orderBy(desc(interactions.occurredAt), desc(interactions.id))
      .limit(1),
    tx
      .select({ id: followUps.id })
      .from(followUps)
      .where(
        and(
          eq(followUps.orgId, actor.orgId),
          eq(followUps.leadId, leadId),
          sql`${followUps.dueAt} > now()`,
        ),
      )
      .limit(1),
    tx
      .select({ id: drafts.id })
      .from(drafts)
      .where(and(eq(drafts.orgId, actor.orgId), eq(drafts.opportunityId, leadId))),
    tx
      .select({ id: issues.id })
      .from(issues)
      .innerJoin(
        proposals,
        and(
          eq(proposals.orgId, issues.orgId),
          eq(proposals.id, issues.proposalId),
          eq(proposals.currentVersionId, issues.proposalVersionId),
          inArray(proposals.status, ['sent', 'viewed', 'accepted']),
        ),
      )
      .innerJoin(
        proposalVersions,
        and(
          eq(proposalVersions.orgId, issues.orgId),
          eq(proposalVersions.id, issues.proposalVersionId),
          isNotNull(proposalVersions.sentAt),
        ),
      )
      .where(and(eq(issues.orgId, actor.orgId), eq(issues.opportunityId, leadId))),
  ]);
  return {
    proposalIssued: Boolean(issued),
    estimateId: estimate?.id ?? null,
    hasFollowUp: Boolean(next),
    contacted: latest?.outcome === 'contacted' || latest?.outcome === 'follow_up_requested',
  };
}

function blockedReason(target: SalesStageKey, latest: Awaited<ReturnType<typeof evidence>>) {
  if (target === 'estimating' && latest.estimateId) return null;
  if (target === 'proposal_sent' && latest.proposalIssued) return null;
  if (target === 'negotiation' && latest.proposalIssued && latest.hasFollowUp) return null;
  if (evidenceNeeded[target]) return evidenceNeeded[target];
  if (['qualified', 'consultation'].includes(target) && !latest.contacted)
    return 'Record a completed contact or requested follow-up before advancing.';
  if (['attempting_contact', 'consultation', 'nurture'].includes(target) && !latest.hasFollowUp)
    return 'Schedule a future next activity before advancing.';
  return null;
}

function needsReason(target: SalesStageKey) {
  return target === 'lost' || target === 'nurture';
}

const salesPipeline: FastifyPluginAsyncZod = async (app) => {
  app.get(
    pipeline + '/filter-options',
    {
      config,
      schema: { tags, response: { 200: SalesPipelineFilterOptions } },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, actor.orgId);
        const scope = leadScope(actor);
        const [sourceOptions, communityOptions, ownerOptions, lotOptions, company] =
          await Promise.all([
            tx
              .selectDistinct({ id: sources.id, name: sources.name })
              .from(leads)
              .innerJoin(
                sources,
                and(eq(sources.orgId, leads.orgId), eq(sources.id, leads.sourceId)),
              )
              .where(scope)
              .orderBy(asc(sources.name), asc(sources.id)),
            tx
              .selectDistinct({ id: communities.id, name: communities.name })
              .from(leads)
              .innerJoin(
                communities,
                and(eq(communities.orgId, leads.orgId), eq(communities.id, leads.communityId)),
              )
              .where(scope)
              .orderBy(asc(communities.name), asc(communities.id)),
            tx
              .selectDistinct({ id: memberships.id, name: users.displayName })
              .from(leads)
              .innerJoin(
                memberships,
                and(
                  eq(memberships.orgId, leads.orgId),
                  eq(memberships.id, leads.ownerMembershipId),
                ),
              )
              .innerJoin(users, eq(users.id, memberships.userId))
              .where(scope)
              .orderBy(asc(users.displayName), asc(memberships.id)),
            tx
              .selectDistinct({
                id: lots.id,
                name: sql<string>`${communities.name} || ' · ' || ${lots.lotNumber}`.as('label'),
              })
              .from(leads)
              .innerJoin(
                drafts,
                and(eq(drafts.orgId, leads.orgId), eq(drafts.opportunityId, leads.id)),
              )
              .innerJoin(lots, and(eq(lots.orgId, drafts.orgId), eq(lots.id, drafts.lotId)))
              .innerJoin(
                communities,
                and(eq(communities.orgId, lots.orgId), eq(communities.id, lots.communityId)),
              )
              .where(scope)
              .orderBy(sql`label`, asc(lots.id)),
            companyPricing(tx, actor.orgId),
          ]);
        return {
          sources: sourceOptions,
          communities: communityOptions,
          owners: ownerOptions,
          lots: lotOptions,
          currency: company.currency,
        };
      });
      return reply.header('cache-control', cache).send(result);
    },
  );

  app.get(
    pipeline,
    {
      config,
      schema: {
        tags,
        querystring: SalesPipelineFilters.safeExtend({
          cursor: z.string().max(1500).optional(),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        }),
        response: { 200: SalesPipelinePage },
      },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const { limit, cursor, ...filters } = request.query;
      const scope = salesPipelineScope(actor, filters);
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, actor.orgId);
        const sort = filters.sort ?? 'created_desc';
        const rowsQuery = salesPipelineRows(tx, sort);
        const [rows, totals] = await Promise.all([
          rowsQuery.query
            .where(and(scope, rowsQuery.after(cursor)))
            .orderBy(...rowsQuery.order)
            .limit(limit + 1),
          tx
            .select({ stage: leads.pipelineStage, count: count() })
            .from(leads)
            .where(scope)
            .groupBy(leads.pipelineStage),
        ]);
        return {
          ...sortedPipelinePage(rows, limit, sort),
          counts: totals.map((row) => ({ stage: stage(row.stage), count: row.count })),
          readAt: new Date().toISOString(),
        };
      });
      return reply.header('cache-control', cache).send(result);
    },
  );

  app.get(
    opportunity,
    {
      config,
      schema: { tags, params, response: { 200: SalesOpportunity } },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const leadId = request.params.opportunityId;
      const view = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, actor.orgId);
        const [row] = await salesPipelineRows(tx).query.where(
          and(leadScope(actor), eq(leads.id, leadId)),
        );
        if (!row) throw problem('not_found');
        const [latest, history] = await Promise.all([
          evidence(tx, actor, leadId),
          tx
            .select()
            .from(events)
            .where(and(eq(events.orgId, actor.orgId), eq(events.leadId, leadId)))
            .orderBy(desc(events.revision))
            .limit(30),
        ]);
        return {
          ...leadDto(row),
          estimateId: latest.estimateId,
          possibleTransitions: transitions[row.lead.pipelineStage].map((target) => ({
            stage: stage(target),
            blockedReason: blockedReason(target, latest) ?? null,
            requiresReason: needsReason(target),
          })),
          history: history.map(eventDto),
        };
      });
      setEtag(reply, view.revision);
      return reply.header('cache-control', cache).send(view);
    },
  );

  app.post(
    opportunity + '/stage',
    {
      config: { ...config, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags,
        params,
        body: AdvanceSalesStage,
        response: { 200: SalesStageEvent, 201: SalesStageEvent },
      },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const { orgId, userId } = actor;
      const leadId = request.params.opportunityId;
      const { targetStageId, reason, clientRequestId } = request.body;
      const expected = parseIfMatch(request);
      const hash = createHash('sha256')
        .update(JSON.stringify([request.body, expected]))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const record = and(leadScope(actor), eq(leads.id, leadId));
        const [lead] = await tx.select().from(leads).where(record).for('update');
        if (!lead) throw problem('not_found');
        const [receipt] = await tx
          .select()
          .from(events)
          .where(
            and(
              eq(events.orgId, orgId),
              eq(events.leadId, leadId),
              eq(events.clientRequestId, clientRequestId),
            ),
          );
        if (receipt) {
          if (receipt.actorUserId !== userId || receipt.requestHash !== hash)
            throw problem('conflict', 'This request already saved a different stage change.');
          return { created: false, data: eventDto(receipt) };
        }
        assertRevision(lead.revision, expected);
        const target = SALES_PIPELINE_STAGES.find(({ id }) => id === targetStageId)?.key;
        if (!target || !transitions[lead.pipelineStage].includes(target)) {
          if (target === 'contract_signed')
            throw problem('conflict', 'A verified signed contract is required.');
          throw problem('conflict', 'This stage is unavailable from the current stage.');
        }
        const prerequisite = blockedReason(target, await evidence(tx, actor, leadId));
        if (prerequisite) throw problem('conflict', prerequisite);
        if (needsReason(target) && !reason)
          throw problem('validation_failed', 'Enter a reason for this stage.');
        const now = new Date();
        const revision = expected + 1;
        const [saved] = await tx
          .insert(events)
          .values({
            orgId,
            leadId,
            fromStage: lead.pipelineStage,
            toStage: target,
            reason,
            revision,
            previousStageDurationMs: Math.max(
              0,
              now.getTime() - (lead.stageEnteredAt ?? lead.createdAt).getTime(),
            ),
            clientRequestId,
            requestHash: hash,
            actorUserId: userId,
            createdAt: now,
          })
          .returning();
        if (!saved) throw problem('internal');
        await tx
          .update(leads)
          .set({ pipelineStage: target, stageEnteredAt: now, revision })
          .where(record);
        await auditRequest(request, tx, {
          orgId,
          action: 'sales.stage_changed',
          resourceType: 'enterprise_sales_lead',
          resourceId: leadId,
          before: { stage: lead.pipelineStage, revision: expected },
          after: {
            stage: target,
            revision,
            stageEventId: saved.id,
            previousStageDurationMs: saved.previousStageDurationMs,
          },
          reason,
        });
        await enqueue(tx, {
          orgId,
          task: 'sales.stage_changed',
          aggregateType: 'enterprise_sales_stage_event',
          aggregateId: saved.id,
          payload: { leadId, stageEventId: saved.id },
          correlationId: request.id,
          jobKey: 'sales.stage_changed:' + saved.id,
        });
        return { created: true, data: eventDto(saved) };
      });
      setEtag(reply, result.data.revision);
      return reply
        .header('cache-control', cache)
        .code(result.created ? 201 : 200)
        .send(result.data);
    },
  );
};

export default salesPipeline;
