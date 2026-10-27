// `audit` module (PLT-015 D, AIQ-088 D): read the tenant's append-only audit trail. Writes happen
// inside each module's own transaction through services/audit.ts.
import { AuditEventListSchema, PageQuerySchema, UuidSchema } from '@fieldline/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { auditEvents, users } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';

const auditModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/audit-events',
    {
      config: { permission: 'audit:read' },
      schema: {
        tags: ['audit'],
        summary: 'Audit trail of the active company, newest first',
        querystring: PageQuerySchema.extend({
          resourceType: z.string().max(60).optional(),
          resourceId: UuidSchema.optional(),
          action: z.string().max(80).optional(),
          correlationId: z.string().max(128).optional(),
        }),
        response: { 200: AuditEventListSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const q = request.query;
      const cursor = decodeCursor(q.cursor);
      const rows = await tenantTx(request, (tx) =>
        tx
          .select({ e: auditEvents, displayName: users.displayName })
          .from(auditEvents)
          .leftJoin(users, eq(users.id, auditEvents.actorUserId))
          .where(
            and(
              eq(auditEvents.orgId, org.orgId),
              q.resourceType ? eq(auditEvents.resourceType, q.resourceType) : undefined,
              q.resourceId ? eq(auditEvents.resourceId, q.resourceId) : undefined,
              q.action ? eq(auditEvents.action, q.action) : undefined,
              q.correlationId ? eq(auditEvents.correlationId, q.correlationId) : undefined,
              beforeCursor(auditEvents.createdAt, auditEvents.id, cursor),
            ),
          )
          .orderBy(desc(msTrunc(auditEvents.createdAt)), desc(auditEvents.id))
          .limit(q.limit + 1),
      );
      return pageResult(
        rows,
        q.limit,
        (r) => ({ at: r.e.createdAt, id: r.e.id }),
        (r) => ({
          id: r.e.id,
          occurredAt: r.e.occurredAt.toISOString(),
          actorType: r.e.actorType,
          actor: { userId: r.e.actorUserId, displayName: r.displayName },
          action: r.e.action,
          resourceType: r.e.resourceType,
          resourceId: r.e.resourceId,
          before: r.e.before ?? null,
          after: r.e.after ?? null,
          correlationId: r.e.correlationId,
        }),
      );
    },
  );
};

export default auditModule;
