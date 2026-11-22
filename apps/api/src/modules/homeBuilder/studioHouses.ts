// House Studio saved houses: list, open, save, rename, duplicate, move to trash, restore, purge.
// Tenant scope comes from the session (tenantTx + RLS), never from the body. Reads need
// estimate:read; writes need estimate:write. Every edit names the revision it was made from, so a
// stale tab cannot overwrite newer work (409 revision_conflict). Trash, restore and purge are audited.
import { and, count, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CreateStudioHouseSchema,
  STUDIO_HOUSE_LIMIT,
  StudioHouseListSchema,
  StudioHouseSchema,
  StudioHouseSettingsSchema,
  StudioHouseSpecSchema,
  UpdateStudioHouseSchema,
} from '@fieldline/contracts';
import { z } from 'zod';
import { studioHouses } from '../../db/schema/homeBuilder';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';

const Params = z.object({ id: z.uuid() });
const BODY_LIMIT = 320 * 1024;
type Row = typeof studioHouses.$inferSelect;

function toHouse(row: Row) {
  return StudioHouseSchema.parse({
    id: row.id,
    name: row.name,
    source: row.source,
    brief: row.brief,
    spec: StudioHouseSpecSchema.parse(row.spec),
    settings: StudioHouseSettingsSchema.parse(row.settings),
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  });
}

async function findHouse(tx: Tx, id: string): Promise<Row> {
  const [row] = await tx.select().from(studioHouses).where(eq(studioHouses.id, id)).limit(1);
  if (!row) throw problem('not_found', 'Saved house not found.');
  return row;
}

async function assertUnderLimit(tx: Tx): Promise<void> {
  const [row] = await tx.select({ n: count() }).from(studioHouses);
  if (Number(row?.n ?? 0) >= STUDIO_HOUSE_LIMIT) {
    throw problem('conflict', `You can keep up to ${STUDIO_HOUSE_LIMIT} saved houses. Empty the trash or delete old houses first.`);
  }
}

const studioHouseRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/studio-houses', {
    config: { permission: 'estimate:read', rateLimit: { max: 120, timeWindow: '1 minute' } },
    schema: {
      tags: ['home builder'],
      summary: 'List saved House Studio houses (or the trash)',
      querystring: z.object({ trash: z.enum(['true', 'false']).default('false') }),
      response: { 200: StudioHouseListSchema },
    },
  }, async (request) => {
    requireOrg(request);
    const inTrash = request.query.trash === 'true';
    const rows = await tenantTx(request, (tx) =>
      tx.select().from(studioHouses)
        .where(inTrash ? isNotNull(studioHouses.deletedAt) : isNull(studioHouses.deletedAt))
        .orderBy(desc(studioHouses.updatedAt))
        .limit(STUDIO_HOUSE_LIMIT),
    );
    return { items: rows.map(toHouse) };
  });

  app.post('/studio-houses', {
    config: { permission: 'estimate:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
    bodyLimit: BODY_LIMIT,
    schema: {
      tags: ['home builder'],
      summary: 'Save a house from the studio (AI-built, plan-read or drawn by hand)',
      body: CreateStudioHouseSchema,
      response: { 201: StudioHouseSchema },
    },
  }, async (request, reply) => {
    const org = requireOrg(request);
    const row = await tenantTx(request, async (tx) => {
      await assertUnderLimit(tx);
      const [inserted] = await tx.insert(studioHouses).values({
        orgId: org.orgId,
        name: request.body.name,
        source: request.body.source,
        brief: request.body.brief,
        spec: request.body.spec,
        settings: request.body.settings,
        createdByUserId: org.userId,
      }).returning();
      return inserted!;
    });
    reply.code(201);
    return toHouse(row);
  });

  app.get('/studio-houses/:id', {
    config: { permission: 'estimate:read' },
    schema: { tags: ['home builder'], summary: 'Open a saved house', params: Params, response: { 200: StudioHouseSchema } },
  }, async (request) => {
    requireOrg(request);
    return toHouse(await tenantTx(request, (tx) => findHouse(tx, request.params.id)));
  });

  app.patch('/studio-houses/:id', {
    config: { permission: 'estimate:write', rateLimit: { max: 120, timeWindow: '1 minute' } },
    bodyLimit: BODY_LIMIT,
    schema: {
      tags: ['home builder'],
      summary: 'Rename or save changes to a house; send the revision you edited',
      params: Params,
      body: UpdateStudioHouseSchema,
      response: { 200: StudioHouseSchema },
    },
  }, async (request) => {
    requireOrg(request);
    const { revision, ...changes } = request.body;
    const row = await tenantTx(request, async (tx) => {
      const [updated] = await tx.update(studioHouses)
        .set({ ...changes, revision: sql`${studioHouses.revision} + 1`, updatedAt: new Date() })
        .where(and(eq(studioHouses.id, request.params.id), eq(studioHouses.revision, revision), isNull(studioHouses.deletedAt)))
        .returning();
      if (updated) return updated;
      const current = await findHouse(tx, request.params.id);
      if (current.deletedAt) throw problem('conflict', 'This house is in the trash. Restore it before editing.');
      throw problem('revision_conflict', `This house was saved elsewhere (now revision ${current.revision}). Reload it before saving.`);
    });
    return toHouse(row);
  });

  app.post('/studio-houses/:id/duplicate', {
    config: { permission: 'estimate:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { tags: ['home builder'], summary: 'Copy a saved house', params: Params, response: { 201: StudioHouseSchema } },
  }, async (request, reply) => {
    const org = requireOrg(request);
    const row = await tenantTx(request, async (tx) => {
      const source = await findHouse(tx, request.params.id);
      await assertUnderLimit(tx);
      const [inserted] = await tx.insert(studioHouses).values({
        orgId: org.orgId,
        name: `${source.name.slice(0, 153)} (copy)`,
        source: source.source,
        brief: source.brief,
        spec: source.spec,
        settings: source.settings,
        createdByUserId: org.userId,
      }).returning();
      return inserted!;
    });
    reply.code(201);
    return toHouse(row);
  });

  app.delete('/studio-houses/:id', {
    config: { permission: 'estimate:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: {
      tags: ['home builder'],
      summary: 'Move a house to the trash, or purge a house that is already in the trash (?permanent=true)',
      params: Params,
      querystring: z.object({ permanent: z.enum(['true', 'false']).default('false') }),
      response: { 200: StudioHouseSchema, 204: z.null() },
    },
  }, async (request, reply) => {
    const org = requireOrg(request);
    const permanent = request.query.permanent === 'true';
    const row = await tenantTx(request, async (tx) => {
      const current = await findHouse(tx, request.params.id);
      if (permanent) {
        if (!current.deletedAt) throw problem('conflict', 'Move the house to the trash before deleting it for good.');
        await tx.delete(studioHouses).where(eq(studioHouses.id, current.id));
        await auditRequest(request, tx, {
          orgId: org.orgId, action: 'studio_house.purged', resourceType: 'studio_house', resourceId: current.id,
          before: { name: current.name, revision: current.revision },
        });
        return null;
      }
      if (current.deletedAt) return current;
      const [trashed] = await tx.update(studioHouses)
        .set({ deletedAt: new Date(), revision: sql`${studioHouses.revision} + 1`, updatedAt: new Date() })
        .where(eq(studioHouses.id, current.id))
        .returning();
      await auditRequest(request, tx, {
        orgId: org.orgId, action: 'studio_house.trashed', resourceType: 'studio_house', resourceId: current.id,
        before: { name: current.name, revision: current.revision },
      });
      return trashed!;
    });
    if (!row) {
      reply.code(204);
      return null;
    }
    return toHouse(row);
  });

  app.post('/studio-houses/:id/restore', {
    config: { permission: 'estimate:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: { tags: ['home builder'], summary: 'Take a house out of the trash', params: Params, response: { 200: StudioHouseSchema } },
  }, async (request) => {
    const org = requireOrg(request);
    const row = await tenantTx(request, async (tx) => {
      const current = await findHouse(tx, request.params.id);
      if (!current.deletedAt) return current;
      const [restored] = await tx.update(studioHouses)
        .set({ deletedAt: null, revision: sql`${studioHouses.revision} + 1`, updatedAt: new Date() })
        .where(eq(studioHouses.id, current.id))
        .returning();
      await auditRequest(request, tx, {
        orgId: org.orgId, action: 'studio_house.restored', resourceType: 'studio_house', resourceId: current.id,
        after: { name: current.name },
      });
      return restored!;
    });
    return toHouse(row);
  });
};

export default studioHouseRoutes;
