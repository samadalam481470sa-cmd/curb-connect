import { createHash } from 'node:crypto';
import {
  JobsiteMediaTaskLinkList,
  JobsiteMediaTaskLinkResult,
  LinkJobsiteMediaTask,
} from '@fieldline/contracts';
import { and, asc, eq, lte } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import {
  enterpriseMediaAssets as assets,
  enterpriseMediaTaskLinks as links,
} from '../../db/schema/enterpriseMedia';
import { enterpriseScheduleTasks as tasks } from '../../db/schema/enterpriseSchedule';
import { assertCan, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { MediaProjectParams, mediaPath, requireMediaProject } from './jobsiteMediaAccess';

type Scope = { orgId: string; projectId: string; assetId: string };
type Link = typeof links.$inferSelect;

function assetScope(scope: Scope) {
  return and(
    eq(assets.orgId, scope.orgId),
    eq(assets.projectId, scope.projectId),
    eq(assets.id, scope.assetId),
  );
}

function linksScope(scope: Scope) {
  return and(
    eq(links.orgId, scope.orgId),
    eq(links.projectId, scope.projectId),
    eq(links.assetId, scope.assetId),
  );
}

async function findAsset(tx: Tx, scope: Scope, lock: boolean) {
  const query = tx
    .select({ revision: assets.taskLinkRevision, scanState: assets.scanState })
    .from(assets)
    .where(assetScope(scope));
  const [asset] = lock ? await query.for('update') : await query;
  if (!asset) throw problem('not_found');
  return asset;
}

function dto(link: Link, taskTitle: string) {
  return {
    id: link.id,
    assetId: link.assetId,
    taskId: link.taskId,
    taskTitle,
    evidenceType: link.evidenceType,
    revision: link.revision,
    createdByUserId: link.createdByUserId,
    createdAt: link.createdAt.toISOString(),
  };
}

const taskLinkRoutes: FastifyPluginAsyncZod = async (app) => {
  const path = mediaPath + '/:assetId/task-links';
  const params = MediaProjectParams.extend({ assetId: z.uuid() });

  app.get(
    path,
    {
      config: { permission: 'enterprise_media:read' },
      schema: { tags: ['enterprise'], params, response: { 200: JobsiteMediaTaskLinkList } },
    },
    async (request, reply) => {
      assertCan(request, 'job:read');
      const { projectId, assetId } = request.params;
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId);
        const scope = { orgId: org.orgId, projectId, assetId };
        const asset = await findAsset(tx, scope, false);
        const rows = await tx
          .select({ link: links, title: tasks.title })
          .from(links)
          .innerJoin(
            tasks,
            and(
              eq(tasks.orgId, links.orgId),
              eq(tasks.projectId, links.projectId),
              eq(tasks.id, links.taskId),
            ),
          )
          .where(and(linksScope(scope), lte(links.revision, asset.revision)))
          .orderBy(asc(links.revision));
        return { revision: asset.revision, items: rows.map(({ link, title }) => dto(link, title)) };
      });
      setEtag(reply, result.revision);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.post(
    path,
    {
      config: {
        permission: 'enterprise_media:upload',
        rateLimit: { max: 45, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['enterprise'],
        params,
        body: LinkJobsiteMediaTask,
        response: { 200: JobsiteMediaTaskLinkResult, 201: JobsiteMediaTaskLinkResult },
      },
    },
    async (request, reply) => {
      assertCan(request, 'job:read');
      const { projectId, assetId } = request.params;
      const expected = parseIfMatch(request);
      const { taskId, evidenceType, clientRequestId } = request.body;
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ taskId, evidenceType, expected }))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, 'share');
        const scope = { orgId: org.orgId, projectId, assetId };
        const asset = await findAsset(tx, scope, true);
        const [task] = await tx
          .select({ title: tasks.title })
          .from(tasks)
          .where(
            and(eq(tasks.orgId, org.orgId), eq(tasks.projectId, projectId), eq(tasks.id, taskId)),
          );
        if (!task) throw problem('not_found');
        const [receipt] = await tx
          .select()
          .from(links)
          .where(and(linksScope(scope), eq(links.clientRequestId, clientRequestId)));
        if (receipt) {
          if (receipt.createdByUserId !== org.userId || receipt.requestHash !== requestHash)
            throw problem(
              'conflict',
              'This request already linked different media or task details.',
            );
          return { created: false, revision: asset.revision, link: dto(receipt, task.title) };
        }
        const [existing] = await tx
          .select()
          .from(links)
          .where(
            and(linksScope(scope), eq(links.taskId, taskId), eq(links.evidenceType, evidenceType)),
          );
        if (existing)
          return { created: false, revision: asset.revision, link: dto(existing, task.title) };
        if (asset.scanState === 'infected' || asset.scanState === 'unsupported')
          throw problem('conflict', 'This file is unavailable for task evidence.');
        assertRevision(asset.revision, expected);
        const revision = asset.revision + 1;
        const [link] = await tx
          .insert(links)
          .values({
            ...scope,
            taskId,
            evidenceType,
            revision,
            clientRequestId,
            requestHash,
            createdByUserId: org.userId,
          })
          .returning();
        if (!link) throw problem('internal');
        await tx.update(assets).set({ taskLinkRevision: revision }).where(assetScope(scope));
        await auditRequest(request, tx, {
          orgId: org.orgId,
          resourceType: 'enterprise_media_asset',
          resourceId: assetId,
          action: 'media.task_linked',
          after: { projectId, taskId, evidenceType, revision, linkId: link.id },
        });
        return { created: true, revision, link: dto(link, task.title) };
      });
      setEtag(reply, result.revision);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send({ revision: result.revision, link: result.link });
    },
  );
};

export default taskLinkRoutes;
