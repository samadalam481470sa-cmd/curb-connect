// Chunked, resumable file upload for invoice imports (Phase B item 9): files over the
// threshold are sent to the bulk import engine in 1 MiB parts. If the connection drops, the
// next attempt asks the server which parts it already has and sends only the missing ones.
// Small files keep using the existing single-request upload.
import type { ApiClient } from '../../lib/api';

/** Files larger than this use chunked upload; smaller files keep the single-request path. */
export const CHUNKED_THRESHOLD_BYTES = 2 * 1024 * 1024;

export const CHUNK_BYTES = 1024 * 1024;

export interface ChunkRange {
  index: number;
  start: number;
  end: number;
}

export function chunkRanges(totalBytes: number, chunkBytes = CHUNK_BYTES): ChunkRange[] {
  const ranges: ChunkRange[] = [];
  for (let start = 0, index = 0; start < totalBytes; start += chunkBytes, index += 1) {
    ranges.push({ index, start, end: Math.min(start + chunkBytes, totalBytes) });
  }
  return ranges;
}

export function missingRanges(
  totalBytes: number,
  receivedIndexes: readonly number[],
  chunkBytes = CHUNK_BYTES,
): ChunkRange[] {
  const have = new Set(receivedIndexes);
  return chunkRanges(totalBytes, chunkBytes).filter((r) => !have.has(r.index));
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string | undefined> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export interface ChunkedUploadResult {
  uploadId: string;
  results: { file: string; status: string; reason?: string; fileId?: string }[];
}

interface UploadView {
  id: string;
  receivedIndexes: number[];
  missingIndexes: number[];
  status: string;
}

/**
 * Uploads one file into an import batch in parts, resuming from server state when an
 * `existingUploadId` is given. Retries each part once; a part the server already has is a
 * server-side no-op, so re-sending after a failure is always safe.
 */
export async function uploadFileChunked(
  api: ApiClient,
  batchId: string,
  file: Blob & { name: string },
  opts: { existingUploadId?: string; onProgress?: (sent: number, total: number) => void } = {},
): Promise<ChunkedUploadResult> {
  const bytes = await file.arrayBuffer();
  let upload: UploadView;
  if (opts.existingUploadId) {
    upload = (
      (await api.get(`/v1/invoice-intel/uploads/${opts.existingUploadId}`)) as {
        upload: UploadView;
      }
    ).upload;
  } else {
    const sha256 = await sha256Hex(bytes);
    upload = (
      (await api.post(`/v1/invoice-intel/batches/${batchId}/uploads`, {
        name: file.name,
        totalBytes: bytes.byteLength,
        ...(sha256 ? { sha256 } : {}),
      })) as { upload: UploadView }
    ).upload;
  }
  const ranges = missingRanges(bytes.byteLength, upload.receivedIndexes);
  const all = chunkRanges(bytes.byteLength);
  let sent = all.length - ranges.length;
  opts.onProgress?.(sent, all.length);
  for (const range of ranges) {
    const slice = new Uint8Array(bytes.slice(range.start, range.end));
    const body = { dataBase64: toBase64(slice) };
    try {
      await api.post(`/v1/invoice-intel/uploads/${upload.id}/chunks/${range.index}`, body);
    } catch {
      // One retry: the part is idempotent on the server, so a lost response cannot corrupt it.
      await api.post(`/v1/invoice-intel/uploads/${upload.id}/chunks/${range.index}`, body);
    }
    sent += 1;
    opts.onProgress?.(sent, all.length);
  }
  const done = (await api.post(`/v1/invoice-intel/uploads/${upload.id}/complete`, {})) as {
    results: ChunkedUploadResult['results'];
  };
  return { uploadId: upload.id, results: done.results };
}
