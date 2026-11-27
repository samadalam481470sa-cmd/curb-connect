import { createHash } from 'node:crypto';
import {
  ApproveSalesEstimatePricing,
  ApprovedSalesEstimatePricing,
  ReviewSalesEstimatePricing,
  SalesEstimatePricingReview,
  SalesEstimatePricingStatus,
} from '@fieldline/contracts';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { salesEstimatePricingApprovals as approvals } from '../../db/schema/enterpriseSalesEstimatePricing';
import { salesEstimateDrafts as drafts } from '../../db/schema/enterpriseSalesEstimates';
import { enterpriseSalesLeads as leads } from '../../db/schema/enterpriseSalesLeads';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { checkEnabled } from './access';
import { leadScope } from './salesLeads';

type Input = z.infer<typeof ReviewSalesEstimatePricing>;
type Draft = typeof drafts.$inferSelect;
type Approval = typeof approvals.$inferSelect;
type Actor = ReturnType<typeof requireOrg>;
const path = '/enterprise/sales/opportunities/:opportunityId/estimate/pricing';
const auth = { permission: 'enterprise_sales:intake' } as const;
const approve = { permission: 'estimate:approve' } as const;
const params = z.object({ opportunityId: z.uuid() });
const tags = ['enterprise'];

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function priceOptions(draft: Draft) {
  return draft.snapshot.options.map(({ id, name, price }) => ({
    id,
    name,
    amountMinor: price.currency === draft.currency ? price.amountMinor : null,
  }));
}

export function priceReview(draft: Draft, revision: number, input: Input) {
  const options = priceOptions(draft);
  const ids = new Set(options.map(({ id }) => id));
  const overrides = new Map(
    input.optionPricing.map(({ optionId, amountMinor }) => [optionId, amountMinor]),
  );
  if (Array.from(overrides.keys()).some((id) => !ids.has(id)))
    throw problem('validation_failed', 'Price only options selected in this draft.');
  const priced = options.map((option) => ({
    ...option,
    amountMinor: overrides.get(option.id) ?? option.amountMinor,
  }));
  const allowances = input.allowances.reduce((total, line) => total + BigInt(line.amountMinor), 0n);
  const optionTotal = priced.reduce((total, line) => total + BigInt(line.amountMinor ?? 0), 0n);
  const subtotal = BigInt(input.baseSellMinor) + allowances + optionTotal;
  const total = subtotal + BigInt(input.taxMinor);
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw problem('validation_failed', 'The estimate total is above the supported amount.');
  const data = {
    opportunityId: draft.opportunityId,
    estimateId: draft.id,
    revision,
    currency: draft.currency,
    baseSellMinor: input.baseSellMinor,
    taxMinor: input.taxMinor,
    includedScope: input.includedScope,
    excludedScope: input.excludedScope,
    allowances: input.allowances,
    options: priced,
    allowancesMinor: Number(allowances),
    optionsMinor: Number(optionTotal),
    subtotalMinor: Number(subtotal),
    totalMinor: Number(total),
    readyForApproval: priced.every((item) => item.amountMinor !== null),
  };
  return { ...data, priceReview: digest(data) };
}

export function approvedPricingDto(row: Approval) {
  return {
    ...row.approvalSnapshot,
    id: row.id,
    revision: row.revision,
    approvedAt: row.createdAt.toISOString(),
    approvalReason: row.reason,
  };
}

export async function readApprovedPricing(tx: Tx, orgId: string, opportunityId: string) {
  const [row] = await tx
    .select()
    .from(approvals)
    .where(and(eq(approvals.orgId, orgId), eq(approvals.opportunityId, opportunityId)));
  return row;
}

async function requireDraft(tx: Tx, actor: Actor, opportunityId: string, lock = false) {
  await checkEnabled(tx, actor.orgId);
  const scope = and(leadScope(actor), eq(leads.id, opportunityId));
  const query = tx.select().from(leads).where(scope);
  const [lead] = lock ? await query.for('update') : await query;
  if (!lead) throw problem('not_found');
  const [draft] = await tx
    .select()
    .from(drafts)
    .where(and(eq(drafts.orgId, actor.orgId), eq(drafts.opportunityId, opportunityId)));
  if (!draft) throw problem('not_found', 'Save an estimate draft first.');
  return { lead, draft, scope };
}

const salesEstimatePricing: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    { config: auth, schema: { tags, params, response: { 200: SalesEstimatePricingStatus } } },
    async (request, reply) => {
      const actor = requireOrg(request);
      const { opportunityId } = request.params;
      const result = await tenantTx(request, async (tx) => {
        const { lead, draft } = await requireDraft(tx, actor, opportunityId);
        const approved = await readApprovedPricing(tx, actor.orgId, opportunityId);
        return {
          opportunityId,
          estimateId: draft.id,
          estimateTitle: draft.title,
          currency: draft.currency,
          revision: lead.revision,
          approved: approved ? approvedPricingDto(approved) : null,
          canApprove:
            actor.permissions.has('estimate:approve') &&
            lead.pipelineStage === 'estimating' &&
            !approved,
          sourceOptions: priceOptions(draft),
        };
      });
      setEtag(reply, result.revision);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.post(
    path + '/review',
    {
      config: approve,
      schema: {
        tags,
        params,
        body: ReviewSalesEstimatePricing,
        response: { 200: SalesEstimatePricingReview },
      },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const result = await tenantTx(request, async (tx) => {
        const { lead, draft } = await requireDraft(tx, actor, request.params.opportunityId);
        if (lead.pipelineStage !== 'estimating')
          throw problem('conflict', 'Move the opportunity to Estimating before approving prices.');
        return priceReview(draft, lead.revision, request.body);
      });
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.post(
    path + '/approval',
    {
      config: approve,
      schema: {
        tags,
        params,
        body: ApproveSalesEstimatePricing,
        response: { 200: ApprovedSalesEstimatePricing, 201: ApprovedSalesEstimatePricing },
      },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const { opportunityId } = request.params;
      const expected = parseIfMatch(request);
      const { priceReview: expectedReview, reason, clientRequestId, ...input } = request.body;
      const requestHash = digest([request.body, expected]);
      const result = await tenantTx(request, async (tx) => {
        const { lead, draft, scope } = await requireDraft(tx, actor, opportunityId, true);
        const previous = await readApprovedPricing(tx, actor.orgId, opportunityId);
        if (previous?.clientRequestId === clientRequestId) {
          if (previous.approvedByUserId !== actor.userId || previous.requestHash !== requestHash)
            throw problem('conflict', 'This request already approved different pricing.');
          return { created: false, data: approvedPricingDto(previous) };
        }
        if (previous)
          throw problem('conflict', 'Pricing has already been approved for this estimate.');
        assertRevision(lead.revision, expected);
        if (lead.pipelineStage !== 'estimating')
          throw problem('conflict', 'Move the opportunity to Estimating before approving prices.');
        const {
          priceReview: calculatedReview,
          revision: _oldRevision,
          ...snapshot
        } = priceReview(draft, lead.revision, input);
        if (expectedReview !== calculatedReview)
          throw problem(
            'precondition_failed',
            'Review the current price and scope before approving.',
          );
        if (!snapshot.readyForApproval)
          throw problem(
            'conflict',
            'Enter amounts for all selected options before approving this estimate.',
          );
        const revision = expected + 1;
        const [saved] = await tx
          .insert(approvals)
          .values({
            orgId: actor.orgId,
            opportunityId,
            estimateId: draft.id,
            revision,
            approvalSnapshot: snapshot,
            reason,
            approvedByUserId: actor.userId,
            clientRequestId,
            requestHash,
          })
          .returning();
        if (!saved) throw problem('internal');
        await tx.update(leads).set({ revision }).where(scope);
        await auditRequest(request, tx, {
          orgId: actor.orgId,
          action: 'sales.estimate_pricing_approved',
          resourceType: 'enterprise_sales_estimate',
          resourceId: draft.id,
          after: {
            opportunityId,
            approvalId: saved.id,
            currency: snapshot.currency,
            totalMinor: snapshot.totalMinor,
            revision,
          },
          reason,
        });
        await enqueue(tx, {
          orgId: actor.orgId,
          task: 'sales.estimate_pricing_approved',
          aggregateType: 'enterprise_sales_estimate_pricing',
          aggregateId: saved.id,
          payload: { opportunityId, estimateId: draft.id, approvalId: saved.id },
          correlationId: request.id,
          jobKey: 'sales.estimate_pricing_approved:' + saved.id,
        });
        return { created: true, data: approvedPricingDto(saved) };
      });
      setEtag(reply, result.data.revision);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.data);
    },
  );
};

export default salesEstimatePricing;
