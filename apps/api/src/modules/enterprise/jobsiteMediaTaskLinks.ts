import { createHash } from 'node:crypto';
import {
  ContractorMediaTaskLinkResult,
  ContractorMediaTaskLinks,
  JobsiteMediaTaskLinkList,
  JobsiteMediaTaskLinkResult,
  LinkJobsiteMediaTask,
} from '@fieldline/contracts';
import { and, asc, eq, exists, lte } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import {
  enterpriseMediaAssets as assets,
  enterpriseMediaTaskLinks as links,
  enterpriseMediaUploadSessions as uploads,
} from '../../db/schema/enterpriseMedia';
import { enterpriseScheduleTasks as tasks } from '../../db/schema/enterpriseSchedule';
import { assertCan, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import {
  contractorMediaPath,
  contractorTasks,
  requireContractorMediaProject,
} from '../portal/contractorMediaAccess';
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

async function findAsset(tx: Tx, scope: Scope, lock: boolean, uploaderId?: string) {
  const ownMedia = uploaderId
    ? exists(
        tx
          .select({ id: uploads.id })
          .from(uploads)
          .where(
            and(
              eq(uploads.orgId, scope.orgId),
              eq(uploads.projectId, scope.projectId),
              eq(uploads.id, scope.assetId),
              eq(uploads.uploaderUserId, uploaderId),
            ),
          ),
      )
    : undefined;
  const query = tx
    .select({ revision: assets.taskLinkRevision, scanState: assets.scanState })
    .from(assets)
    .where(and(assetScope(scope), ownMedia));
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

function registerTaskLinkRoutes(app: Parameters<FastifyPluginAsyncZod>[0], portal = false) {
  const path = (portal ? contractorMediaPath : mediaPath) + '/:assetId/task-links';
  const requireProject = portal ? requireContractorMediaProject : requireMediaProject;
  const tags = [portal ? 'portal' : 'enterprise'];
  const linkList = portal ? ContractorMediaTaskLinks : JobsiteMediaTaskLinkList;
  const linkResult = portal ? ContractorMediaTaskLinkResult : JobsiteMediaTaskLinkResult;
  const params = MediaProjectParams.extend({ assetId: z.uuid() });

  app.get(
    path,
    {
      config: { permission: 'enterprise_media:read' },
      schema: { tags, params, response: { 200: linkList } },
    },
    async (request, reply) => {
      assertCan(request, 'job:read');
      const { projectId, assetId } = request.params;
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireProject(request, tx, projectId);
        const scope = { orgId: org.orgId, projectId, assetId };
        const asset = await findAsset(tx, scope, false, portal ? org.userId : undefined);
        const own = portal ? contractorTasks(tx, org, projectId) : null;
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
          .where(
            and(
              linksScope(scope),
              lte(links.revision, asset.revision),
              own
                ? exists(tx.select({ id: own.id }).from(own).where(eq(own.id, links.taskId)))
                : undefined,
            ),
          )
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
        tags,
        params,
        body: LinkJobsiteMediaTask,
        response: { 200: linkResult, 201: linkResult },
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
        const { org } = await requireProject(request, tx, projectId, 'share');
        const scope = { orgId: org.orgId, projectId, assetId };
        const asset = await findAsset(tx, scope, true, portal ? org.userId : undefined);
        const own = portal ? contractorTasks(tx, org, projectId) : null;
        const [task] = await tx
          .select({ title: tasks.title })
          .from(tasks)
          .where(
            and(
              eq(tasks.orgId, org.orgId),
              eq(tasks.projectId, projectId),
              eq(tasks.id, taskId),
              own
                ? exists(tx.select({ id: own.id }).from(own).where(eq(own.id, taskId)))
                : undefined,
            ),
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
}

const taskLinkRoutes: FastifyPluginAsyncZod = async (app) => {
  registerTaskLinkRoutes(app);
  registerTaskLinkRoutes(app, true);
};

export default taskLinkRoutes;
