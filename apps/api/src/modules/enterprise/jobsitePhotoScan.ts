import { and, eq } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import type { z } from 'zod';
import type { JobsitePhotoScanState } from '@fieldline/contracts';
import type { Tx } from '../../db/runtime';
import {
  enterpriseMediaAssets as assets,
  enterpriseMediaUploadSessions as uploads,
} from '../../db/schema/enterpriseMedia';
import { enqueue } from '../../jobs/outbox';
import { writeAudit } from '../../services/audit';
import type { StorageAdapter } from '../../storage';
import { processUpload, sha256Hex, type MalwareScanner } from '../media/processing';
import { jobsitePhotoKey } from './jobsiteMediaStorage';

type ScanState = z.infer<typeof JobsitePhotoScanState>;

export async function scanJobsitePhoto(
  tx: Tx,
  {
    orgId,
    projectId,
    assetId,
    eventId,
    storage,
    scanner,
    auditSecret,
    lastAttempt,
  }: {
    orgId: string;
    projectId: string;
    assetId: string;
    eventId: string;
    storage: StorageAdapter;
    scanner: MalwareScanner | null;
    auditSecret: string;
    lastAttempt: boolean;
  },
): Promise<'complete' | 'retry' | 'failed'> {
  const scope = and(
    eq(assets.orgId, orgId),
    eq(assets.projectId, projectId),
    eq(assets.id, assetId),
  );
  const [asset] = await tx.select().from(assets).where(scope).for('update');
  if (!asset) return 'complete';
  if (asset.scanState !== 'pending')
    return asset.scanState === 'scan_failed' ? 'failed' : 'complete';
  const [upload] = await tx
    .select()
    .from(uploads)
    .where(
      and(eq(uploads.orgId, orgId), eq(uploads.projectId, projectId), eq(uploads.id, assetId)),
    );
  if (!upload?.finalizedAt) throw new Error('No finalized original for this media asset.');

  const isVideo = upload.declaredDurationMs !== null;
  let scanState: ScanState = 'scan_failed';
  if (scanner) {
    try {
      const bytes = await storage.get(jobsitePhotoKey(orgId, assetId));
      if (bytes.length !== upload.byteSize || sha256Hex(bytes) !== upload.sha256)
        throw new Error('Original checksum verification failed.');
      if (isVideo) {
        const observed = await fileTypeFromBuffer(bytes).catch(() => undefined);
        if (observed?.mime !== upload.mimeType) scanState = 'unsupported';
        else {
          const scan = await scanner.scan(bytes);
          if (scan === 'clean' || scan === 'infected') scanState = scan;
        }
      } else {
        const result = await processUpload(
          bytes,
          { mimeType: upload.mimeType, sha256: upload.sha256, maxBytes: upload.byteSize },
          scanner,
        );
        if (!result.ok) scanState = 'unsupported';
        else if (result.media.scanStatus === 'clean' || result.media.scanStatus === 'infected')
          scanState = result.media.scanStatus;
      }
    } catch {
      if (!lastAttempt) return 'retry';
    }
    if (scanState === 'scan_failed' && !lastAttempt) return 'retry';
  }

  const revision = asset.revision + 1;
  const scannedAt = new Date();
  const videoState = isVideo
    ? scanState === 'clean'
      ? 'queued'
      : scanState === 'scan_failed'
        ? 'failed'
        : 'rejected'
    : null;
  await tx.update(assets).set({ scanState, scannedAt, revision, videoState }).where(scope);
  if (videoState === 'queued') {
    await enqueue(tx, {
      orgId,
      task: 'enterprise_media.transcode',
      aggregateType: 'enterprise_media_asset',
      aggregateId: assetId,
      payload: { projectId, assetId },
      correlationId: eventId,
      jobKey: 'enterprise_media.transcode:' + assetId,
    });
  }
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
      orgId,
      resourceType: 'enterprise_media_asset',
      resourceId: assetId,
      action: 'media.scan_completed',
      before: { scanState: 'pending', revision: asset.revision },
      after: { projectId, scanState, scannedAt, revision },
    },
  );
  return scanState === 'scan_failed' ? 'failed' : 'complete';
}
