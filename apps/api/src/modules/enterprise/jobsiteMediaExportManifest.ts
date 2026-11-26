import {
  JOBSITE_MEDIA_EXPORT_MAX_BYTES,
  type JobsiteExportItem,
  type JobsiteExportSelection,
} from '@fieldline/contracts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import {
  enterpriseMediaAssets as assets,
  enterpriseMediaPhotoAnnotationRevisions as annotations,
  enterpriseMediaUploadSessions as uploads,
  enterpriseMediaVideoDerivatives as playback,
} from '../../db/schema/enterpriseMedia';
import { problem } from '../../http/problem';
import { safeFileName } from '../../storage/adapter';

const extensions: Record<JobsiteExportItem['mimeType'], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

export async function packageMediaManifest(
  tx: Tx,
  scope: { orgId: string; projectId: string },
  ids: string[],
  selection: JobsiteExportSelection,
) {
  const rows = await tx
    .select({
      asset: assets,
      upload: uploads,
      annotation: annotations,
      video: playback,
    })
    .from(assets)
    .innerJoin(
      uploads,
      and(
        eq(uploads.orgId, assets.orgId),
        eq(uploads.projectId, assets.projectId),
        eq(uploads.id, assets.id),
      ),
    )
    .leftJoin(
      annotations,
      and(
        eq(annotations.orgId, assets.orgId),
        eq(annotations.projectId, assets.projectId),
        eq(annotations.assetId, assets.id),
        eq(annotations.revision, assets.annotationRevision),
      ),
    )
    .leftJoin(
      playback,
      and(
        eq(playback.orgId, assets.orgId),
        eq(playback.projectId, assets.projectId),
        eq(playback.assetId, assets.id),
        eq(playback.version, 1),
      ),
    )
    .where(
      and(
        eq(assets.orgId, scope.orgId),
        eq(assets.projectId, scope.projectId),
        inArray(assets.id, ids),
      ),
    )
    .orderBy(asc(uploads.capturedAt), asc(assets.id));
  if (rows.length !== ids.length) throw problem('not_found');
  if (
    rows.some(
      ({ asset, upload, video }) =>
        !upload.finalizedAt ||
        asset.scanState !== 'clean' ||
        (upload.declaredDurationMs !== null && (asset.videoState !== 'ready' || !video)),
    )
  )
    throw problem('conflict', 'Every export item must finish scanning and processing.');

  const contents: JobsiteExportItem[] = rows.map(({ asset, upload, annotation, video }, index) => {
    let variant: Pick<
      JobsiteExportItem,
      'source' | 'revisionId' | 'revision' | 'sha256' | 'byteSize' | 'mimeType'
    > = {
      source: 'original',
      revisionId: null,
      revision: null,
      sha256: upload.sha256,
      byteSize: upload.byteSize,
      mimeType: upload.mimeType,
    };
    if (selection === 'current' && annotation) {
      if (annotation.sourceSha256 !== upload.sha256)
        throw problem('conflict', 'An annotation source changed.');
      variant = {
        source: 'annotation',
        revisionId: annotation.id,
        revision: annotation.revision,
        sha256: annotation.sha256,
        byteSize: annotation.byteSize,
        mimeType: 'image/png',
      };
    } else if (selection === 'current' && video) {
      if (video.sourceSha256 !== upload.sha256)
        throw problem('conflict', 'A video source changed.');
      variant = {
        source: 'playback',
        revisionId: video.id,
        revision: video.version,
        sha256: video.sha256,
        byteSize: video.byteSize,
        mimeType: 'video/mp4',
      };
    }
    const base = safeFileName(upload.filename).replace(/\.[A-Za-z0-9]{1,6}$/, '');
    return {
      ...variant,
      mediaId: asset.id,
      name: upload.filename,
      capturedAt: upload.capturedAt.toISOString(),
      originalSha256: upload.sha256,
      fileName:
        String(index + 1).padStart(2, '0') + '-' + base + '.' + extensions[variant.mimeType],
    };
  });
  if (contents.reduce((sum, item) => sum + item.byteSize, 0) >= JOBSITE_MEDIA_EXPORT_MAX_BYTES)
    throw problem(
      'payload_too_large',
      'Choose fewer media items so the source files fit within 64 MiB.',
    );
  return contents;
}
