import { createHash } from 'node:crypto';
import {
  JobsiteMediaCaption,
  SetJobsiteMediaCaption,
  type JobsiteCaptionView,
} from '@fieldline/contracts';
import { and, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import {
  enterpriseMediaAssets as assets,
  enterpriseMediaCaptionRevisions as captions,
  enterpriseMediaUploadSessions as uploads,
} from '../../db/schema/enterpriseMedia';
import { tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { MediaProjectParams, mediaPath, requireMediaProject } from './jobsiteMediaAccess';

type Scope = { orgId: string; projectId: string; assetId: string };
type Caption = typeof captions.$inferSelect;

export function captionDto(row: Caption | null | undefined): JobsiteCaptionView {
  if (!row) return { revision: 0, caption: '', tags: [], createdByUserId: null, createdAt: null };
  return {
    revision: row.revision,
    caption: row.caption,
    tags: row.tags,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

function assetScope(scope: Scope) {
  return and(
    eq(assets.orgId, scope.orgId),
    eq(assets.projectId, scope.projectId),
    eq(assets.id, scope.assetId),
  );
}

function captionScope(scope: Scope) {
  return and(
    eq(captions.orgId, scope.orgId),
    eq(captions.projectId, scope.projectId),
    eq(captions.assetId, scope.assetId),
  );
}

async function findCaptionAsset(tx: Tx, scope: Scope, lock: boolean) {
  const query = tx
    .select({
      revision: assets.captionRevision,
      scanState: assets.scanState,
    })
    .from(assets)
    .where(assetScope(scope));
  const [asset] = lock ? await query.for('update') : await query;
  if (!asset) throw problem('not_found');
  const [source] = await tx
    .select({ uploaderUserId: uploads.uploaderUserId })
    .from(uploads)
    .where(
      and(
        eq(uploads.orgId, scope.orgId),
        eq(uploads.projectId, scope.projectId),
        eq(uploads.id, scope.assetId),
      ),
    );
  if (!source) throw problem('not_found');
  return { ...asset, ...source };
}

async function getCaption(tx: Tx, scope: Scope, revision: number) {
  if (revision === 0) return captionDto(null);
  const [record] = await tx
    .select()
    .from(captions)
    .where(and(captionScope(scope), eq(captions.revision, revision)));
  if (!record) throw problem('internal');
  return captionDto(record);
}

const captionRoutes: FastifyPluginAsyncZod = async (app) => {
  const path = mediaPath + '/:assetId/caption';
  const params = MediaProjectParams.extend({ assetId: z.uuid() });

  app.get(
    path,
    {
      config: { permission: 'enterprise_media:read' },
      schema: { tags: ['enterprise'], params, response: { 200: JobsiteMediaCaption } },
    },
    async (request, reply) => {
      const { projectId, assetId } = request.params;
      const caption = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId);
        const scope = { orgId: org.orgId, projectId, assetId };
        const asset = await findCaptionAsset(tx, scope, false);
        return getCaption(tx, scope, asset.revision);
      });
      setEtag(reply, caption.revision);
      return reply.header('cache-control', 'private, no-store').send(caption);
    },
  );

  app.put(
    path,
    {
      config: {
        permission: 'enterprise_media:upload',
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['enterprise'],
        params,
        body: SetJobsiteMediaCaption,
        response: { 200: JobsiteMediaCaption },
      },
    },
    async (request, reply) => {
      const { projectId, assetId } = request.params;
      const expected = parseIfMatch(request);
      const { caption, tags, clientRequestId } = request.body;
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ caption, tags, expected }))
        .digest('hex');
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, 'share');
        const scope = { orgId: org.orgId, projectId, assetId };
        const asset = await findCaptionAsset(tx, scope, true);
        if (asset.uploaderUserId !== org.userId)
          throw problem('forbidden', 'A caption can be edited by its uploader.');
        const [receipt] = await tx
          .select()
          .from(captions)
          .where(and(captionScope(scope), eq(captions.clientRequestId, clientRequestId)));
        if (receipt) {
          if (receipt.requestHash !== requestHash)
            throw problem('conflict', 'This request already saved a different caption.');
          return captionDto(receipt);
        }
        if (asset.scanState === 'infected' || asset.scanState === 'unsupported')
          throw problem('conflict', 'This file is unavailable for caption edits.');
        assertRevision(asset.revision, expected);
        const revision = asset.revision + 1;
        const [saved] = await tx
          .insert(captions)
          .values({
            ...scope,
            caption,
            tags,
            revision,
            clientRequestId,
            requestHash,
            createdByUserId: org.userId,
          })
          .returning();
        if (!saved) throw problem('internal');
        await tx
          .update(assets)
          .set({
            captionRevision: revision,
            captionSearch: [caption, ...tags].join(' '),
          })
          .where(assetScope(scope));
        await auditRequest(request, tx, {
          orgId: org.orgId,
          resourceType: 'enterprise_media_asset',
          resourceId: assetId,
          action: 'media.caption_changed',
          before: { revision: asset.revision },
          after: { revision, tagCount: tags.length, captionLength: caption.length },
        });
        return captionDto(saved);
      });
      setEtag(reply, result.revision);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );
};

export default captionRoutes;
