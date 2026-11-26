import { and, eq } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import {
  enterpriseMediaAssets as assets,
  enterpriseMediaUploadSessions as uploads,
} from '../../db/schema/enterpriseMedia';
import { problem } from '../../http/problem';
import type { StorageAdapter } from '../../storage';
import { sha256Hex } from '../media/processing';
import { jobsitePhotoKey } from './jobsiteMediaStorage';

export type JobsitePhotoScope = { orgId: string; projectId: string; assetId: string };
type PhotoUpload = typeof uploads.$inferSelect;

export function jobsitePhotoAssetScope(scope: JobsitePhotoScope) {
  return and(
    eq(assets.orgId, scope.orgId),
    eq(assets.projectId, scope.projectId),
    eq(assets.id, scope.assetId),
  );
}

export async function readJobsitePhotoAsset(tx: Tx, scope: JobsitePhotoScope, lock: boolean) {
  const query = tx
    .select({
      scanState: assets.scanState,
      revision: assets.annotationRevision,
    })
    .from(assets)
    .where(jobsitePhotoAssetScope(scope));
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
    throw problem('conflict', 'This photo is available after its scan passes.');
  return { revision: asset.revision, source };
}

export async function readVerifiedJobsitePhotoOriginal(
  storage: StorageAdapter,
  upload: PhotoUpload,
) {
  const bytes = await storage.get(jobsitePhotoKey(upload.orgId, upload.id));
  if (bytes.length !== upload.byteSize || sha256Hex(bytes) !== upload.sha256)
    throw problem('conflict', 'The photo original could not be verified.');
  return bytes;
}
