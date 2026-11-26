import {
  ApproveJobsiteCustomerPhotoPreview,
  CreateJobsiteCustomerPhotoPreview,
  JOBSITE_PHOTO_MAX_BYTES,
  JobsiteCustomerPhotoApproval,
  JobsiteCustomerPhotoPreview,
  JobsiteCustomerPhotoView,
} from '@fieldline/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import { enterpriseMediaPhotoAnnotationRevisions as annotations } from '../../db/schema/enterpriseMedia';
import {
  enterpriseMediaCustomerPhotoApprovals as approvals,
  enterpriseMediaCustomerPhotoPreviews as previews,
} from '../../db/schema/enterpriseMediaCustomerPhoto';
import { tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { auditRequest } from '../../services/audit';
import { sha256Hex } from '../media/processing';
import { MediaProjectParams, mediaPath, requireMediaProject } from './jobsiteMediaAccess';
import { jobsiteCustomerPhotoPreviewKey } from './jobsiteMediaStorage';
import {
  readJobsitePhotoAsset,
  readVerifiedJobsitePhotoOriginal,
  type JobsitePhotoScope,
} from './jobsitePhotoSource';
import { renderJobsitePhotoAnnotations } from './renderJobsitePhotoAnnotations';

const permission = 'enterprise_media:approve_customer_media';
type Preview = typeof previews.$inferSelect;
type Approval = typeof approvals.$inferSelect;

function previewScope(scope: JobsitePhotoScope) {
  return and(
    eq(previews.orgId, scope.orgId),
    eq(previews.projectId, scope.projectId),
    eq(previews.assetId, scope.assetId),
  );
}

function approvalScope(scope: JobsitePhotoScope) {
  return and(
    eq(approvals.orgId, scope.orgId),
    eq(approvals.projectId, scope.projectId),
    eq(approvals.assetId, scope.assetId),
  );
}

async function latestPreview(tx: Tx, scope: JobsitePhotoScope) {
  const [row] = await tx
    .select()
    .from(previews)
    .where(previewScope(scope))
    .orderBy(desc(previews.revision))
    .limit(1);
  return row;
}

async function approvalFor(tx: Tx, scope: JobsitePhotoScope, previewId: string) {
  const [row] = await tx
    .select()
    .from(approvals)
    .where(and(approvalScope(scope), eq(approvals.previewId, previewId)));
  return row;
}

function previewDto(row: Preview): z.infer<typeof JobsiteCustomerPhotoPreview> {
  return {
    id: row.id,
    assetId: row.assetId,
    revision: row.revision,
    sourceAnnotationRevision: row.sourceAnnotationRevision,
    sourceSha256: row.sourceSha256,
    sha256: row.sha256,
    width: row.width,
    height: row.height,
    byteSize: row.byteSize,
    redactionCount: row.redactionCount,
    createdAt: row.createdAt.toISOString(),
  };
}

function approvalDto(row: Approval): z.infer<typeof JobsiteCustomerPhotoApproval> {
  return {
    id: row.id,
    previewId: row.previewId,
    reason: row.reason,
    approvedByUserId: row.createdByUserId,
    approvedAt: row.createdAt.toISOString(),
  };
}

const customerPhotoPreview: FastifyPluginAsyncZod = async (app) => {
  const path = mediaPath + '/:assetId/customer-preview';
  const params = MediaProjectParams.extend({ assetId: z.uuid() });
  const versionParams = params.extend({ previewId: z.uuid() });

  async function verifiedPreview(row: Preview) {
    const bytes = await app.storage.get(
      jobsiteCustomerPhotoPreviewKey(row.orgId, row.assetId, row.revision, row.sha256),
    );
    if (bytes.length !== row.byteSize || sha256Hex(bytes) !== row.sha256)
      throw problem('conflict', 'The customer preview file could not be verified.');
    return bytes;
  }

  app.get(
    path,
    {
      config: { permission },
      schema: { tags: ['enterprise'], params, response: { 200: JobsiteCustomerPhotoView } },
    },
    async (request, reply) => {
      const { projectId, assetId } = request.params;
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, 'share');
        const scope = { orgId: org.orgId, projectId, assetId };
        const photo = await readJobsitePhotoAsset(tx, scope, false);
        const preview = await latestPreview(tx, scope);
        const approval = preview ? await approvalFor(tx, scope, preview.id) : undefined;
        return {
          revision: preview?.revision ?? 0,
          annotationRevision: photo.revision,
          preview: preview ? previewDto(preview) : null,
          approval: approval ? approvalDto(approval) : null,
          current:
            !!preview &&
            preview.sourceAnnotationRevision === photo.revision &&
            preview.sourceSha256 === photo.source.sha256,
        };
      });
      setEtag(reply, result.revision);
      return reply.header('cache-control', 'private, no-store').send(result);
    },
  );

  app.post(
    path,
    {
      config: { permission, rateLimit: { max: 18, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params,
        body: CreateJobsiteCustomerPhotoPreview,
        response: { 200: JobsiteCustomerPhotoPreview, 201: JobsiteCustomerPhotoPreview },
      },
    },
    async (request, reply) => {
      const { projectId, assetId } = request.params;
      const { baseAnnotationRevision, clientRequestId } = request.body;
      const expected = parseIfMatch(request);
      const requestHash = sha256Hex(
        Buffer.from(JSON.stringify({ expected, baseAnnotationRevision })),
      );
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, 'share');
        const scope = { orgId: org.orgId, projectId, assetId };
        const photo = await readJobsitePhotoAsset(tx, scope, true);
        const [receipt] = await tx
          .select()
          .from(previews)
          .where(and(previewScope(scope), eq(previews.clientRequestId, clientRequestId)));
        if (receipt) {
          if (receipt.createdByUserId !== org.userId || receipt.requestHash !== requestHash)
            throw problem('conflict', 'This request already prepared a different preview.');
          return { created: false, preview: previewDto(receipt) };
        }
        const previous = await latestPreview(tx, scope);
        assertRevision(previous?.revision ?? 0, expected);
        assertRevision(photo.revision, baseAnnotationRevision);
        if (
          previous?.sourceAnnotationRevision === photo.revision &&
          previous.sourceSha256 === photo.source.sha256
        )
          return { created: false, preview: previewDto(previous) };
        const [annotation] = photo.revision
          ? await tx
              .select()
              .from(annotations)
              .where(
                and(
                  eq(annotations.orgId, org.orgId),
                  eq(annotations.projectId, projectId),
                  eq(annotations.assetId, assetId),
                  eq(annotations.revision, photo.revision),
                ),
              )
          : [];
        if (photo.revision && (!annotation || annotation.sourceSha256 !== photo.source.sha256))
          throw problem('conflict', 'The current photo redactions could not be verified.');
        const redactions = (annotation?.annotations ?? []).filter(
          ({ kind }) => kind === 'redaction',
        );
        const original = await readVerifiedJobsitePhotoOriginal(app.storage, photo.source);
        const { content, width, height } = await renderJobsitePhotoAnnotations(
          original,
          redactions,
        );
        if (content.length > JOBSITE_PHOTO_MAX_BYTES)
          throw problem('payload_too_large', 'The customer preview exceeds the output size limit.');
        const revision = expected + 1;
        const sha256 = sha256Hex(content);
        await app.storage.put(
          jobsiteCustomerPhotoPreviewKey(org.orgId, assetId, revision, sha256),
          content,
          'image/png',
        );
        const [saved] = await tx
          .insert(previews)
          .values({
            ...scope,
            revision,
            sourceAnnotationRevision: photo.revision,
            sourceSha256: photo.source.sha256,
            sha256,
            width,
            height,
            byteSize: content.length,
            redactionCount: redactions.length,
            requestHash,
            clientRequestId,
            createdByUserId: org.userId,
          })
          .returning();
        if (!saved) throw problem('internal');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          resourceType: 'enterprise_media_asset',
          resourceId: assetId,
          action: 'media.customer_photo_previewed',
          after: {
            previewId: saved.id,
            revision,
            sourceAnnotationRevision: photo.revision,
            redactionCount: redactions.length,
          },
        });
        return { created: true, preview: previewDto(saved) };
      });
      setEtag(reply, result.preview.revision);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.preview);
    },
  );

  app.post(
    path + '/:previewId/approve',
    {
      config: { permission, rateLimit: { max: 24, timeWindow: '1 minute' } },
      schema: {
        tags: ['enterprise'],
        params: versionParams,
        body: ApproveJobsiteCustomerPhotoPreview,
        response: { 200: JobsiteCustomerPhotoApproval, 201: JobsiteCustomerPhotoApproval },
      },
    },
    async (request, reply) => {
      const { projectId, assetId, previewId } = request.params;
      const expected = parseIfMatch(request);
      const { reason, clientRequestId } = request.body;
      const requestHash = sha256Hex(Buffer.from(JSON.stringify({ expected, previewId, reason })));
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, 'share');
        const scope = { orgId: org.orgId, projectId, assetId };
        const photo = await readJobsitePhotoAsset(tx, scope, true);
        const [receipt] = await tx
          .select()
          .from(approvals)
          .where(and(approvalScope(scope), eq(approvals.clientRequestId, clientRequestId)));
        if (receipt) {
          if (receipt.createdByUserId !== org.userId || receipt.requestHash !== requestHash)
            throw problem(
              'conflict',
              'This request already approved a different customer preview.',
            );
          return { created: false, approval: approvalDto(receipt) };
        }
        const latest = await latestPreview(tx, scope);
        if (!latest) throw problem('not_found');
        assertRevision(latest.revision, expected);
        if (latest.id !== previewId)
          throw problem('conflict', 'Open the latest preview before approving it.');
        assertRevision(photo.revision, latest.sourceAnnotationRevision);
        if (photo.source.sha256 !== latest.sourceSha256)
          throw problem('conflict', 'The preview source could not be verified.');
        const existing = await approvalFor(tx, scope, previewId);
        if (existing) return { created: false, approval: approvalDto(existing) };
        await verifiedPreview(latest);
        const [saved] = await tx
          .insert(approvals)
          .values({
            ...scope,
            previewId,
            reason,
            requestHash,
            clientRequestId,
            createdByUserId: org.userId,
          })
          .returning();
        if (!saved) throw problem('internal');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          resourceType: 'enterprise_media_asset',
          resourceId: assetId,
          action: 'media.customer_photo_approved',
          reason,
          after: { previewId, approvalId: saved.id, approvedSha256: latest.sha256 },
        });
        return { created: true, approval: approvalDto(saved) };
      });
      setEtag(reply, expected);
      return reply
        .header('cache-control', 'private, no-store')
        .code(result.created ? 201 : 200)
        .send(result.approval);
    },
  );

  app.get(
    path + '/:previewId/image',
    {
      config: { permission, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: { tags: ['enterprise'], params: versionParams },
    },
    async (request, reply) => {
      const { projectId, assetId, previewId } = request.params;
      const content = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, 'share');
        const scope = { orgId: org.orgId, projectId, assetId };
        await readJobsitePhotoAsset(tx, scope, false);
        const [preview] = await tx
          .select()
          .from(previews)
          .where(and(previewScope(scope), eq(previews.id, previewId)));
        if (!preview) throw problem('not_found');
        return verifiedPreview(preview);
      });
      return reply
        .type('image/png')
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(content);
    },
  );
};

export default customerPhotoPreview;
