import { createHash } from 'node:crypto';
import {
  SalesPipelineView,
  SalesPipelineViewPage,
  SaveSalesPipelineView,
} from '@fieldline/contracts';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { users } from '../../db/schema/auth';
import { salesPipelineViews as views } from '../../db/schema/enterpriseSalesPipelineViews';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { checkEnabled } from './access';

type Actor = ReturnType<typeof requireOrg>;
type View = typeof views.$inferSelect;
const path = '/enterprise/sales/pipeline/saved-views';
const config = { permission: 'enterprise_sales:intake' } as const;
const tags = ['enterprise'];
const cache = 'private, no-store';

function readViews(tx: Tx) {
  return tx
    .select({ view: views, owner: users.displayName })
    .from(views)
    .innerJoin(users, eq(users.id, views.ownerUserId));
}
function viewScope(actor: Actor) {
  return and(
    eq(views.orgId, actor.orgId),
    or(eq(views.ownerUserId, actor.userId), eq(views.visibility, 'company')),
  );
}
function dto(actor: Actor, row: { view: View; owner: string }) {
  const { view, owner } = row;
  return {
    id: view.id,
    name: view.name,
    filters: view.filters,
    columns: view.columns,
    visibility: view.visibility,
    owner,
    owned: view.ownerUserId === actor.userId,
    createdAt: view.createdAt.toISOString(),
  };
}

export const salesPipelineViews: FastifyPluginAsyncZod = async (app) => {
  app.get(
    path,
    {
      config,
      schema: {
        tags,
        querystring: z.object({
          cursor: z.string().max(256).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(30),
        }),
        response: { 200: SalesPipelineViewPage },
      },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const { cursor, limit } = request.query;
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, actor.orgId);
        const rows = await readViews(tx)
          .where(
            and(viewScope(actor), beforeCursor(views.createdAt, views.id, decodeCursor(cursor))),
          )
          .orderBy(desc(msTrunc(views.createdAt)), desc(views.id))
          .limit(limit + 1);
        return pageResult(
          rows,
          limit,
          ({ view }) => ({ at: view.createdAt, id: view.id }),
          (row) => dto(actor, row),
        );
      });
      return reply.header('cache-control', cache).send(result);
    },
  );

  app.get(
    path + '/:viewId',
    {
      config,
      schema: {
        tags,
        params: z.object({ viewId: z.uuid() }),
        response: { 200: SalesPipelineView },
      },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, actor.orgId);
        const [row] = await readViews(tx).where(
          and(viewScope(actor), eq(views.id, request.params.viewId)),
        );
        if (!row) throw problem('not_found');
        return dto(actor, row);
      });
      return reply.header('cache-control', cache).send(result);
    },
  );

  app.post(
    path,
    {
      config,
      schema: {
        tags,
        body: SaveSalesPipelineView,
        response: { 200: SalesPipelineView, 201: SalesPipelineView },
      },
    },
    async (request, reply) => {
      const actor = requireOrg(request);
      const { clientRequestId, ...input } = request.body;
      if (input.visibility === 'company' && !actor.permissions.has('enterprise_sales:manage')) {
        throw problem('forbidden', 'Only Sales managers can share a view with the company.');
      }
      const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const result = await tenantTx(request, async (tx) => {
        await checkEnabled(tx, actor.orgId);
        const owned = and(eq(views.orgId, actor.orgId), eq(views.ownerUserId, actor.userId));
        const keyed = and(owned, eq(views.clientRequestId, clientRequestId));
        const [before] = await readViews(tx).where(keyed);
        function replay(previous: NonNullable<typeof before>) {
          if (previous.view.requestHash !== requestHash)
            throw problem('conflict', 'This request ID already belongs to another saved view.');
          return { created: false, view: dto(actor, previous) };
        }
        if (before) return replay(before);
        const [created] = await tx
          .insert(views)
          .values({
            orgId: actor.orgId,
            ownerUserId: actor.userId,
            clientRequestId,
            requestHash,
            ...input,
          })
          .onConflictDoNothing()
          .returning({ id: views.id });
        if (!created) {
          const [concurrent] = await readViews(tx).where(keyed);
          if (concurrent) return replay(concurrent);
          const [named] = await tx
            .select({ id: views.id })
            .from(views)
            .where(and(owned, sql`lower(${views.name}) = lower(${input.name})`));
          if (named) throw problem('conflict', 'You already have a saved view with this name.');
          throw problem('conflict', 'The view could not be saved. Try again.');
        }
        const [row] = await readViews(tx).where(and(owned, eq(views.id, created.id)));
        if (!row) throw problem('internal');
        await auditRequest(request, tx, {
          orgId: actor.orgId,
          action: 'sales.pipeline_view_saved',
          resourceType: 'enterprise_sales_pipeline_view',
          resourceId: row.view.id,
          after: {
            visibility: input.visibility,
            filterKeys: Object.keys(input.filters),
            columns: input.columns,
            sort: input.filters.sort ?? 'created_desc',
          },
        });
        return { created: true, view: dto(actor, row) };
      });
      return reply
        .code(result.created ? 201 : 200)
        .header('cache-control', cache)
        .send(result.view);
    },
  );
};
