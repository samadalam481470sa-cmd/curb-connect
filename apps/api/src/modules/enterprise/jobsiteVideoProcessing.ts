import { JOBSITE_PHOTO_MAX_BYTES, JobsiteVideoPlayback } from '@fieldline/contracts';
import { and, eq } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import {
  enterpriseMediaAssets as assets,
  enterpriseMediaUploadSessions as uploads,
  enterpriseMediaVideoDerivatives as derivatives,
} from '../../db/schema/enterpriseMedia';
import type { Tx } from '../../db/runtime';
import { writeAudit } from '../../services/audit';
import type { StorageAdapter } from '../../storage';
import { sha256Hex } from '../media/processing';
import { jobsitePhotoKey, jobsiteVideoPlaybackKey } from './jobsiteMediaStorage';

type VideoScope = { orgId: string; projectId: string; assetId: string };
type VideoSource = typeof uploads.$inferSelect;
type VideoOutput =
  | {
      state: 'ready';
      content: Buffer;
      sha256: string;
      durationMs: number;
      width: number;
      height: number;
    }
  | { state: 'rejected' | 'failed' };

function assetScope({ orgId, projectId, assetId }: VideoScope) {
  return and(eq(assets.orgId, orgId), eq(assets.projectId, projectId), eq(assets.id, assetId));
}

export async function claimJobsiteVideo(tx: Tx, scope: VideoScope): Promise<VideoSource | null> {
  const [asset] = await tx.select().from(assets).where(assetScope(scope)).for('update');
  if (
    asset?.scanState !== 'clean' ||
    (asset.videoState !== 'queued' && asset.videoState !== 'processing')
  )
    return null;
  const [upload] = await tx
    .select()
    .from(uploads)
    .where(
      and(
        eq(uploads.orgId, scope.orgId),
        eq(uploads.projectId, scope.projectId),
        eq(uploads.id, scope.assetId),
      ),
    );
  if (!upload?.finalizedAt || upload.declaredDurationMs === null)
    throw new Error('No finalized video source for this asset.');
  if (asset.videoState === 'queued') {
    await tx
      .update(assets)
      .set({ videoState: 'processing', revision: asset.revision + 1 })
      .where(assetScope(scope));
  }
  return upload;
}

async function readBounded(response: Response) {
  if (!response.body) throw new Error('The jobsite video worker returned no playback data.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteSize = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      byteSize += part.value.byteLength;
      if (byteSize > JOBSITE_PHOTO_MAX_BYTES)
        throw new Error('The normalized video exceeds the playback size limit.');
      chunks.push(part.value);
    }
    return Buffer.concat(chunks, byteSize);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function transcodeJobsiteVideo(
  vision: { url: string; serviceToken: string | undefined },
  storage: StorageAdapter,
  upload: VideoSource,
): Promise<VideoOutput> {
  if (!vision.serviceToken) throw new Error('The private video worker is unconfigured.');
  const original = await storage.get(jobsitePhotoKey(upload.orgId, upload.id));
  if (original.length !== upload.byteSize || sha256Hex(original) !== upload.sha256)
    throw new Error('The stored video original could not be verified.');
  const response = await fetch(new URL('/v1/enterprise/media/transcode-video', vision.url), {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + vision.serviceToken,
      'content-type': upload.mimeType,
    },
    body: Uint8Array.from(original),
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  });
  if ([413, 415, 422].includes(response.status)) {
    await response.body?.cancel().catch(() => undefined);
    return { state: 'rejected' };
  }
  if (!response.ok || response.headers.get('content-type') !== 'video/mp4') {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('The private video worker did not return playback.');
  }
  const content = await readBounded(response);
  if ((await fileTypeFromBuffer(content))?.mime !== 'video/mp4')
    throw new Error('The video worker returned an invalid playback file.');
  const decoded = JobsiteVideoPlayback.parse({
    version: 1,
    sha256: sha256Hex(content),
    byteSize: content.length,
    durationMs: Number(response.headers.get('x-video-duration-ms')),
    width: Number(response.headers.get('x-video-width')),
    height: Number(response.headers.get('x-video-height')),
  });
  return { state: 'ready', content, ...decoded };
}

export async function finishJobsiteVideo(
  tx: Tx,
  scope: VideoScope,
  upload: VideoSource,
  result: VideoOutput,
  {
    storage,
    eventId,
    auditSecret,
  }: { storage: StorageAdapter; eventId: string; auditSecret: string },
) {
  const [asset] = await tx.select().from(assets).where(assetScope(scope)).for('update');
  if (asset?.scanState !== 'clean' || asset.videoState !== 'processing') return;
  if (result.state === 'ready') {
    await storage.put(
      jobsiteVideoPlaybackKey(scope.orgId, scope.assetId),
      result.content,
      'video/mp4',
    );
    await tx.insert(derivatives).values({
      ...scope,
      sourceSha256: upload.sha256,
      sha256: result.sha256,
      byteSize: result.content.length,
      durationMs: result.durationMs,
      width: result.width,
      height: result.height,
    });
  }
  const revision = asset.revision + 1;
  await tx.update(assets).set({ videoState: result.state, revision }).where(assetScope(scope));
  await writeAudit(
    tx,
    {
      actorUserId: null,
      correlationId: eventId,
      ipSecret: auditSecret,
      ip: undefined,
      userAgent: undefined,
    },
    {
      orgId: scope.orgId,
      resourceType: 'enterprise_media_asset',
      resourceId: scope.assetId,
      action: 'media.video_processing_completed',
      before: { videoState: asset.videoState, revision: asset.revision },
      after: { projectId: scope.projectId, videoState: result.state, revision },
    },
  );
}
