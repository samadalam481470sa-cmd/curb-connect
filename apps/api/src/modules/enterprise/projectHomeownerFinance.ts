import { createHash } from 'node:crypto';
import {
  HomeownerFinanceVisibilityPreview,
  PreviewHomeownerFinanceVisibility,
  ProjectHomeownerFinanceReceipt,
  ProjectHomeownerFinanceSettings,
  SetHomeownerFinanceVisibility,
} from '@fieldline/contracts';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { enterpriseMediaHomeownerRecipients as recipients } from '../../db/schema/enterpriseMediaHomeowner';
import {
  homeownerFinanceContractLinks as links,
  homeownerFinanceVisibilityRevisions as revisions,
} from '../../db/schema/enterpriseHomeownerFinance';
import { proposals } from '../../db/schema/proposals';
import { contacts, customers } from '../../db/schema/crm';
import type { Tx } from '../../db/runtime';
import { tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { sealSecret, unsealSecret } from '../team/service';
import { BudgetProjectParams, requireBudgetProject } from './budgetAccess';
import {
  activeHomeownerFinanceRecipient,
  homeownerFinanceHistory,
  homeownerFinanceTokenHash,
  homeownerFinanceUrl,
  newHomeownerFinanceToken,
  prepareHomeownerFinancePreview,
} from './homeownerFinanceAccess';

const path = '/enterprise/projects/:projectId/financials/homeowner';
const permission = { permission: 'enterprise_budget:manage_grants' } as const;

function revisionDto(row: typeof revisions.$inferSelect) {
  const {
    id,
    revision,
    enabled,
    reason,
    contactId,
    acceptedProposalId,
    acceptedProposalVersionId,
    disclosure,
  } = row;
  return {
    id,
    revision,
    enabled,
    reason,
    contactId,
    acceptedProposalId,
    acceptedProposalVersionId,
    disclosure,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    recordedAt: row.createdAt.toISOString(),
  };
}

const projectHomeownerFinance: FastifyPluginAsyncZod = async (app) => {
  function shareUrl(row: typeof revisions.$inferSelect | undefined) {
    if (!row?.enabled || !row.tokenSealed || !row.expiresAt || row.expiresAt <= new Date())
      return null;
    return homeownerFinanceUrl(
      app.config.appOrigin,
      row.projectId,
      unsealSecret(app.config.session.secret, row.tokenSealed),
    );
  }

  async function currentShareUrl(tx: Tx, row: typeof revisions.$inferSelect | undefined) {
    if (!row?.enabled || !(await activeHomeownerFinanceRecipient(tx, row))) return null;
    return shareUrl(row);
  }

  app.get(
    path,
    {
      config: permission,
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams,
        response: { 200: ProjectHomeownerFinanceSettings },
      },
    },
    async (request, reply) => {
      const data = await tenantTx(request, async (tx) => {
        const { projectId } = request.params;
        const { org, project } = await requireBudgetProject(request, tx, projectId);
        const scope = { orgId: org.orgId, projectId };
        const latestGrants = tx
          .selectDistinctOn([recipients.contactId], {
            contactId: recipients.contactId,
            active: recipients.active,
          })
          .from(recipients)
          .where(and(eq(recipients.orgId, org.orgId), eq(recipients.projectId, projectId)))
          .orderBy(recipients.contactId, desc(recipients.revision))
          .as('finance_contact_grants');
        const [history, contracts] = await Promise.all([
          homeownerFinanceHistory(tx, scope, 20),
          tx
            .select({
              id: proposals.id,
              versionId: proposals.acceptedVersionId,
              number: proposals.number,
              title: proposals.title,
              contactId: proposals.contactId,
            })
            .from(proposals)
            .innerJoin(
              latestGrants,
              and(eq(latestGrants.contactId, proposals.contactId), eq(latestGrants.active, true)),
            )
            .innerJoin(
              contacts,
              and(
                eq(contacts.id, proposals.contactId),
                eq(contacts.orgId, proposals.orgId),
                eq(contacts.status, 'active'),
                isNull(contacts.deletedAt),
              ),
            )
            .innerJoin(
              customers,
              and(
                eq(customers.id, contacts.customerId),
                eq(customers.orgId, contacts.orgId),
                eq(customers.status, 'active'),
                isNull(customers.deletedAt),
              ),
            )
            .leftJoin(
              links,
              and(
                eq(links.orgId, proposals.orgId),
                eq(links.acceptedProposalVersionId, proposals.acceptedVersionId),
              ),
            )
            .where(
              and(
                eq(proposals.orgId, org.orgId),
                eq(proposals.status, 'accepted'),
                or(isNull(links.projectId), eq(links.projectId, projectId)),
              ),
            )
            .orderBy(desc(proposals.createdAt), desc(proposals.id))
            .limit(50),
        ]);
        return {
          projectName: project.name,
          current: history[0] ? revisionDto(history[0]) : null,
          shareUrl: await currentShareUrl(tx, history[0]),
          history: history.map(revisionDto),
          eligibleContracts: contracts.flatMap((row) =>
            row.versionId && row.contactId
              ? [{ ...row, versionId: row.versionId, contactId: row.contactId }]
              : [],
          ),
        };
      });
      setEtag(reply, data.current?.revision ?? 0);
      return reply.header('cache-control', 'private, no-store').send(data);
    },
  );

  app.post(
    path + '/preview',
    {
      config: permission,
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams,
        body: PreviewHomeownerFinanceVisibility,
        response: { 200: HomeownerFinanceVisibilityPreview },
      },
    },
    async (request, reply) => {
      const result = await tenantTx(request, async (tx) => {
        const { projectId } = request.params;
        const { org } = await requireBudgetProject(request, tx, projectId);
        return prepareHomeownerFinancePreview(tx, { orgId: org.orgId, projectId }, request.body);
      });
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.put(
    path,
    {
      config: permission,
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams,
        body: SetHomeownerFinanceVisibility,
        response: { 200: ProjectHomeownerFinanceReceipt },
      },
    },
    async (request, reply) => {
      const input = request.body;
      const expected = parseIfMatch(request);
      const hash = createHash('sha256').update(JSON.stringify({ input, expected })).digest('hex');
      const result = await tenantTx(request, async (tx) => {
        const { projectId } = request.params;
        const { org } = await requireBudgetProject(request, tx, projectId, true);
        const scope = { orgId: org.orgId, projectId };
        const [receipt] = await tx
          .select()
          .from(revisions)
          .where(
            and(
              eq(revisions.orgId, org.orgId),
              eq(revisions.projectId, projectId),
              eq(revisions.clientRequestId, input.clientRequestId),
            ),
          );
        if (receipt) {
          if (receipt.approvedByUserId !== org.userId || receipt.requestHash !== hash)
            throw problem('conflict', 'This request already saved different visibility settings.');
          const [current] = await homeownerFinanceHistory(tx, scope, 1);
          return {
            ...revisionDto(receipt),
            shareUrl: current?.id === receipt.id ? await currentShareUrl(tx, receipt) : null,
          };
        }

        const [current] = await homeownerFinanceHistory(tx, scope, 1);
        assertRevision(current?.revision ?? 0, expected);
        const base = {
          ...scope,
          revision: expected + 1,
          enabled: input.enabled,
          reason: input.reason,
          approvedByUserId: org.userId,
          clientRequestId: input.clientRequestId,
          requestHash: hash,
        };
        let details: Partial<typeof revisions.$inferInsert> = {};
        if (input.enabled) {
          const {
            contactId,
            acceptedProposalId,
            acceptedProposalVersionId,
            discloseInternalCost,
            discloseMargin,
            expiresInDays,
          } = input;
          const preview = await prepareHomeownerFinancePreview(tx, scope, {
            contactId,
            acceptedProposalId,
            acceptedProposalVersionId,
            discloseInternalCost,
            discloseMargin,
            expiresInDays,
          });
          if (preview.previewFingerprint !== input.previewFingerprint)
            throw problem(
              'precondition_failed',
              'Review the current contract and disclosure preview before publishing.',
            );
          await tx
            .insert(links)
            .values({ ...scope, acceptedProposalVersionId })
            .onConflictDoNothing();
          const [match] = await tx
            .select({ projectId: links.projectId })
            .from(links)
            .where(
              and(
                eq(links.orgId, org.orgId),
                eq(links.acceptedProposalVersionId, acceptedProposalVersionId),
              ),
            );
          if (match?.projectId !== projectId)
            throw problem('conflict', 'This accepted proposal is linked to a different project.');
          const token = newHomeownerFinanceToken();
          details = {
            contactId,
            recipientGrantId: preview.grantId,
            acceptedProposalId,
            acceptedProposalVersionId,
            forecastId: preview.forecastId,
            disclosure: preview.disclosure,
            tokenHash: homeownerFinanceTokenHash(token),
            tokenSealed: sealSecret(app.config.session.secret, token),
            expiresAt: new Date(Date.now() + expiresInDays * 864e5),
          };
        }
        const [saved] = await tx
          .insert(revisions)
          .values({ ...base, ...details })
          .returning();
        if (!saved) throw problem('internal');
        const after = revisionDto(saved);
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'finance.homeowner_visibility_changed',
          resourceType: 'enterprise_homeowner_finance_visibility',
          resourceId: saved.id,
          before: current ? revisionDto(current) : null,
          after,
          reason: input.reason,
        });
        return { ...after, shareUrl: shareUrl(saved) };
      });
      setEtag(reply, result.revision);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );
};

export default projectHomeownerFinance;
