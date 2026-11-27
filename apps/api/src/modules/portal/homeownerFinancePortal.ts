import { HomeownerFinanceLinkAccess, HomeownerFinanceLinkView } from '@fieldline/contracts';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { enterpriseProjects, enterpriseSettings } from '../../db/schema/enterprise';
import { homeownerFinanceVisibilityRevisions as revisions } from '../../db/schema/enterpriseHomeownerFinance';
import { organizations } from '../../db/schema/orgs';
import { platformTx } from '../../http/context';
import { problem } from '../../http/problem';
import {
  acceptedHomeownerContract,
  activeHomeownerFinanceRecipient,
  homeownerFinanceHistory,
  homeownerFinanceTokenHash,
} from '../enterprise/homeownerFinanceAccess';

const path = '/portal/homeowner/projects/:projectId/financials';

const homeownerFinancePortal: FastifyPluginAsyncZod = async (app) => {
  app.post(
    path,
    {
      config: { auth: 'none', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['portal'],
        params: z.object({ projectId: z.uuid() }),
        body: HomeownerFinanceLinkAccess,
        response: { 200: HomeownerFinanceLinkView },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const { token } = request.body;
      const view = await platformTx(request, 'portal.homeowner_finance', async (tx) => {
        const [row] = await tx
          .select()
          .from(revisions)
          .where(
            and(
              eq(revisions.projectId, projectId),
              eq(revisions.enabled, true),
              eq(revisions.tokenHash, homeownerFinanceTokenHash(token)),
              gt(revisions.expiresAt, new Date()),
            ),
          );
        if (
          !row?.contactId ||
          !row.acceptedProposalId ||
          !row.acceptedProposalVersionId ||
          !row.disclosure ||
          !row.expiresAt ||
          !row.recipientGrantId
        )
          throw problem('not_found');
        const scope = { orgId: row.orgId, projectId };
        const [current] = await homeownerFinanceHistory(tx, scope, 1);
        if (current?.id !== row.id) throw problem('not_found');
        const [project] = await tx
          .select({ projectName: enterpriseProjects.name, companyName: organizations.displayName })
          .from(enterpriseProjects)
          .innerJoin(
            enterpriseSettings,
            and(
              eq(enterpriseSettings.orgId, enterpriseProjects.orgId),
              eq(enterpriseSettings.enabled, true),
            ),
          )
          .innerJoin(organizations, eq(organizations.id, enterpriseProjects.orgId))
          .where(
            and(eq(enterpriseProjects.orgId, row.orgId), eq(enterpriseProjects.id, projectId)),
          );
        const recipient = await activeHomeownerFinanceRecipient(tx, row);
        const contract = await acceptedHomeownerContract(tx, scope, {
          contactId: row.contactId,
          acceptedProposalId: row.acceptedProposalId,
          acceptedProposalVersionId: row.acceptedProposalVersionId,
        });
        if (
          !project ||
          !recipient ||
          !contract ||
          contract.contractMinor !== row.disclosure.contractMinor ||
          contract.currency !== row.disclosure.currency
        )
          throw problem('not_found');
        return {
          ...project,
          recipientName: recipient.displayName,
          disclosure: row.disclosure,
          expiresAt: row.expiresAt.toISOString(),
        };
      });
      return reply
        .header('cache-control', 'private, no-store')
        .header('x-robots-tag', 'noindex, nofollow')
        .send(view);
    },
  );
};

export default homeownerFinancePortal;
