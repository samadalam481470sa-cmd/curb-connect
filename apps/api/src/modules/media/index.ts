// `media` module (PLT-018, BE-075, CV-042 intake): upload intents with short-lived signed URLs,
// idempotent by checksum (a retry never creates a second asset), completion with sniffing,
// limits, checksum, EXIF restriction, sanitized copy + thumbnail, honest scan status, and
// per-request authorized downloads. Restricted EXIF is never returned by any endpoint.
import {
  CreateUploadRequestSchema,
  CreateUploadResponseSchema,
  type MediaAsset,
  MediaAssetListSchema,
  MediaAssetSchema,
  MediaOwnerTypeSchema,
  PageQuerySchema,
  UuidSchema,
} from '@fieldline/contracts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { mediaAssets, uploadSessions } from '../../db/schema';
import { withTenant } from '../../db/runtime';
import { assertCan, requireOrg, tenantTx } from '../../http/context';
import { afterCursor, decodeCursor, msTrunc, pageResult } from '../../http/pagination';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { mediaObjectKey } from '../../storage';
import { MEDIA_OWNER_RULES, ownerExists } from './owners';
import { processUpload, type ProcessingRejection } from './processing';

type AssetRow = typeof mediaAssets.$inferSelect;

/** The contract requires an uploadUrl; for an exact duplicate there is nothing to upload. */
const UploadIntentResponseSchema = CreateUploadResponseSchema.extend({
  uploadUrl: z.url().nullable(),
  status: z.enum(['pending_upload', 'uploaded', 'processing', 'ready', 'rejected', 'deleted']),
});

const CreateUploadBodySchema = CreateUploadRequestSchema.extend({
  ownerType: MediaOwnerTypeSchema,
  ownerId: UuidSchema,
});

const DOWNLOAD_URL_SECONDS = 60;

async function assetDto(request: FastifyRequest, row: AssetRow): Promise<MediaAsset> {
  const storage = request.server.storage;
  const ready = row.status === 'ready';
  // Only the sanitized copy is ever handed out for photos; documents/videos use the original.
  const viewKey = ready ? (row.sanitizedObjectKey ?? (row.kind === 'photo' ? null : row.originalObjectKey)) : null;
  const ttl = Math.min(request.server.config.storage.signedUrlTtlSeconds, DOWNLOAD_URL_SECONDS * 5);
  const viewUrl = viewKey
    ? await storage.createDownloadUrl(viewKey, {
        expiresInSeconds: ttl,
        contentType: row.sanitizedObjectKey ? row.mimeType : row.mimeType,
        fileName: row.fileName ?? undefined,
      })
    : null;
  const thumbnailUrl =
    ready && row.thumbnailObjectKey
      ? await storage.createDownloadUrl(row.thumbnailObjectKey, { expiresInSeconds: ttl, contentType: 'image/webp' })
      : null;
  return {
    id: row.id,
    orgId: row.orgId,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    kind: row.kind,
    viewType: row.viewType,
    status: row.status,
    scanStatus: row.scanStatus,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    sha256: row.sha256,
    widthPx: row.widthPx,
    heightPx: row.heightPx,
    capturedAt: row.capturedAt?.toISOString() ?? null,
    qualityScores: (row.qualityScores as Record<string, number> | null) ?? null,
    qualityPassed: row.qualityPassed,
    version: row.version,
    thumbnailUrl,
    viewUrl,
  };
}

function rejectionProblem(rejection: ProcessingRejection) {
  switch (rejection.reason) {
    case 'too_large':
      return problem('payload_too_large', rejection.detail);
    case 'unsupported_type':
    case 'type_mismatch':
      return problem('unsupported_media_type', rejection.detail);
    case 'checksum_mismatch':
      return problem('checksum_mismatch', rejection.detail);
    default:
      return problem('media_rejected', rejection.detail);
  }
}

const mediaModule: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/media/uploads',
    {
      config: { auth: 'org', rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['media'],
        summary:
          'Create an upload intent: tenant-prefixed key + short-lived signed PUT URL. Idempotent by sha256 within the company.',
        body: CreateUploadBodySchema,
        response: { 200: UploadIntentResponseSchema, 201: UploadIntentResponseSchema },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const body = request.body;
      assertCan(request, MEDIA_OWNER_RULES[body.ownerType].upload);
      const limit = app.config.storage.maxUploadBytes;
      if (body.sizeBytes > limit) {
        throw problem('payload_too_large', `Files may be at most ${limit} bytes.`);
      }
      const ttl = app.config.storage.signedUrlTtlSeconds;
      const result = await tenantTx(request, async (tx) => {
        if (!(await ownerExists(tx, org.orgId, body.ownerType, body.ownerId))) throw problem('not_found');
        const [existing] = await tx
          .select()
          .from(mediaAssets)
          .where(and(eq(mediaAssets.orgId, org.orgId), eq(mediaAssets.sha256, body.sha256)))
          .for('update');
        const expiresAt = new Date(Date.now() + ttl * 1000);

        if (existing && existing.status !== 'rejected' && existing.status !== 'pending_upload') {
          // PLT-018 S: the same bytes are already stored; never create a second photo.
          const [session] = await tx
            .select({ id: uploadSessions.id })
            .from(uploadSessions)
            .where(and(eq(uploadSessions.orgId, org.orgId), eq(uploadSessions.mediaAssetId, existing.id)))
            .limit(1);
          return { status: 200, existing, sessionId: session?.id ?? existing.id, duplicate: true, expiresAt, upload: null };
        }

        let asset = existing;
        if (asset) {
          [asset] = await tx
            .update(mediaAssets)
            .set({ status: 'pending_upload', mimeType: body.mimeType, sizeBytes: body.sizeBytes, revision: asset.revision + 1 })
            .where(eq(mediaAssets.id, asset.id))
            .returning();
        } else {
          const id = crypto.randomUUID();
          [asset] = await tx
            .insert(mediaAssets)
            .values({
              id,
              orgId: org.orgId,
              ownerType: body.ownerType,
              ownerId: body.ownerId,
              kind: body.kind,
              viewType: body.viewType ?? null,
              status: 'pending_upload',
              originalObjectKey: mediaObjectKey(org.orgId, id, 'original'),
              fileName: body.fileName,
              sha256: body.sha256,
              mimeType: body.mimeType,
              sizeBytes: body.sizeBytes,
              uploadedByUserId: org.userId,
            })
            .returning();
          await auditRequest(request, tx, {
            orgId: org.orgId,
            action: 'media.upload_requested',
            resourceType: 'media_asset',
            resourceId: id,
            after: { ownerType: body.ownerType, ownerId: body.ownerId, mimeType: body.mimeType, sizeBytes: body.sizeBytes },
          });
        }
        // Reuse the pending session for this key (a retried intent refreshes the URL only).
        const [session] = await tx
          .insert(uploadSessions)
          .values({
            orgId: org.orgId,
            ownerType: body.ownerType,
            ownerId: body.ownerId,
            objectKey: asset!.originalObjectKey,
            expectedMimeType: body.mimeType,
            maxBytes: body.sizeBytes,
            status: 'pending',
            mediaAssetId: asset!.id,
            expiresAt,
          })
          .onConflictDoUpdate({
            target: [uploadSessions.orgId, uploadSessions.objectKey],
            set: { status: 'pending', expectedMimeType: body.mimeType, maxBytes: body.sizeBytes, expiresAt },
          })
          .returning({ id: uploadSessions.id });
        const upload = await app.storage.createUploadUrl(asset!.originalObjectKey, {
          contentType: body.mimeType,
          maxBytes: body.sizeBytes,
          expiresInSeconds: ttl,
        });
        return { status: existing ? 200 : 201, existing: asset!, sessionId: session!.id, duplicate: false, expiresAt, upload };
      });
      reply.status(result.status as 200 | 201);
      return {
        uploadId: result.sessionId,
        mediaAssetId: result.existing.id,
        uploadUrl: result.upload?.url ?? null,
        method: 'PUT' as const,
        headers: result.upload?.headers ?? {},
        expiresAt: (result.upload?.expiresAt ?? result.expiresAt).toISOString(),
        duplicate: result.duplicate,
        status: result.existing.status,
      };
    },
  );

  app.post(
    '/media/uploads/:uploadId/complete',
    {
      config: { auth: 'org' },
      schema: {
        tags: ['media'],
        summary: 'Finish an upload: sniff type, enforce limits, verify sha256, strip EXIF, thumbnail',
        params: z.object({ uploadId: UuidSchema }),
        response: { 200: MediaAssetSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const scope = { orgId: org.orgId, userId: org.userId };
      const loaded = await tenantTx(request, async (tx) => {
        const [session] = await tx
          .select()
          .from(uploadSessions)
          .where(and(eq(uploadSessions.orgId, org.orgId), eq(uploadSessions.id, request.params.uploadId)));
        if (!session || !session.mediaAssetId) return null;
        const [asset] = await tx.select().from(mediaAssets).where(eq(mediaAssets.id, session.mediaAssetId));
        return asset ? { session, asset } : null;
      });
      if (!loaded) throw problem('not_found');
      const { session, asset } = loaded;
      assertCan(request, MEDIA_OWNER_RULES[asset.ownerType].upload);
      if (session.status === 'completed' && asset.status === 'ready') return assetDto(request, asset);
      if (session.status === 'rejected') throw problem('media_rejected', 'This upload was rejected; request a new upload.');
      if (session.expiresAt <= new Date() && !(await app.storage.head(session.objectKey))) {
        throw problem('upload_expired');
      }
      const info = await app.storage.head(session.objectKey);
      if (!info) throw problem('invalid_transition', 'Upload the file to the signed URL before completing.');

      const bytes = await app.storage.get(session.objectKey);
      const outcome = await processUpload(
        bytes,
        {
          mimeType: session.expectedMimeType,
          sha256: asset.sha256,
          maxBytes: Math.min(session.maxBytes, app.config.storage.maxUploadBytes),
        },
        app.scanner,
      );
      if (!outcome.ok) {
        await withTenant(app.db, scope, async (tx) => {
          await tx.update(uploadSessions).set({ status: 'rejected' }).where(eq(uploadSessions.id, session.id));
          await tx
            .update(mediaAssets)
            .set({ status: 'rejected', revision: asset.revision + 1 })
            .where(eq(mediaAssets.id, asset.id));
          await auditRequest(request, tx, {
            orgId: org.orgId,
            action: 'media.rejected',
            resourceType: 'media_asset',
            resourceId: asset.id,
            after: { reason: outcome.rejection.reason },
          });
        });
        await app.storage.delete(session.objectKey).catch(() => undefined);
        throw rejectionProblem(outcome.rejection);
      }
      const media = outcome.media;
      const sanitizedKey = media.sanitized ? mediaObjectKey(org.orgId, asset.id, 'sanitized') : null;
      const thumbnailKey = media.thumbnail ? mediaObjectKey(org.orgId, asset.id, 'thumbnail') : null;
      if (media.sanitized && sanitizedKey) await app.storage.put(sanitizedKey, media.sanitized.bytes, media.sanitized.mimeType);
      if (media.thumbnail && thumbnailKey) await app.storage.put(thumbnailKey, media.thumbnail.bytes, media.thumbnail.mimeType);

      const updated = await withTenant(app.db, scope, async (tx) => {
        const [row] = await tx
          .update(mediaAssets)
          .set({
            status: 'ready',
            mimeType: media.sanitized?.mimeType ?? media.mimeType,
            sizeBytes: media.sizeBytes,
            widthPx: media.widthPx,
            heightPx: media.heightPx,
            capturedAt: media.capturedAt,
            exifRestricted: media.exif,
            sanitizedObjectKey: sanitizedKey,
            thumbnailObjectKey: thumbnailKey,
            scanStatus: media.scanStatus,
            revision: asset.revision + 1,
          })
          .where(eq(mediaAssets.id, asset.id))
          .returning();
        await tx.update(uploadSessions).set({ status: 'completed' }).where(eq(uploadSessions.id, session.id));
        await auditRequest(request, tx, {
          orgId: org.orgId,
          action: 'media.uploaded',
          resourceType: 'media_asset',
          resourceId: asset.id,
          after: {
            ownerType: asset.ownerType,
            ownerId: asset.ownerId,
            mimeType: media.mimeType,
            sizeBytes: media.sizeBytes,
            scanStatus: media.scanStatus,
            // Only whether a location was present; the coordinates stay in the restricted field.
            gpsLocationPresent: media.exif?.gps != null,
          },
        });
        return row!;
      });
      return assetDto(request, updated);
    },
  );

  app.get(
    '/media/:id',
    {
      config: { auth: 'org' },
      schema: {
        tags: ['media'],
        summary: 'One media asset with short-lived view/thumbnail URLs (sanitized copies only)',
        params: z.object({ id: UuidSchema }),
        response: { 200: MediaAssetSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const [row] = await tenantTx(request, (tx) =>
        tx.select().from(mediaAssets).where(and(eq(mediaAssets.orgId, org.orgId), eq(mediaAssets.id, request.params.id))),
      );
      if (!row || row.status === 'deleted') throw problem('not_found');
      assertCan(request, MEDIA_OWNER_RULES[row.ownerType].read);
      return assetDto(request, row);
    },
  );

  app.get(
    '/media',
    {
      config: { auth: 'org' },
      schema: {
        tags: ['media'],
        summary: 'Media attached to one owner record',
        querystring: PageQuerySchema.extend({ ownerType: MediaOwnerTypeSchema, ownerId: UuidSchema }),
        response: { 200: MediaAssetListSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const q = request.query;
      assertCan(request, MEDIA_OWNER_RULES[q.ownerType].read);
      const cursor = decodeCursor(q.cursor);
      const rows = await tenantTx(request, async (tx) => {
        // Another company's record (or a made-up id) is a 404, not an empty list (BE-078 G).
        if (!(await ownerExists(tx, org.orgId, q.ownerType, q.ownerId))) throw problem('not_found');
        return tx
          .select()
          .from(mediaAssets)
          .where(
            and(
              eq(mediaAssets.orgId, org.orgId),
              eq(mediaAssets.ownerType, q.ownerType),
              eq(mediaAssets.ownerId, q.ownerId),
              inArray(mediaAssets.status, ['pending_upload', 'uploaded', 'processing', 'ready', 'rejected']),
              afterCursor(mediaAssets.createdAt, mediaAssets.id, cursor),
            ),
          )
          .orderBy(asc(msTrunc(mediaAssets.createdAt)), asc(mediaAssets.id))
          .limit(q.limit + 1);
      });
      const page = pageResult(rows, q.limit, (r) => ({ at: r.createdAt, id: r.id }), (r) => r);
      return { items: await Promise.all(page.items.map((r) => assetDto(request, r))), nextCursor: page.nextCursor };
    },
  );

  app.get(
    '/media/:id/content',
    {
      config: { auth: 'org' },
      schema: {
        tags: ['media'],
        summary: 'Download (authorized on every request): sanitized view or thumbnail',
        params: z.object({ id: UuidSchema }),
        querystring: z.object({ variant: z.enum(['view', 'thumbnail']).default('view') }),
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const [row] = await tenantTx(request, (tx) =>
        tx.select().from(mediaAssets).where(and(eq(mediaAssets.orgId, org.orgId), eq(mediaAssets.id, request.params.id))),
      );
      if (!row || row.status !== 'ready') throw problem('not_found');
      assertCan(request, MEDIA_OWNER_RULES[row.ownerType].read);
      const key =
        request.query.variant === 'thumbnail'
          ? row.thumbnailObjectKey
          : (row.sanitizedObjectKey ?? (row.kind === 'photo' ? null : row.originalObjectKey));
      if (!key) throw problem('not_found');
      const contentType = request.query.variant === 'thumbnail' ? 'image/webp' : row.mimeType;
      reply.header('cache-control', 'private, no-store');
      if (app.storage.driver === 's3') {
        return reply.redirect(
          await app.storage.createDownloadUrl(key, { expiresInSeconds: DOWNLOAD_URL_SECONDS, contentType }),
          302,
        );
      }
      return reply.type(contentType).header('x-content-type-options', 'nosniff').send(await app.storage.get(key));
    },
  );
};

export default mediaModule;
