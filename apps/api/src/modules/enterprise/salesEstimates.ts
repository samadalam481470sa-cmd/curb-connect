import { createHash } from 'node:crypto';
import {
  CreateSalesEstimate,
  SalesEstimateDraft,
  SalesEstimateOptions,
  SalesEstimateSnapshot,
} from '@fieldline/contracts';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { salesEstimateDrafts as drafts } from '../../db/schema/enterpriseSalesEstimates';
import { enterpriseSalesLeads as leads } from '../../db/schema/enterpriseSalesLeads';
import { landCommunities as communities, landLots as lots } from '../../db/schema/landManagement';
import { productionRates } from '../../db/schema/pricebooks';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { checkEnabled } from './access';
import {
  companyPricing,
  pickCatalogs,
  pickLots,
  pickOptions,
  pickPlans,
} from './salesEstimateSources';
import { approvedTemplateList, templateSnapshot } from './salesEstimateTemplates';
import { leadScope } from './salesLeads';

const path = '/enterprise/sales/opportunities/:opportunityId/estimate';
const config = { permission: 'enterprise_sales:intake' } as const;
const tags = ['enterprise'];
const params = z.object({ opportunityId: z.uuid() });
const cache = 'private, no-store';
type Actor = ReturnType<typeof requireOrg>;
type Draft = typeof drafts.$inferSelect;
type Lead = typeof leads.$inferSelect;

function qualified(lead: Lead) {
  return lead.pipelineStage === 'qualified' || lead.pipelineStage === 'consultation';
}

function draftFor(tx: Tx, orgId: string, opportunityId: string) {
  return tx
    .select()
    .from(drafts)
    .where(and(eq(drafts.orgId, orgId), eq(drafts.opportunityId, opportunityId)));
}

async function dto(tx: Tx, draft: Draft) {
  const { id, opportunityId, title, currency, createdAt, revision, snapshot } = draft;
  const [lot] = draft.lotId
    ? await tx
        .select({ status: lots.status, contractId: lots.contractId })
        .from(lots)
        .where(and(eq(lots.orgId, draft.orgId), eq(lots.id, draft.lotId)))
    : [];
  const priced = snapshot.options.filter(
    (item) => item.price.currency === currency && item.price.amountMinor !== null,
  );
  return {
    id,
    opportunityId,
    title,
    status: 'draft' as const,
    currency,
    createdAt: createdAt.toISOString(),
    revision,
    snapshot,
    currentLotStatus: lot?.status ?? null,
    lotHold: Boolean(snapshot.lot && (lot?.status !== 'available' || lot.contractId)),
    knownOptionSubtotalMinor: priced
      .reduce((total, item) => total + BigInt(item.price.amountMinor ?? 0), 0n)
      .toString(),
    unpricedOptionIds: snapshot.options
      .filter((item) => item.price.currency !== currency || item.price.amountMinor === null)
      .map(({ id }) => id),
  };
}

async function selectionSources(tx: Tx, actor: Actor, lead: Lead) {
  const { orgId } = actor;
  const pricing = await companyPricing(tx, orgId);
  const [plans, lots, options, catalogs, approvedTemplates] = await Promise.all([
    pickPlans(tx, orgId),
    pickLots(tx, orgId, lead.communityId),
    pickOptions(tx, orgId),
    pickCatalogs(tx, orgId, pricing.effectiveOn),
    approvedTemplateList(tx, orgId),
  ]);
  return {
    plans,
    lots,
    options,
    catalogs,
    approvedTemplates,
    defaultCurrency: pricing.currency,
    pricingAsOf: pricing.effectiveOn,
  };
}

const salesEstimates: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path + '/options',
    {
      config,
      schema: { tags, params, response: { 200: SalesEstimateOptions } },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const { opportunityId } = request.params;
      const data = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, actor.orgId);
        const [lead] = await tx
          .select()
          .from(leads)
          .where(and(leadScope(actor), eq(leads.id, opportunityId)));
        if (!lead) throw problem('not_found');
        const [existing] = await draftFor(tx, actor.orgId, opportunityId);
        const selections = await selectionSources(tx, actor, lead);
        return {
          ...selections,
          opportunityId,
          opportunityName: lead.name,
          revision: lead.revision,
          canCreate: qualified(lead) && !existing,
          approvedTemplates: selections.approvedTemplates.map(({ row }) => templateSnapshot(row)),
          existingEstimateId: existing?.id ?? null,
        };
      });
      setEtag(reply, data.revision);
      return reply.header('cache-control', cache).send(data);
    },
  );

  app.get(
    path,
    {
      config,
      schema: { tags, params, response: { 200: SalesEstimateDraft } },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const { opportunityId } = request.params;
      const data = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, actor.orgId);
        const [lead] = await tx
          .select({ id: leads.id })
          .from(leads)
          .where(and(leadScope(actor), eq(leads.id, opportunityId)));
        if (!lead) throw problem('not_found');
        const [draft] = await draftFor(tx, actor.orgId, opportunityId);
        if (!draft) throw problem('not_found');
        return dto(tx, draft);
      });
      setEtag(reply, data.revision);
      return reply.header('cache-control', cache).send(data);
    },
  );

  app.post(
    path,
    {
      config: { ...config, rateLimit: { max: 40, timeWindow: '1 minute' } },
      schema: {
        tags,
        params,
        body: CreateSalesEstimate,
        response: { 200: SalesEstimateDraft, 201: SalesEstimateDraft },
      },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const { orgId, userId } = actor;
      const { opportunityId } = request.params;
      const expected = parseIfMatch(request);
      const input = request.body;
      const optionIds = [...input.optionIds].sort();
      const requestHash = createHash('sha256')
        .update(JSON.stringify([{ ...input, optionIds }, expected]))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const scope = and(leadScope(actor), eq(leads.id, opportunityId));
        const [lead] = await tx.select().from(leads).where(scope).for('update');
        if (!lead) throw problem('not_found');
        const [existing] = await draftFor(tx, orgId, opportunityId);
        if (existing?.clientRequestId === input.clientRequestId) {
          if (existing.createdByUserId !== userId || existing.requestHash !== requestHash)
            throw problem('conflict', 'This request already saved a different estimate draft.');
          return { created: false, data: await dto(tx, existing) };
        }
        if (existing) throw problem('conflict', 'This opportunity already has an estimate draft.');
        assertRevision(lead.revision, expected);
        if (!qualified(lead))
          throw problem('conflict', 'Qualify this opportunity before starting an estimate.');
        const choices = await selectionSources(tx, actor, lead);
        const plan = input.planId ? choices.plans.find(({ id }) => id === input.planId) : null;
        const lot = input.lotId ? choices.lots.find(({ id }) => id === input.lotId) : null;
        const catalog = input.catalogRevisionId
          ? choices.catalogs.find(({ revisionId }) => revisionId === input.catalogRevisionId)
          : null;
        const approval = input.templateRevisionId
          ? choices.approvedTemplates.find(({ row }) => row.id === input.templateRevisionId)
          : null;
        const options = choices.options.filter(({ id }) => optionIds.includes(id));
        if (
          plan === undefined ||
          lot === undefined ||
          catalog === undefined ||
          approval === undefined ||
          options.length !== optionIds.length
        )
          throw problem(
            'not_found',
            'Review the selected plan, lot, catalog, approved template or options.',
          );
        if (catalog && catalog.currency !== input.currency)
          throw problem(
            'validation_failed',
            'Choose an approved catalog in the estimate currency.',
          );
        const [community] = lead.communityId
          ? await tx
              .select({ id: communities.id, name: communities.name })
              .from(communities)
              .where(and(eq(communities.orgId, orgId), eq(communities.id, lead.communityId)))
          : [];
        const laborRates = catalog
          ? await tx
              .select({
                code: productionRates.code,
                label: productionRates.label,
                unit: productionRates.unit,
                unitsPerHour: productionRates.unitsPerHour,
                crewSize: productionRates.crewSize,
              })
              .from(productionRates)
              .where(
                and(
                  eq(productionRates.orgId, orgId),
                  eq(productionRates.priceBookRevisionId, catalog.revisionId),
                ),
              )
              .orderBy(asc(productionRates.code))
          : [];
        const snapshot = SalesEstimateSnapshot.parse({
          buyerName: lead.name,
          pricingAsOf: choices.pricingAsOf,
          buyerPreferredContact: lead.contactMethod,
          leadRevision: lead.revision,
          community: community ?? null,
          plan,
          lot,
          options,
          catalog,
          template: approval ? templateSnapshot(approval.row) : null,
          questionnaire: input.questionnaire,
          defaultLaborRates: laborRates,
        });
        const revision = expected + 1;
        const [draft] = await tx
          .insert(drafts)
          .values({
            orgId,
            opportunityId,
            title: input.title,
            currency: input.currency,
            revision,
            lotId: lot?.id,
            priceBookRevisionId: catalog?.revisionId,
            templateRevisionId: approval?.row.id,
            snapshot,
            createdByUserId: userId,
            clientRequestId: input.clientRequestId,
            requestHash,
          })
          .returning();
        if (!draft) throw problem('internal');
        await tx.update(leads).set({ revision }).where(scope);
        await auditRequest(request, tx, {
          orgId,
          action: 'sales.estimate_created',
          resourceType: 'enterprise_sales_estimate',
          resourceId: draft.id,
          after: {
            opportunityId,
            planId: plan?.id,
            lotId: lot?.id,
            templateRevisionId: approval?.row.id,
            catalogRevisionId: catalog?.revisionId,
          },
        });
        await enqueue(tx, {
          orgId,
          task: 'sales.estimate_created',
          aggregateType: 'enterprise_sales_estimate',
          aggregateId: draft.id,
          payload: { opportunityId, estimateId: draft.id },
          correlationId: request.id,
          jobKey: 'sales.estimate_created:' + draft.id,
        });
        return { created: true, data: await dto(tx, draft) };
      });
      setEtag(reply, result.data.revision);
      return reply
        .header('cache-control', cache)
        .code(result.created ? 201 : 200)
        .send(result.data);
    },
  );
};

export default salesEstimates;
