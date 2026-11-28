// House Studio saved houses: list, open, save, rename, duplicate, move to trash, restore, purge.
// Tenant scope comes from the session (tenantTx + RLS), never from the body. Reads need
// estimate:read; writes need estimate:write. Every edit names the revision it was made from, so a
// stale tab cannot overwrite newer work (409 revision_conflict). Trash, restore and purge are audited.
import { and, count, desc, eq, isNotNull, isNull, max, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  CreateStudioHouseSchema,
  STUDIO_HOUSE_LIMIT,
  StudioEstimateLineSchema,
  StudioEstimateSnapshotSchema,
  StudioHouseListSchema,
  StudioHouseSchema,
  StudioHouseSettingsSchema,
  StudioHouseSpecSchema,
  UpdateStudioHouseSchema,
} from '@fieldline/contracts';
import { z } from 'zod';
import { estimateRevisions, estimates } from '../../db/schema';
import { studioHouses } from '../../db/schema/homeBuilder';
import type { Tx } from '../../db/runtime';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import {
  computeStudioEstimate,
  nextEstimateNumber,
  STUDIO_ESTIMATE_BASIS,
  studioRevisionData,
} from '../../services/studioEstimate';

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

type EstimateRow = typeof estimates.$inferSelect;
type RevisionRow = typeof estimateRevisions.$inferSelect;

function snapshotDto(estimate: EstimateRow, revision: RevisionRow) {
  const inputs = (revision.inputs ?? {}) as Record<string, unknown>;
  const settings = (inputs.settings ?? {}) as Record<string, unknown>;
  return StudioEstimateSnapshotSchema.parse({
    estimateId: estimate.id,
    number: estimate.number,
    studioHouseId: estimate.studioHouseId,
    revisionNumber: revision.revisionNumber,
    status: revision.status,
    currency: revision.currency,
    lines: z.array(StudioEstimateLineSchema).parse(revision.lines),
    totalMinor: revision.totalMinor,
    areaSqFt: typeof inputs.areaSqFt === 'number' ? inputs.areaSqFt : 0,
    perSqFtMinor: typeof inputs.perSqFtMinor === 'number' ? inputs.perSqFtMinor : 0,
    escalationPercent: typeof settings.escalationPercent === 'number' ? settings.escalationPercent : 0,
    regionalFactor: typeof settings.regionalFactor === 'number' ? settings.regionalFactor : 1,
    basis: typeof inputs.basis === 'string' ? inputs.basis : STUDIO_ESTIMATE_BASIS,
    createdAt: revision.createdAt.toISOString(),
  });
}

/** The current studio estimate snapshot for a house (estimate + its current revision). */
export async function loadStudioEstimateSnapshot(tx: Tx, orgId: string, studioHouseId: string) {
  const [estimate] = await tx
    .select()
    .from(estimates)
    .where(and(eq(estimates.orgId, orgId), eq(estimates.studioHouseId, studioHouseId)))
    .orderBy(desc(estimates.createdAt))
    .limit(1);
  if (!estimate?.currentRevisionId) return null;
  const [revision] = await tx
    .select()
    .from(estimateRevisions)
    .where(
      and(eq(estimateRevisions.orgId, orgId), eq(estimateRevisions.id, estimate.currentRevisionId)),
    )
    .limit(1);
  return revision ? { estimate, revision } : null;
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

  app.post('/studio-houses/:id/estimate', {
    config: { permission: 'estimate:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: {
      tags: ['home builder'],
      summary:
        'Snapshot this plan’s takeoff + installed-cost estimate into a server estimate record (budgetary, never binding)',
      params: Params,
      response: { 201: StudioEstimateSnapshotSchema },
    },
  }, async (request, reply) => {
    const org = requireOrg(request);
    const snapshot = await tenantTx(request, async (tx) => {
      const house = await findHouse(tx, request.params.id);
      if (house.deletedAt) throw problem('conflict', 'This house is in the trash. Restore it before estimating.');
      const computed = computeStudioEstimate(house.spec, house.settings);
      const data = studioRevisionData(computed);
      // One estimate per studio house; each snapshot is a new immutable revision of it.
      let [estimate] = await tx
        .select()
        .from(estimates)
        .where(and(eq(estimates.orgId, org.orgId), eq(estimates.studioHouseId, house.id)))
        .orderBy(desc(estimates.createdAt))
        .limit(1);
      if (!estimate) {
        const number = await nextEstimateNumber(tx, org.orgId);
        [estimate] = await tx
          .insert(estimates)
          .values({
            orgId: org.orgId,
            number,
            productLine: 'new_construction',
            studioHouseId: house.id,
            status: data.status,
          })
          .returning();
        if (!estimate) throw problem('internal');
      }
      const [last] = await tx
        .select({ n: max(estimateRevisions.revisionNumber) })
        .from(estimateRevisions)
        .where(eq(estimateRevisions.estimateId, estimate.id));
      const [revision] = await tx
        .insert(estimateRevisions)
        .values({
          orgId: org.orgId,
          estimateId: estimate.id,
          revisionNumber: (last?.n ?? 0) + 1,
          ...data,
          createdByUserId: org.userId,
        })
        .returning();
      if (!revision) throw problem('internal');
      await tx
        .update(estimates)
        .set({ currentRevisionId: revision.id, status: data.status, updatedAt: new Date() })
        .where(eq(estimates.id, estimate.id));
      await auditRequest(request, tx, {
        orgId: org.orgId,
        action: 'studio_estimate.snapshotted',
        resourceType: 'estimate',
        resourceId: estimate.id,
        after: { studioHouseId: house.id, revisionNumber: revision.revisionNumber, totalMinor: revision.totalMinor },
      });
      return snapshotDto(estimate, revision);
    });
    reply.code(201);
    return snapshot;
  });

  app.get('/studio-houses/:id/estimate', {
    config: { permission: 'estimate:read' },
    schema: {
      tags: ['home builder'],
      summary: 'The latest estimate snapshot for this plan (404 until one is taken)',
      params: Params,
      response: { 200: StudioEstimateSnapshotSchema },
    },
  }, async (request) => {
    const org = requireOrg(request);
    const found = await tenantTx(request, async (tx) => {
      await findHouse(tx, request.params.id);
      return loadStudioEstimateSnapshot(tx, org.orgId, request.params.id);
    });
    if (!found) throw problem('not_found', 'No estimate snapshot for this house yet.');
    return snapshotDto(found.estimate, found.revision);
  });
};

export default studioHouseRoutes;
