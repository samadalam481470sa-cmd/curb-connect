import { EnterprisePendingProjectBidPage } from '@fieldline/contracts';
import { and, desc, eq, gte } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  enterpriseBidPackages as packages,
  enterpriseBidQuotes as quotes,
} from '../../db/schema/enterpriseBidding';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { assertCan, tenantTx } from '../../http/context';
import { BudgetProjectParams, requireBudgetProject } from './budgetAccess';

const query = z.object({
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
const pendingBidCosts: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/enterprise/projects/:projectId/budget/pending-bids',
    {
      config: { permission: 'enterprise_budget:read' },
      schema: {
        tags: ['enterprise'],
        params: BudgetProjectParams,
        querystring: query,
        response: { 200: EnterprisePendingProjectBidPage },
      },
    },
    async (request, reply) => {
      assertCan(request, 'job:read');
      const { projectId } = request.params;
      const { limit } = request.query;
      const cursor = decodeCursor(request.query.cursor);
      const results = await tenantTx(request, async (tx) => {
        const { org } = await requireBudgetProject(request, tx, projectId);
        const rows = await tx
          .select({
            id: quotes.id,
            packageId: quotes.packageId,
            packageTitle: packages.title,
            vendorName: quotes.vendorName,
            validThrough: quotes.validThrough,
            amountMinor: quotes.amountMinor,
            createdAt: quotes.createdAt,
          })
          .from(quotes)
          .innerJoin(
            packages,
            and(
              eq(packages.orgId, quotes.orgId),
              eq(packages.projectId, quotes.projectId),
              eq(packages.id, quotes.packageId),
            ),
          )
          .where(
            and(
              eq(quotes.orgId, org.orgId),
              eq(quotes.projectId, projectId),
              eq(packages.status, 'collecting'),
              gte(quotes.validThrough, new Date().toISOString().slice(0, 10)),
              beforeCursor(quotes.createdAt, quotes.id, cursor),
            ),
          )
          .orderBy(desc(msTrunc(quotes.createdAt)), desc(quotes.id))
          .limit(limit + 1);
        return pageResult(
          rows,
          limit,
          ({ createdAt, id }) => ({ at: createdAt, id }),
          ({ createdAt: _createdAt, ...row }) => row,
        );
      });
      return reply.header('cache-control', 'private, no-store').send(results);
    },
  );
};

export default pendingBidCosts;
