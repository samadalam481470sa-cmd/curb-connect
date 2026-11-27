import { createHash, randomUUID } from 'node:crypto';
import {
  GenerateSalesProposal,
  SalesProposalOptions,
  SalesProposalReceipt,
} from '@fieldline/contracts';
import { and, eq, getTableColumns, isNull, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { contacts, customers } from '../../db/schema/crm';
import { enterpriseSalesLeads as leads } from '../../db/schema/enterpriseSalesLeads';
import {
  salesProposalIssues as issues,
  salesProposalTemplateRevisions as templates,
} from '../../db/schema/enterpriseSalesProposals';
import { proposalOptions, proposals, proposalVersions } from '../../db/schema/proposals';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { checkEnabled } from './access';
import { approvedPricingDto, readApprovedPricing } from './salesEstimatePricing';
import { companyPricing } from './salesEstimateSources';
import { leadScope } from './salesLeads';
import { salesProposalDocument } from './salesProposalDocument';
import { salesProposalTemplateDto, salesProposalTemplates } from './salesProposalTemplates';

const path = '/enterprise/sales/opportunities/:opportunityId/proposals';
const config = { permission: 'enterprise_sales:intake' } as const;
const params = z.object({ opportunityId: z.uuid() });
const tags = ['enterprise'];
const cache = 'private, no-store';
type Lead = typeof leads.$inferSelect;

const { pdfBytes: _pdfBytes, ...issueSummary } = getTableColumns(issues);

function receipts(tx: Tx) {
  return tx
    .select({ record: issueSummary, proposalNumber: proposals.number })
    .from(issues)
    .innerJoin(
      proposals,
      and(eq(proposals.orgId, issues.orgId), eq(proposals.id, issues.proposalId)),
    );
}

function receiptDto(record: Omit<typeof issues.$inferSelect, 'pdfBytes'>, proposalNumber: string) {
  const {
    id,
    opportunityId,
    estimateRevisionId,
    templateRevisionId,
    proposalId,
    proposalVersionId,
    totalMinor,
    currency,
    validUntil,
    pdfSha256,
    revision,
    createdAt,
  } = record;
  return {
    id,
    opportunityId,
    estimateRevisionId,
    templateRevisionId,
    proposalId,
    proposalVersionId,
    proposalNumber,
    totalMinor,
    currency,
    validUntil,
    pdfSha256,
    revision,
    createdAt: createdAt.toISOString(),
  };
}

function contactChoices(tx: Tx, lead: Lead) {
  const byEmail = lead.email ? sql`lower(btrim(${contacts.email})) = ${lead.email}` : undefined;
  const byPhone = lead.phone
    ? sql`regexp_replace(${contacts.phone}, '[^0-9]', '', 'g') = ${lead.phone}`
    : undefined;
  const byName =
    !lead.email && !lead.phone
      ? sql`lower(btrim(${contacts.displayName})) = lower(btrim(${lead.name}))`
      : undefined;
  return tx
    .select({
      id: contacts.id,
      customerId: customers.id,
      name: contacts.displayName,
      customerName: customers.displayName,
    })
    .from(contacts)
    .innerJoin(
      customers,
      and(
        eq(customers.orgId, contacts.orgId),
        eq(customers.id, contacts.customerId),
        eq(customers.status, 'active'),
        isNull(customers.deletedAt),
      ),
    )
    .where(
      and(
        eq(contacts.orgId, lead.orgId),
        eq(contacts.status, 'active'),
        isNull(contacts.deletedAt),
        or(byEmail, byPhone, byName),
      ),
    )
    .limit(30);
}

const salesProposalRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    { config, schema: { tags, params, response: { 200: SalesProposalOptions } } },
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
        const options = await Promise.all([
          readApprovedPricing(tx, actor.orgId, opportunityId),
          contactChoices(tx, lead),
          salesProposalTemplates(tx, actor.orgId),
          companyPricing(tx, actor.orgId),
          receipts(tx).where(
            and(eq(issues.orgId, actor.orgId), eq(issues.opportunityId, opportunityId)),
          ),
        ]);
        const [approved, eligibleContacts, approvedTemplates, pricing, [existing]] = options;
        return {
          opportunityId,
          opportunityName: lead.name,
          revision: lead.revision,
          approvedEstimateId: approved?.id ?? null,
          canGenerate: Boolean(
            approved &&
            lead.pipelineStage === 'estimating' &&
            !existing &&
            eligibleContacts.length &&
            approvedTemplates.length,
          ),
          approvedTotalMinor: approved?.approvalSnapshot.totalMinor ?? null,
          currency: approved?.approvalSnapshot.currency ?? null,
          eligibleContacts,
          templates: approvedTemplates.map(salesProposalTemplateDto),
          earliestExpiration: pricing.effectiveOn,
          existing: existing ? receiptDto(existing.record, existing.proposalNumber) : null,
        };
      });
      setEtag(reply, data.revision);
      return reply.header('cache-control', cache).send(data);
    },
  );

  app.post(
    path,
    {
      config: { ...config, rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags,
        params,
        body: GenerateSalesProposal,
        response: { 200: SalesProposalReceipt, 201: SalesProposalReceipt },
      },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const { opportunityId } = request.params;
      const { orgId, userId } = actor;
      const input = request.body;
      const expected = parseIfMatch(request);
      const requestHash = createHash('sha256')
        .update(JSON.stringify([input, expected]))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const scope = and(leadScope(actor), eq(leads.id, opportunityId));
        const [lead] = await tx.select().from(leads).where(scope).for('update');
        if (!lead) throw problem('not_found');
        const [prior] = await receipts(tx).where(
          and(eq(issues.orgId, orgId), eq(issues.opportunityId, opportunityId)),
        );
        if (prior?.record.clientRequestId === input.clientRequestId) {
          if (prior.record.requestHash !== requestHash || prior.record.createdByUserId !== userId)
            throw problem('conflict', 'This request already generated a different proposal.');
          return { created: false, data: receiptDto(prior.record, prior.proposalNumber) };
        }
        if (prior)
          throw problem('conflict', 'This approved estimate already has a generated proposal.');
        assertRevision(lead.revision, expected);
        if (lead.pipelineStage !== 'estimating')
          throw problem('conflict', 'The opportunity must be in Estimating.');
        const approval = await readApprovedPricing(tx, orgId, opportunityId);
        if (!approval || approval.id !== input.estimateRevisionId)
          throw problem(
            'precondition_failed',
            'Use the approved pricing revision for this opportunity.',
          );
        const pricing = approvedPricingDto(approval);
        if (
          !pricing.readyForApproval ||
          pricing.options.some(({ amountMinor }) => amountMinor === null)
        )
          throw problem('conflict', 'Every selected option must have approved pricing.');
        const [contacts, [selectedTemplate], profile] = await Promise.all([
          contactChoices(tx, lead),
          tx
            .select()
            .from(templates)
            .where(and(eq(templates.orgId, orgId), eq(templates.id, input.templateRevisionId))),
          companyPricing(tx, orgId),
        ]);
        const buyer = contacts.find(({ id }) => id === input.contactId);
        if (!buyer || !selectedTemplate)
          throw problem(
            'not_found',
            'Choose a matching buyer contact and an approved proposal template.',
          );
        if (input.validUntil < profile.effectiveOn)
          throw problem(
            'validation_failed',
            'Choose an expiration on or after the current company date.',
          );
        const template = salesProposalTemplateDto(selectedTemplate);
        const title = lead.name + ' proposal';
        const [proposal] = await tx
          .insert(proposals)
          .values({
            orgId,
            number: 'PROP-' + randomUUID().slice(0, 8).toUpperCase(),
            title,
            customerId: buyer.customerId,
            contactId: buyer.id,
            expiresOn: input.validUntil,
            currency: pricing.currency,
          })
          .returning({ id: proposals.id, number: proposals.number });
        if (!proposal) throw problem('internal');
        const content = {
          includedScope: pricing.includedScope,
          excludedScope: pricing.excludedScope,
          allowances: pricing.allowances,
          paymentTerms: template.paymentTerms,
          terms: template.terms,
          taxTreatment: template.taxTreatment,
        };
        const [version] = await tx
          .insert(proposalVersions)
          .values({
            orgId,
            proposalId: proposal.id,
            versionNumber: 1,
            content,
            termsVersion: template.id,
            subtotalMinor: pricing.subtotalMinor,
            taxMinor: pricing.taxMinor,
            totalMinor: pricing.totalMinor,
          })
          .returning({ id: proposalVersions.id });
        if (!version) throw problem('internal');
        await tx.insert(proposalOptions).values({
          orgId,
          proposalVersionId: version.id,
          key: 'approved-scope',
          kind: 'package',
          label: 'Approved scope',
          amountMinor: pricing.subtotalMinor,
          isDefault: true,
          sortOrder: 0,
          lines: [...pricing.allowances, ...pricing.options],
        });
        await tx
          .update(proposals)
          .set({ currentVersionId: version.id })
          .where(and(eq(proposals.orgId, orgId), eq(proposals.id, proposal.id)));
        const now = new Date();
        const pdf = await salesProposalDocument({
          number: proposal.number,
          title,
          buyer: buyer.name,
          company: actor.orgDisplayName,
          preparedAt: now,
          expires: input.validUntil,
          pricing,
          template,
        });
        const revision = expected + 1;
        const [saved] = await tx
          .insert(issues)
          .values({
            orgId,
            opportunityId,
            estimateRevisionId: approval.id,
            templateRevisionId: template.id,
            proposalId: proposal.id,
            proposalVersionId: version.id,
            totalMinor: pricing.totalMinor,
            currency: pricing.currency,
            validUntil: input.validUntil,
            pdfBytes: pdf.buffer,
            pdfSha256: pdf.sha256,
            revision,
            createdByUserId: userId,
            clientRequestId: input.clientRequestId,
            requestHash,
            createdAt: now,
          })
          .returning(issueSummary);
        if (!saved) throw problem('internal');
        await tx.update(leads).set({ revision }).where(scope);
        await auditRequest(request, tx, {
          orgId,
          action: 'sales.proposal_generated',
          resourceType: 'enterprise_sales_proposal',
          resourceId: saved.id,
          after: {
            opportunityId,
            proposalId: proposal.id,
            versionId: version.id,
            approvedPricingId: approval.id,
            totalMinor: saved.totalMinor,
            validUntil: saved.validUntil,
          },
        });
        await enqueue(tx, {
          orgId,
          task: 'sales.proposal_generated',
          aggregateType: 'enterprise_sales_proposal',
          aggregateId: saved.id,
          payload: { opportunityId, proposalIssueId: saved.id },
          correlationId: request.id,
          jobKey: 'sales.proposal_generated:' + saved.id,
        });
        return { created: true, data: receiptDto(saved, proposal.number) };
      });
      setEtag(reply, result.data.revision);
      return reply
        .header('cache-control', cache)
        .code(result.created ? 201 : 200)
        .send(result.data);
    },
  );

  app.get(path + '/pdf', { config, schema: { tags, params } }, async (request, reply) => {
    const actor = requireOrg(request);
    const { opportunityId } = request.params;
    const document = await tenantTx(request, async (tx) => {
      await checkEnabled(tx, actor.orgId);
      const [row] = await tx
        .select({ bytes: issues.pdfBytes, hash: issues.pdfSha256, number: proposals.number })
        .from(issues)
        .innerJoin(leads, and(eq(leads.orgId, issues.orgId), eq(leads.id, issues.opportunityId)))
        .innerJoin(
          proposals,
          and(eq(proposals.orgId, issues.orgId), eq(proposals.id, issues.proposalId)),
        )
        .where(
          and(
            leadScope(actor),
            eq(issues.orgId, actor.orgId),
            eq(issues.opportunityId, opportunityId),
          ),
        );
      if (!row) throw problem('not_found');
      return row;
    });
    return reply
      .header('cache-control', cache)
      .header('etag', '"' + document.hash + '"')
      .header('content-disposition', 'attachment; filename="' + document.number + '.pdf"')
      .type('application/pdf')
      .send(document.bytes);
  });
};

export default salesProposalRoutes;
