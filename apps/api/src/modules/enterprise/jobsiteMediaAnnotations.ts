import {
  JOBSITE_PHOTO_MAX_BYTES,
  JobsitePhotoAnnotationRevision,
  JobsitePhotoAnnotationView,
  SetJobsitePhotoAnnotations,
} from '@fieldline/contracts';
import { and, desc, eq, lte } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import {
  enterpriseMediaAssets as assets,
  enterpriseMediaPhotoAnnotationRevisions as revisions,
  enterpriseMediaUploadSessions as uploads,
} from '../../db/schema/enterpriseMedia';
import { tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import type { StorageAdapter } from '../../storage';
import { sha256Hex } from '../media/processing';
import { MediaProjectParams, mediaPath, requireMediaProject } from './jobsiteMediaAccess';
import { jobsitePhotoAnnotationKey, jobsitePhotoKey } from './jobsiteMediaStorage';
import { renderJobsitePhotoAnnotations } from './renderJobsitePhotoAnnotations';

type Scope = { orgId: string; projectId: string; assetId: string };
type Photo = typeof uploads.$inferSelect;
type AnnotationRevision = typeof revisions.$inferSelect;

function assetScope(scope: Scope) {
  return and(
    eq(assets.orgId, scope.orgId),
    eq(assets.projectId, scope.projectId),
    eq(assets.id, scope.assetId),
  );
}

function annotationScope(scope: Scope) {
  return and(
    eq(revisions.orgId, scope.orgId),
    eq(revisions.projectId, scope.projectId),
    eq(revisions.assetId, scope.assetId),
  );
}

async function photoAsset(tx: Tx, scope: Scope, lock: boolean) {
  const query = tx
    .select({
      id: assets.id,
      scanState: assets.scanState,
      revision: assets.annotationRevision,
    })
    .from(assets)
    .where(assetScope(scope));
  const [asset] = lock ? await query.for('update') : await query;
  if (!asset) throw problem('not_found');
  const [source] = await tx
    .select()
    .from(uploads)
    .where(
      and(
        eq(uploads.orgId, scope.orgId),
        eq(uploads.projectId, scope.projectId),
        eq(uploads.id, scope.assetId),
      ),
    );
  if (!source?.finalizedAt || source.declaredDurationMs !== null) throw problem('not_found');
  if (asset.scanState !== 'clean')
    throw problem('conflict', 'This photo is available for annotation after its scan passes.');
  return { revision: asset.revision, source };
}

async function readSource(storage: StorageAdapter, upload: Photo) {
  const bytes = await storage.get(jobsitePhotoKey(upload.orgId, upload.id));
  if (bytes.length !== upload.byteSize || sha256Hex(bytes) !== upload.sha256)
    throw problem('conflict', 'The photo original could not be verified.');
  return bytes;
}

function dto(row: AnnotationRevision) {
  return {
    id: row.id,
    assetId: row.assetId,
    revision: row.revision,
    annotations: row.annotations,
    sourceSha256: row.sourceSha256,
    sha256: row.sha256,
    byteSize: row.byteSize,
    width: row.width,
    height: row.height,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

function sendImage(reply: FastifyReply, content: Buffer) {
  return reply
    .type('image/png')
    .header('cache-control', 'private, no-store')
    .header('x-content-type-options', 'nosniff')
    .send(content);
}

const photoAnnotationRoutes: FastifyPluginAsyncZod = async (app) => {
  const path = mediaPath + '/:assetId/annotations';
  const params = MediaProjectParams.extend({ assetId: z.uuid() });

  app.get(
    path,
    {
      config: { permission: 'enterprise_media:read' },
      schema: { tags: ['enterprise'], params, response: { 200: JobsitePhotoAnnotationView } },
    },
    async (request, reply) => {
      const { projectId, assetId } = request.params;
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId);
        const scope = { orgId: org.orgId, projectId, assetId };
        const { revision } = await photoAsset(tx, scope, false);
        const history = await tx
          .select()
          .from(revisions)
          .where(and(annotationScope(scope), lte(revisions.revision, revision)))
          .orderBy(desc(revisions.revision))
          .limit(20);
        return {
          revision,
          current: history[0] ? dto(history[0]) : null,
          history: history.map(dto),
        };
      });
      setEtag(reply, result.revision);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.get(
    path + '/source',
    {
      config: {
        permission: 'enterprise_media:read',
        rateLimit: { max: 30, timeWindow: '1 minute' },
      },
      schema: { tags: ['enterprise'], params },
    },
    async (request, reply) => {
      const { projectId, assetId } = request.params;
      const bytes = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, 'share');
        const { source } = await photoAsset(tx, { orgId: org.orgId, projectId, assetId }, false);
        return readSource(app.storage, source);
      });
      const preview = await renderJobsitePhotoAnnotations(bytes, []);
      return sendImage(reply, preview.content);
    },
  );

  app.post(
    path,
    {
      config: {
        permission: 'enterprise_media:annotate',
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['enterprise'],
        params,
        body: SetJobsitePhotoAnnotations,
        response: { 200: JobsitePhotoAnnotationRevision, 201: JobsitePhotoAnnotationRevision },
      },
    },
    async (request, reply) => {
      const { projectId, assetId } = request.params;
      const expected = parseIfMatch(request);
      const { annotations, baseDerivativeVersion, clientRequestId } = request.body;
      assertRevision(baseDerivativeVersion, expected);
      const requestHash = sha256Hex(Buffer.from(JSON.stringify({ expected, annotations })));
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, 'share');
        const scope = { orgId: org.orgId, projectId, assetId };
        const current = await photoAsset(tx, scope, true);
        const [receipt] = await tx
          .select()
          .from(revisions)
          .where(and(annotationScope(scope), eq(revisions.clientRequestId, clientRequestId)));
        if (receipt) {
          if (receipt.createdByUserId !== org.userId || receipt.requestHash !== requestHash)
            throw problem('conflict', 'This request already saved a different photo annotation.');
          return { created: false, version: dto(receipt) };
        }
        assertRevision(current.revision, expected);
        const original = await readSource(app.storage, current.source);
        const { content, width, height } = await renderJobsitePhotoAnnotations(
          original,
          annotations,
        );
        if (content.length > JOBSITE_PHOTO_MAX_BYTES)
          throw problem('payload_too_large', 'The annotated photo exceeds the output size limit.');
        const revision = current.revision + 1;
        const sha256 = sha256Hex(content);
        await app.storage.put(
          jobsitePhotoAnnotationKey(org.orgId, assetId, revision, sha256),
          content,
          'image/png',
        );
        const [created] = await tx
          .insert(revisions)
          .values({
            ...scope,
            revision,
            annotations,
            sourceSha256: current.source.sha256,
            sha256,
            byteSize: content.length,
            width,
            height,
            requestHash,
            clientRequestId,
            createdByUserId: org.userId,
          })
          .returning();
        if (!created) throw problem('internal');
        await tx.update(assets).set({ annotationRevision: revision }).where(assetScope(scope));
        await auditRequest(request, tx, {
          orgId: org.orgId,
          resourceId: assetId,
          resourceType: 'enterprise_media_asset',
          action: 'media.photo_annotated',
          before: { revision: current.revision },
          after: { revision, annotationCount: annotations.length, derivativeId: created.id },
        });
        return { created: true, version: dto(created) };
      });
      setEtag(reply, result.version.revision);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.version);
    },
  );

  app.get(
    path + '/:revision/image',
    {
      config: {
        permission: 'enterprise_media:read',
        rateLimit: { max: 60, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['enterprise'],
        params: params.extend({ revision: z.coerce.number().int().positive() }),
      },
    },
    async (request, reply) => {
      const { projectId, assetId, revision } = request.params;
      const bytes = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, 'share');
        const scope = { orgId: org.orgId, projectId, assetId };
        const { source } = await photoAsset(tx, scope, false);
        const [row] = await tx
          .select()
          .from(revisions)
          .where(and(annotationScope(scope), eq(revisions.revision, revision)));
        if (!row) throw problem('not_found');
        if (row.sourceSha256 !== source.sha256)
          throw problem('conflict', 'The annotation source could not be verified.');
        const bytes = await app.storage.get(
          jobsitePhotoAnnotationKey(org.orgId, assetId, revision, row.sha256),
        );
        if (bytes.length !== row.byteSize || sha256Hex(bytes) !== row.sha256)
          throw problem('conflict', 'The annotated photo could not be verified.');
        return bytes;
      });
      return sendImage(reply, bytes);
    },
  );
};

export default photoAnnotationRoutes;
