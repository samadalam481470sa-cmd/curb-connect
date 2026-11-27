import {
  SalesOpportunityProbability,
  SalesPipelineFilters,
  SalesRevenuePipeline,
  SalesRevenuePreference,
  SetSalesOpportunityProbability,
  SetSalesRevenuePreference,
} from '@fieldline/contracts';
import { and, desc, eq, notInArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { salesEstimatePricingApprovals as pricing } from '../../db/schema/enterpriseSalesEstimatePricing';
import { enterpriseSalesLeads as leads } from '../../db/schema/enterpriseSalesLeads';
import {
  salesOpportunityProbabilities as probabilities,
  salesRevenuePreferences as preferences,
} from '../../db/schema/enterpriseSalesRevenue';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { checkEnabled } from './access';
import { leadScope } from './salesLeads';
import { salesPipelineScope } from './salesPipeline';

type Actor = ReturnType<typeof requireOrg>;
type Probability = typeof probabilities.$inferSelect;
type Preference = typeof preferences.$inferSelect;
type Filters = z.infer<typeof SalesPipelineFilters>;
const preferencePath = '/enterprise/sales/pipeline/revenue';
const probabilityPath = '/enterprise/sales/opportunities/:opportunityId/probability';
const config = { permission: 'enterprise_sales:intake' } as const;
const manage = { permission: 'enterprise_sales:manage' } as const;
const tags = ['enterprise'];
const params = z.object({ opportunityId: z.uuid() });
const cache = 'private, no-store';

function preferenceScope(actor: Actor) {
  return and(
    eq(preferences.orgId, actor.orgId),
    eq(preferences.membershipId, actor.membershipId),
    eq(preferences.userId, actor.userId),
  );
}

function preferenceDto(actor: Actor, row?: Preference) {
  const defaultEnabled = actor.permissions.has('enterprise_sales:manage');
  return {
    enabled: row?.enabled ?? defaultEnabled,
    defaultEnabled,
    revision: row?.revision ?? 0,
    changedAt: row?.changedAt.toISOString() ?? null,
  };
}

function probabilityDto(opportunityId: string, row?: Probability) {
  return {
    opportunityId,
    revision: row?.revision ?? 0,
    basisPoints: row?.basisPoints ?? null,
    reason: row?.reason ?? null,
    changedAt: row?.changedAt.toISOString() ?? null,
  };
}

async function opportunity(tx: Tx, actor: Actor, id: string, lock = false) {
  const lookup = tx
    .select({ id: leads.id })
    .from(leads)
    .where(and(leadScope(actor), eq(leads.id, id)));
  const [row] = lock ? await lookup.for('update') : await lookup;
  if (!row) throw problem('not_found');
}

function latestProbability(tx: Tx, orgId: string, leadId: string) {
  return tx
    .select()
    .from(probabilities)
    .where(and(eq(probabilities.orgId, orgId), eq(probabilities.leadId, leadId)))
    .orderBy(desc(probabilities.revision))
    .limit(1);
}

async function forecast(tx: Tx, actor: Actor, filters: Filters) {
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
  const selected = tx
    .select({
      approval: sql<unknown>`${approved.snapshot}`.as('approval'),
      points: sql<number | null>`${probability.basisPoints}`.as('probability'),
    })
    .from(leads)
    .leftJoinLateral(approved, sql`true`)
    .leftJoinLateral(probability, sql`true`)
    .where(
      and(
        salesPipelineScope(actor, filters),
        notInArray(leads.pipelineStage, ['lost', 'project_created']),
      ),
    );
  const groups = await tx.execute<{
    currency: string | null;
    projected: string | null;
    approved: string | null;
    opportunities: number;
  }>(sql`
    with scoped as (${selected}), priced as (
      select approval->>'totalMinor' as approved_minor, approval->>'currency' as currency, probability
      from scoped
    ), weighted as (
      select case when approved_minor is not null and probability is not null then currency end as currency,
        case when approved_minor is not null and probability is not null then approved_minor::numeric end as approved,
        approved_minor::numeric * probability / 10000 as projected
      from priced
    )
    select currency, round(sum(projected))::text as projected,
      sum(approved)::text as approved, count(*)::int as opportunities
    from weighted group by currency order by currency
  `);
  const totals = groups.flatMap((row) =>
    row.currency && row.projected !== null && row.approved !== null
      ? [
          {
            currency: row.currency,
            projectedMinor: row.projected,
            approvedMinor: row.approved,
            opportunities: row.opportunities,
          },
        ]
      : [],
  );
  return {
    totals,
    includedCount: totals.reduce((total, row) => total + row.opportunities, 0),
    missingInputsCount: groups.find((row) => row.currency === null)?.opportunities ?? 0,
  };
}

export const salesRevenue: FastifyPluginAsyncZod = async (app) => {
  app.get(
    preferencePath,
    {
      config,
      schema: { tags, querystring: SalesPipelineFilters, response: { 200: SalesRevenuePipeline } },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const response = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, actor.orgId);
        const [row] = await tx.select().from(preferences).where(preferenceScope(actor));
        const preference = preferenceDto(actor, row);
        return {
          preference,
          forecast: preference.enabled ? await forecast(tx, actor, request.query) : null,
        };
      });
      setEtag(reply, response.preference.revision);
      return reply.header('cache-control', cache).send(response);
    },
  );

  app.put(
    preferencePath,
    {
      config,
      schema: { tags, body: SetSalesRevenuePreference, response: { 200: SalesRevenuePreference } },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const expected = parseIfMatch(request);
      const response = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, actor.orgId);
        // Serialize writes for this membership, including the first override.
        await tx.execute(sql`select pg_advisory_xact_lock(
        hashtextextended(${'sales-revenue-view:' + actor.orgId + ':' + actor.membershipId}, 0)
      )`);
        const [current] = await tx.select().from(preferences).where(preferenceScope(actor));
        const before = preferenceDto(actor, current);
        assertRevision(before.revision, expected);
        if (before.enabled === request.body.enabled) return before;
        const values = {
          enabled: request.body.enabled,
          revision: before.revision + 1,
          changedAt: new Date(),
        };
        const [saved] = current
          ? await tx.update(preferences).set(values).where(preferenceScope(actor)).returning()
          : await tx
              .insert(preferences)
              .values({
                orgId: actor.orgId,
                membershipId: actor.membershipId,
                userId: actor.userId,
                ...values,
              })
              .returning();
        if (!saved) throw problem('conflict', 'The view preference could not be saved.');
        const after = preferenceDto(actor, saved);
        await auditRequest(request, tx, {
          orgId: actor.orgId,
          action: 'sales.projected_revenue_preference_changed',
          resourceType: 'membership',
          resourceId: actor.membershipId,
          before,
          after,
        });
        return after;
      });
      setEtag(reply, response.revision);
      return reply.header('cache-control', cache).send(response);
    },
  );

  app.get(
    probabilityPath,
    {
      config: manage,
      schema: { tags, params, response: { 200: SalesOpportunityProbability } },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      if (!actor.permissions.has('enterprise_sales:intake')) throw problem('forbidden');
      const id = request.params.opportunityId;
      const response = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, actor.orgId);
        await opportunity(tx, actor, id);
        const [current] = await latestProbability(tx, actor.orgId, id);
        return probabilityDto(id, current);
      });
      setEtag(reply, response.revision);
      return reply.header('cache-control', cache).send(response);
    },
  );

  app.put(
    probabilityPath,
    {
      config: manage,
      schema: {
        tags,
        params,
        body: SetSalesOpportunityProbability,
        response: { 200: SalesOpportunityProbability },
      },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      if (!actor.permissions.has('enterprise_sales:intake')) throw problem('forbidden');
      const id = request.params.opportunityId;
      const expected = parseIfMatch(request);
      const { basisPoints, reason, clientRequestId } = request.body;
      const response = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, actor.orgId);
        await opportunity(tx, actor, id, true);
        const [prior] = await tx
          .select()
          .from(probabilities)
          .where(
            and(
              eq(probabilities.orgId, actor.orgId),
              eq(probabilities.leadId, id),
              eq(probabilities.clientRequestId, clientRequestId),
            ),
          );
        if (prior) {
          if (
            prior.basisPoints !== basisPoints ||
            prior.reason !== reason ||
            prior.revision !== expected + 1 ||
            prior.changedByUserId !== actor.userId
          ) {
            throw problem(
              'conflict',
              'This request ID already belongs to a different probability update.',
            );
          }
          return probabilityDto(id, prior);
        }
        const [current] = await latestProbability(tx, actor.orgId, id);
        const before = probabilityDto(id, current);
        assertRevision(before.revision, expected);
        const [saved] = await tx
          .insert(probabilities)
          .values({
            orgId: actor.orgId,
            leadId: id,
            revision: before.revision + 1,
            basisPoints,
            reason,
            changedByUserId: actor.userId,
            clientRequestId,
          })
          .returning();
        if (!saved) throw problem('conflict', 'The probability could not be saved.');
        const after = probabilityDto(id, saved);
        await auditRequest(request, tx, {
          orgId: actor.orgId,
          action: 'sales.opportunity_probability_recorded',
          resourceType: 'enterprise_sales_opportunity',
          resourceId: id,
          before,
          after,
          reason,
        });
        return after;
      });
      setEtag(reply, response.revision);
      return reply.header('cache-control', cache).send(response);
    },
  );
};
