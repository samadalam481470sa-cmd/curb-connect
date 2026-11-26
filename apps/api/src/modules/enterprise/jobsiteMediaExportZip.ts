import { JOBSITE_MEDIA_EXPORT_MAX_BYTES, type JobsiteExportItem } from '@fieldline/contracts';
import { strToU8, zipSync } from 'fflate';

export function archiveJobsiteMedia(
  packageId: string,
  projectId: string,
  createdAt: string,
  files: readonly { source: JobsiteExportItem; bytes: Uint8Array }[],
) {
  const entries: Record<string, Uint8Array> = Object.create(null);
  const manifest = {
    packageId,
    projectId,
    createdAt,
    files: files.map(({ source }) => ({ ...source, path: 'media/' + source.fileName })),
  };
  let total = 0;
  for (const { source, bytes } of files) {
    total += bytes.byteLength;
    if (total >= JOBSITE_MEDIA_EXPORT_MAX_BYTES) throw new Error('media_export_too_large');
    entries['media/' + source.fileName] = bytes;
  }
  entries['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  const result = Buffer.from(zipSync(entries, { level: 0, mtime: new Date(createdAt) }));
  if (result.length > JOBSITE_MEDIA_EXPORT_MAX_BYTES) throw new Error('media_export_too_large');
  return result;
}
