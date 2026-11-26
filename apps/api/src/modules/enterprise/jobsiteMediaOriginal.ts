import type {
  enterpriseMediaAssets,
  enterpriseMediaUploadSessions,
} from '../../db/schema/enterpriseMedia';
import { problem } from '../../http/problem';
import { safeFileName, type StorageAdapter } from '../../storage';
import { sha256Hex } from '../media/processing';
import { jobsitePhotoKey } from './jobsiteMediaStorage';

type OriginalSource = Pick<
  typeof enterpriseMediaUploadSessions.$inferSelect,
  'orgId' | 'id' | 'filename' | 'byteSize' | 'sha256' | 'declaredDurationMs'
>;
type OriginalStatus = Pick<typeof enterpriseMediaAssets.$inferSelect, 'scanState' | 'videoState'>;

export async function readVerifiedJobsiteOriginal(
  storage: StorageAdapter,
  upload: OriginalSource,
  asset: OriginalStatus,
) {
  if (asset.scanState !== 'clean')
    throw problem('conflict', 'The original is available after its scan passes.');
  if (upload.declaredDurationMs !== null && asset.videoState !== 'ready')
    throw problem('conflict', 'The original is available after video validation succeeds.');
  const bytes = await storage.get(jobsitePhotoKey(upload.orgId, upload.id));
  if (bytes.length !== upload.byteSize || sha256Hex(bytes) !== upload.sha256)
    throw problem('conflict', 'The stored original could not be verified.');
  return { filename: safeFileName(upload.filename), bytes };
}
