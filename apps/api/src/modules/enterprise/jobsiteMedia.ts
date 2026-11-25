import {
  FinalizeJobsitePhotoUpload,
  JOBSITE_PHOTO_CHUNK_BYTES,
  JOBSITE_PHOTO_MAX_BYTES,
  JOBSITE_VIDEO_MAX_DURATION_MS,
  JobsiteMediaAsset,
  JobsiteMediaPage,
  JobsitePhotoUploadProgress,
  PutJobsitePhotoUploadPart,
  StartJobsiteMediaUpload,
} from '@fieldline/contracts';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import {
  enterpriseMediaAssets as assets,
  enterpriseMediaUploadParts as parts,
  enterpriseMediaUploadSessions as uploads,
  enterpriseMediaVideoDerivatives as derivatives,
} from '../../db/schema/enterpriseMedia';
import { tenantTx } from '../../http/context';
import { beforeCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { assertRevision, parseIfMatch, setEtag } from '../../http/revision';
import { enqueue } from '../../jobs/outbox';
import { auditRequest } from '../../services/audit';
import { safeFileName, type StorageAdapter } from '../../storage';
import { sha256Hex } from '../media/processing';
import mediaGrantRoutes, {
  MediaProjectParams,
  mediaPath,
  requireMediaProject,
} from './jobsiteMediaAccess';
import { jobsitePhotoKey, jobsiteVideoPlaybackKey } from './jobsiteMediaStorage';

type Upload = typeof uploads.$inferSelect;
type Part = typeof parts.$inferSelect;
type Asset = typeof assets.$inferSelect;
type Playback = typeof derivatives.$inferSelect;

const sessionsPath = mediaPath + '/upload-sessions';
const sessionPath = sessionsPath + '/:sessionId';
const SessionParams = MediaProjectParams.extend({ sessionId: z.uuid() });
const assetPath = mediaPath + '/:assetId';
const AssetParams = MediaProjectParams.extend({ assetId: z.uuid() });
const chunkBytes = JOBSITE_PHOTO_CHUNK_BYTES;

function projectScope(orgId: string, projectId: string) {
  return {
    uploads: and(eq(uploads.orgId, orgId), eq(uploads.projectId, projectId)),
    parts: and(eq(parts.orgId, orgId), eq(parts.projectId, projectId)),
    assets: and(eq(assets.orgId, orgId), eq(assets.projectId, projectId)),
  };
}

const assetJoin = and(
  eq(assets.orgId, uploads.orgId),
  eq(assets.projectId, uploads.projectId),
  eq(assets.id, uploads.id),
);
const playbackJoin = and(
  eq(derivatives.orgId, assets.orgId),
  eq(derivatives.projectId, assets.projectId),
  eq(derivatives.assetId, assets.id),
  eq(derivatives.version, 1),
);

async function findUpload(
  tx: Tx,
  { orgId, userId }: { orgId: string; userId: string },
  projectId: string,
  id: string,
  lock: 'share' | 'update',
) {
  const query = tx
    .select()
    .from(uploads)
    .where(
      and(
        projectScope(orgId, projectId).uploads,
        eq(uploads.id, id),
        eq(uploads.uploaderUserId, userId),
      ),
    );
  const [row] = await query.for(lock);
  if (!row) throw problem('not_found');
  return row;
}

async function listParts(tx: Tx, upload: Upload) {
  return tx
    .select()
    .from(parts)
    .where(and(projectScope(upload.orgId, upload.projectId).parts, eq(parts.sessionId, upload.id)))
    .orderBy(asc(parts.partNumber));
}

async function progress(tx: Tx, upload: Upload) {
  return {
    id: upload.id,
    projectId: upload.projectId,
    localCaptureId: upload.localCaptureId,
    revision: upload.revision,
    partBytes: chunkBytes,
    totalParts: Math.ceil(upload.byteSize / chunkBytes),
    receivedParts: (await listParts(tx, upload)).map((part) => part.partNumber),
    finalizedAt: upload.finalizedAt?.toISOString() ?? null,
  };
}

function assetDto({
  asset,
  upload,
  playback,
}: {
  asset: Asset;
  upload: Upload;
  playback?: Playback | null;
}) {
  return {
    id: asset.id,
    projectId: asset.projectId,
    filename: upload.filename,
    mimeType: upload.mimeType,
    byteSize: upload.byteSize,
    sha256: upload.sha256,
    capturedAt: upload.capturedAt.toISOString(),
    createdAt: asset.createdAt.toISOString(),
    scannedAt: asset.scannedAt?.toISOString() ?? null,
    scanState: asset.scanState,
    uploaderUserId: upload.uploaderUserId,
    revision: asset.revision,
    declaredDurationMs: upload.declaredDurationMs,
    videoState: asset.videoState,
    playback: playback
      ? {
          version: playback.version,
          sha256: playback.sha256,
          byteSize: playback.byteSize,
          durationMs: playback.durationMs,
          width: playback.width,
          height: playback.height,
        }
      : null,
  };
}

async function findAsset(tx: Tx, orgId: string, projectId: string, id: string) {
  const [row] = await tx
    .select({ asset: assets, upload: uploads, playback: derivatives })
    .from(assets)
    .innerJoin(uploads, assetJoin)
    .leftJoin(derivatives, playbackJoin)
    .where(and(projectScope(orgId, projectId).assets, eq(assets.id, id)));
  if (!row) throw problem('not_found');
  return row;
}

function partSize(total: number, index: number) {
  return Math.min(chunkBytes, total - index * chunkBytes);
}

function playbackRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return null;
  const [, first = '', last = ''] = match;
  if (!first && !last) return null;
  const start = first ? Number(first) : Math.max(0, size - Number(last));
  const end = first && last ? Math.min(size - 1, Number(last)) : size - 1;
  return Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    start < size &&
    end >= start
    ? { start, end }
    : null;
}

async function assembleOriginal(storage: StorageAdapter, upload: Upload, received: Part[]) {
  const count = Math.ceil(upload.byteSize / chunkBytes);
  if (
    received.length !== count ||
    received.some(
      (part, index) =>
        part.partNumber !== index || part.byteSize !== partSize(upload.byteSize, index),
    )
  ) {
    throw problem('conflict', 'Send every part before finalizing the upload.');
  }
  const original = Buffer.alloc(upload.byteSize);
  for (const part of received) {
    const bytes = await storage.get(jobsitePhotoKey(upload.orgId, upload.id, part.partNumber));
    if (bytes.length !== part.byteSize || sha256Hex(bytes) !== part.sha256)
      throw problem('conflict', 'An uploaded part could not be verified.');
    bytes.copy(original, part.partNumber * chunkBytes);
  }
  if (sha256Hex(original) !== upload.sha256)
    throw problem(
      'validation_failed',
      'The assembled original does not match its capture checksum.',
    );
  return original;
}

const jobsiteMedia: FastifyPluginAsyncZod = async (app) => {
  await app.register(mediaGrantRoutes);
  const maxBytes = Math.min(JOBSITE_PHOTO_MAX_BYTES, app.config.storage.maxUploadBytes);
  const maxVideoDurationMs = app.config.vision.serviceToken ? JOBSITE_VIDEO_MAX_DURATION_MS : null;

  app.get(
    mediaPath,
    {
      config: { permission: 'enterprise_media:read' },
      schema: {
        tags: ['enterprise'],
        params: MediaProjectParams,
        querystring: z.object({
          cursor: z.string().max(256).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(25),
        }),
        response: { 200: JobsiteMediaPage },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const cursor = decodeCursor(request.query.cursor);
      const { limit } = request.query;
      reply.header('cache-control', 'private, no-store');
      return tenantTx(request, async (tx) => {
        const { org, project } = await requireMediaProject(request, tx, projectId);
        const records = await tx
          .select({ asset: assets, upload: uploads, playback: derivatives })
          .from(assets)
          .innerJoin(uploads, assetJoin)
          .leftJoin(derivatives, playbackJoin)
          .where(
            and(
              projectScope(org.orgId, project.id).assets,
              beforeCursor(assets.createdAt, assets.id, cursor),
            ),
          )
          .orderBy(desc(msTrunc(assets.createdAt)), desc(assets.id))
          .limit(limit + 1);
        return {
          ...pageResult(
            records,
            limit,
            ({ asset }) => ({ at: asset.createdAt, id: asset.id }),
            assetDto,
          ),
          projectName: project.name,
          canUpload: org.permissions.has('enterprise_media:upload'),
          canManageGrants: org.permissions.has('enterprise_media:manage_grants'),
          maxBytes,
          maxVideoDurationMs,
        };
      });
    },
  );

  app.post(
    sessionsPath,
    {
      config: {
        permission: 'enterprise_media:upload',
        rateLimit: { max: 45, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['enterprise'],
        params: MediaProjectParams,
        body: StartJobsiteMediaUpload,
        response: { 200: JobsitePhotoUploadProgress, 201: JobsitePhotoUploadProgress },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const { byteSize, localCaptureId, sha256, mimeType } = request.body;
      const declaredDurationMs = 'durationMs' in request.body ? request.body.durationMs : null;
      const filename = safeFileName(request.body.filename);
      const capturedAt = new Date(request.body.capturedAt);
      const manifestHash = sha256Hex(
        Buffer.from(
          JSON.stringify({
            filename,
            byteSize,
            localCaptureId,
            sha256,
            mimeType,
            capturedAt: capturedAt.toISOString(),
            ...(declaredDurationMs !== null && { durationMs: declaredDurationMs }),
          }),
        ),
      );
      assertRevision(0, parseIfMatch(request));
      if (byteSize > maxBytes)
        throw problem('payload_too_large', 'This file exceeds the company storage limit.');
      const result = await tenantTx(request, async (tx) => {
        const { org, project } = await requireMediaProject(request, tx, projectId, 'share');
        if (declaredDurationMs !== null && maxVideoDurationMs === null)
          throw problem('feature_unavailable', 'Private video processing is unavailable.');
        const [created] = await tx
          .insert(uploads)
          .values({
            orgId: org.orgId,
            projectId: project.id,
            uploaderUserId: org.userId,
            filename,
            mimeType,
            byteSize,
            sha256,
            localCaptureId,
            manifestHash,
            capturedAt,
            declaredDurationMs,
          })
          .onConflictDoNothing({
            target: [uploads.orgId, uploads.uploaderUserId, uploads.localCaptureId],
          })
          .returning();
        if (created) {
          await auditRequest(request, tx, {
            orgId: org.orgId,
            resourceType: 'enterprise_media_upload_session',
            resourceId: created.id,
            action: 'media.capture_registered',
            after: { projectId: project.id, localCaptureId, capturedAt, mimeType, byteSize },
          });
          return { created: true, progress: await progress(tx, created) };
        }
        const [existing] = await tx
          .select()
          .from(uploads)
          .where(
            and(
              eq(uploads.orgId, org.orgId),
              eq(uploads.uploaderUserId, org.userId),
              eq(uploads.localCaptureId, localCaptureId),
            ),
          )
          .for('share');
        if (
          !existing ||
          existing.projectId !== project.id ||
          existing.manifestHash !== manifestHash
        )
          throw problem('conflict', 'This capture already has a different upload manifest.');
        return { created: false, progress: await progress(tx, existing) };
      });
      setEtag(reply, result.progress.revision);
      return reply.code(result.created ? 201 : 200).send(result.progress);
    },
  );

  app.get(
    sessionPath,
    {
      config: { permission: 'enterprise_media:upload' },
      schema: {
        tags: ['enterprise'],
        params: SessionParams,
        response: { 200: JobsitePhotoUploadProgress },
      },
    },
    async (request, reply) => {
      const { projectId, sessionId } = request.params;
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId);
        return progress(tx, await findUpload(tx, org, projectId, sessionId, 'share'));
      });
      setEtag(reply, result.revision);
      return result;
    },
  );

  app.put(
    sessionPath + '/parts/:partNumber',
    {
      bodyLimit: 4 * Math.ceil(chunkBytes / 3) + 4096,
      config: {
        permission: 'enterprise_media:upload',
        rateLimit: { max: 120, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['enterprise'],
        params: SessionParams.extend({ partNumber: z.coerce.number().int().min(0).max(24) }),
        body: PutJobsitePhotoUploadPart,
        response: { 200: JobsitePhotoUploadProgress },
      },
    },
    async (request, reply) => {
      const { projectId, sessionId, partNumber } = request.params;
      const revision = parseIfMatch(request);
      const bytes = Buffer.from(request.body.contentBase64, 'base64');
      const sha256 = sha256Hex(bytes);
      if (sha256 !== request.body.sha256)
        throw problem('validation_failed', 'This part does not match its checksum.');
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, 'share');
        const upload = await findUpload(tx, org, projectId, sessionId, 'update');
        if (bytes.length === 0 || bytes.length !== partSize(upload.byteSize, partNumber))
          throw problem('validation_failed', 'This part does not match the expected byte length.');
        const [existing] = await tx
          .select()
          .from(parts)
          .where(
            and(
              projectScope(org.orgId, upload.projectId).parts,
              eq(parts.sessionId, upload.id),
              eq(parts.partNumber, partNumber),
            ),
          );
        if (existing) {
          if (existing.sha256 !== sha256)
            throw problem('conflict', 'A different part was already accepted at this position.');
          return progress(tx, upload);
        }
        if (upload.finalizedAt) throw problem('conflict', 'This upload is finalized.');
        assertRevision(upload.revision, revision);
        await app.storage.put(
          jobsitePhotoKey(org.orgId, upload.id, partNumber),
          bytes,
          'application/octet-stream',
        );
        await tx.insert(parts).values({
          orgId: org.orgId,
          projectId: upload.projectId,
          sessionId: upload.id,
          partNumber,
          sha256,
          byteSize: bytes.length,
        });
        const [changed] = await tx
          .update(uploads)
          .set({ revision: upload.revision + 1 })
          .where(and(projectScope(org.orgId, upload.projectId).uploads, eq(uploads.id, upload.id)))
          .returning();
        if (!changed) throw problem('internal');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          resourceId: upload.id,
          resourceType: 'enterprise_media_upload_session',
          action: 'media.upload_part_received',
          after: { projectId: upload.projectId, partNumber, revision: changed.revision },
        });
        return progress(tx, changed);
      });
      setEtag(reply, result.revision);
      return result;
    },
  );

  app.post(
    sessionPath + '/finalize',
    {
      config: {
        permission: 'enterprise_media:upload',
        rateLimit: { max: 45, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['enterprise'],
        params: SessionParams,
        body: FinalizeJobsitePhotoUpload,
        response: { 200: JobsiteMediaAsset, 201: JobsiteMediaAsset },
      },
    },
    async (request, reply) => {
      const { projectId, sessionId } = request.params;
      const { clientRequestId } = request.body;
      const revision = parseIfMatch(request);
      const result = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, 'share');
        const upload = await findUpload(tx, org, projectId, sessionId, 'update');
        if (upload.finalizedAt) {
          if (upload.finalizedRequestId !== clientRequestId || revision !== upload.revision - 1)
            throw problem('conflict', 'This upload was finalized by a different request.');
          const row = await findAsset(tx, org.orgId, upload.projectId, upload.id);
          return { created: false, asset: assetDto(row) };
        }
        assertRevision(upload.revision, revision);
        if (upload.byteSize > maxBytes)
          throw problem(
            'payload_too_large',
            'This file exceeds the current company storage limit.',
          );
        const bytes = await assembleOriginal(app.storage, upload, await listParts(tx, upload));
        await app.storage.put(
          jobsitePhotoKey(org.orgId, upload.id),
          bytes,
          'application/octet-stream',
        );
        await tx
          .update(uploads)
          .set({
            revision: upload.revision + 1,
            finalizedAt: new Date(),
            finalizedRequestId: clientRequestId,
          })
          .where(and(projectScope(org.orgId, upload.projectId).uploads, eq(uploads.id, upload.id)));
        const [asset] = await tx
          .insert(assets)
          .values({
            id: upload.id,
            orgId: org.orgId,
            projectId: upload.projectId,
            videoState: upload.declaredDurationMs !== null ? 'queued' : null,
          })
          .returning();
        if (!asset) throw problem('internal');
        await enqueue(tx, {
          orgId: org.orgId,
          task: 'enterprise_media.scan',
          aggregateType: 'enterprise_media_asset',
          aggregateId: asset.id,
          payload: { projectId: upload.projectId, assetId: asset.id },
          correlationId: request.id,
          jobKey: 'enterprise_media.scan:' + asset.id,
        });
        const saved = assetDto({ asset, upload });
        await auditRequest(request, tx, {
          orgId: org.orgId,
          resourceId: upload.id,
          resourceType: 'enterprise_media_asset',
          action: 'media.upload_completed',
          after: saved,
        });
        return { created: true, asset: saved };
      });
      setEtag(reply, result.asset.revision);
      return reply.code(result.created ? 201 : 200).send(result.asset);
    },
  );

  app.get(
    assetPath + '/original',
    {
      config: {
        permission: 'enterprise_media:read',
        rateLimit: { max: 60, timeWindow: '1 minute' },
      },
      schema: { tags: ['enterprise'], params: AssetParams },
    },
    async (request, reply) => {
      const { projectId, assetId } = request.params;
      const outcome = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, 'share');
        const { asset, upload } = await findAsset(tx, org.orgId, projectId, assetId);
        if (asset.scanState !== 'clean')
          throw problem('conflict', 'The original is available after its scan passes.');
        if (upload.declaredDurationMs !== null && asset.videoState !== 'ready')
          throw problem('conflict', 'The original is available after video validation succeeds.');
        const bytes = await app.storage.get(jobsitePhotoKey(org.orgId, upload.id));
        if (bytes.length !== upload.byteSize || sha256Hex(bytes) !== upload.sha256)
          throw problem('conflict', 'The stored original could not be verified.');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          resourceType: 'enterprise_media_asset',
          resourceId: upload.id,
          action: 'media.original_downloaded',
        });
        return { filename: safeFileName(upload.filename), bytes };
      });
      return reply
        .type('application/octet-stream')
        .header('content-disposition', 'attachment; filename="' + outcome.filename + '"')
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(outcome.bytes);
    },
  );

  app.get(
    assetPath + '/playback',
    {
      config: {
        permission: 'enterprise_media:read',
        rateLimit: { max: 60, timeWindow: '1 minute' },
      },
      schema: { tags: ['enterprise'], params: AssetParams },
    },
    async (request, reply) => {
      const { projectId, assetId } = request.params;
      const { bytes, range } = await tenantTx(request, async (tx) => {
        const { org } = await requireMediaProject(request, tx, projectId, 'share');
        const { asset, upload, playback } = await findAsset(tx, org.orgId, projectId, assetId);
        if (upload.declaredDurationMs === null) throw problem('not_found');
        if (asset.scanState !== 'clean' || asset.videoState !== 'ready' || !playback)
          throw problem('conflict', 'The video is available after processing succeeds.');
        if (playback.sourceSha256 !== upload.sha256)
          throw problem('conflict', 'The playback source could not be verified.');
        const header = request.headers.range;
        const range = header === undefined ? undefined : playbackRange(header, playback.byteSize);
        if (range === null) return { bytes: null, range: playback.byteSize };
        const bytes = await app.storage.get(jobsiteVideoPlaybackKey(org.orgId, assetId));
        if (bytes.length !== playback.byteSize || sha256Hex(bytes) !== playback.sha256)
          throw problem('conflict', 'The stored playback file could not be verified.');
        await auditRequest(request, tx, {
          orgId: org.orgId,
          resourceType: 'enterprise_media_asset',
          resourceId: assetId,
          action: 'media.video_playback_read',
        });
        return { bytes, range };
      });
      reply
        .header('accept-ranges', 'bytes')
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff');
      if (!bytes)
        return reply
          .code(416)
          .header('content-range', 'bytes */' + range)
          .send();
      if (!range || typeof range === 'number') return reply.type('video/mp4').send(bytes);
      return reply
        .code(206)
        .type('video/mp4')
        .header('content-range', 'bytes ' + range.start + '-' + range.end + '/' + bytes.length)
        .send(bytes.subarray(range.start, range.end + 1));
    },
  );
};

export default jobsiteMedia;
