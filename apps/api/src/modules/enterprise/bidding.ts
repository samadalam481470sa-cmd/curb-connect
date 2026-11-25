import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  EnterpriseBidCollection,
  EnterpriseBidPackage,
  EnterpriseBidPackageInput,
  EnterpriseBidPackagePage,
  EnterpriseBidQuote,
  EnterpriseBidQuoteInput,
} from '@fieldline/contracts';
import {
  enterpriseBidPackages as packages,
  enterpriseBidQuotes as quotes,
} from '../../db/schema/enterpriseBidding';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch } from '../../http/revision';
import { audit, checkEnabled, checkProject } from './access';

const ProjectParams = z.object({ projectId: z.uuid() });
const PackageParams = ProjectParams.extend({ packageId: z.uuid() });
const path = '/enterprise/projects/:projectId/bid-packages';
const writes = { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } } as const;
const read = { permission: 'job:read' } as const;

type Quote = typeof quotes.$inferSelect;
function quoteDto(row: Quote) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
function packageScope(orgId: string, projectId: string) {
  return and(eq(packages.orgId, orgId), eq(packages.projectId, projectId));
}
function quoteScope(orgId: string, projectId: string, packageId: string) {
  return and(
    eq(quotes.orgId, orgId),
    eq(quotes.projectId, projectId),
    eq(quotes.packageId, packageId),
  );
}
async function getPackage(
  tx: Tx,
  orgId: string,
  projectId: string,
  packageId: string,
  lock = false,
) {
  const query = tx
    .select()
    .from(packages)
    .where(and(packageScope(orgId, projectId), eq(packages.id, packageId)));
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw problem('not_found');
  return row;
}
function checkCollecting(row: typeof packages.$inferSelect) {
  if (row.status !== 'collecting')
    throw problem('conflict', 'The bid package has a final decision.');
}

const enterpriseBiddingModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    {
      config: read,
      schema: {
        tags: ['enterprise'],
        params: ProjectParams,
        querystring: z.object({ cursor: z.string().max(256).optional() }),
        response: { 200: EnterpriseBidPackagePage },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { projectId } = request.params;
      const cursor = decodeCursor(request.query.cursor);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId);
        const limit = 30;
        const rows = await tx
          .select()
          .from(packages)
          .where(
            and(
              packageScope(orgId, projectId),
              beforeCursor(packages.createdAt, packages.id, cursor),
            ),
          )
          .orderBy(desc(msTrunc(packages.createdAt)), desc(packages.id))
          .limit(limit + 1);
        return pageResult(
          rows,
          limit,
          (row) => ({ at: row.createdAt, id: row.id }),
          (row) => row,
        );
      });
    },
  );

  app.post(
    path,
    {
      config: writes,
      schema: {
        tags: ['enterprise'],
        params: ProjectParams,
        body: EnterpriseBidPackageInput,
        response: { 200: EnterpriseBidPackage, 201: EnterpriseBidPackage },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId } = request.params;
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        await checkProject(tx, orgId, projectId, true);
        const [prior] = await tx
          .select()
          .from(packages)
          .where(
            and(
              packageScope(orgId, projectId),
              eq(packages.clientRequestId, request.body.clientRequestId),
            ),
          );
        if (prior) return { row: prior, created: false };
        const [row] = await tx
          .insert(packages)
          .values({ ...request.body, orgId, projectId, createdByUserId: userId })
          .returning();
        if (!row) throw new Error('Bid package insertion failed.');
        await audit(tx, orgId, userId, 'bid_package', row.id, 'bid_package.created', null, row);
        return { row, created: true };
      });
      return reply.code(result.created ? 201 : 200).send(result.row);
    },
  );

  app.get(
    path + '/:packageId',
    {
      config: read,
      schema: {
        tags: ['enterprise'],
        params: PackageParams,
        response: { 200: EnterpriseBidCollection },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const { projectId, packageId } = request.params;
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const row = await getPackage(tx, orgId, projectId, packageId);
        const items = await tx
          .select()
          .from(quotes)
          .where(quoteScope(orgId, projectId, packageId))
          .orderBy(asc(quotes.amountMinor), asc(quotes.leadDays), asc(quotes.id));
        return { package: row, quotes: items.map(quoteDto) };
      });
    },
  );

  app.post(
    path + '/:packageId/quotes',
    {
      config: writes,
      schema: {
        tags: ['enterprise'],
        params: PackageParams,
        body: EnterpriseBidQuoteInput,
        response: { 200: EnterpriseBidQuote, 201: EnterpriseBidQuote },
      },
    },
    async (request, reply) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId, packageId } = request.params;
      const revision = parseIfMatch(request);
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const pack = await getPackage(tx, orgId, projectId, packageId, true);
        const scope = quoteScope(orgId, projectId, packageId);
        const items = await tx.select().from(quotes).where(scope);
        const prior = items.find((row) => row.clientRequestId === request.body.clientRequestId);
        if (prior) return { row: prior, created: false };
        assertRevision(pack.revision, revision);
        checkCollecting(pack);
        if (items.length >= 100)
          throw problem('conflict', 'This package has reached its 100-quote limit.');
        const [row] = await tx
          .insert(quotes)
          .values({ ...request.body, orgId, projectId, packageId, createdByUserId: userId })
          .returning();
        if (!row) throw new Error('Quote insertion failed.');
        await tx
          .update(packages)
          .set({ revision: pack.revision + 1 })
          .where(and(packageScope(orgId, projectId), eq(packages.id, packageId)));
        await audit(
          tx,
          orgId,
          userId,
          'bid_package',
          packageId,
          'bid_package.quote_recorded',
          null,
          { quoteId: row.id, vendorName: row.vendorName },
        );
        return { row, created: true };
      });
      return reply.code(result.created ? 201 : 200).send(quoteDto(result.row));
    },
  );

  app.post(
    path + '/:packageId/decision',
    {
      config: { permission: 'org:settings_update', rateLimit: { max: 15, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: PackageParams,
        body: z.object({ quoteId: z.uuid().nullable(), note: z.string().trim().min(3).max(1000) }),
        response: { 200: EnterpriseBidPackage },
      },
    },
    async (request) => {
      const { orgId, userId } = requireOrg(request);
      const { projectId, packageId } = request.params;
      const { quoteId, note } = request.body;
      const revision = parseIfMatch(request);
      return tenantTx(request, async (tx) => {
        await checkEnabled(tx, orgId);
        const pack = await getPackage(tx, orgId, projectId, packageId, true);
        assertRevision(pack.revision, revision);
        checkCollecting(pack);
        if (quoteId) {
          const [quote] = await tx
            .select()
            .from(quotes)
            .where(and(quoteScope(orgId, projectId, packageId), eq(quotes.id, quoteId)));
          if (!quote) throw problem('validation_failed', 'Choose a quote from this bid package.');
          if (quote.validThrough < new Date().toISOString().slice(0, 10))
            throw problem(
              'conflict',
              'This quote has expired. Record a current quote before awarding.',
            );
        }
        const [updated] = await tx
          .update(packages)
          .set({
            awardedQuoteId: quoteId,
            status: quoteId ? 'awarded' : 'closed',
            decisionNote: note,
            revision: pack.revision + 1,
          })
          .where(and(packageScope(orgId, projectId), eq(packages.id, packageId)))
          .returning();
        if (!updated) throw problem('not_found');
        await audit(
          tx,
          orgId,
          userId,
          'bid_package',
          packageId,
          quoteId ? 'bid_package.awarded' : 'bid_package.closed',
          pack,
          updated,
        );
        return updated;
      });
    },
  );
};

export default enterpriseBiddingModule;
