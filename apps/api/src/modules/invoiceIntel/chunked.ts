// Chunked, resumable invoice-import uploads (Phase B item 9): large files are sent in parts so
// a dropped connection resumes from the last received part instead of starting over. Pure logic
// only — storage and HTTP live in index.ts. Chunks are idempotent: re-sending the same part with
// the same bytes is a no-op; different bytes for a received part are refused.
import { sha256 } from './intake';

/** One chunk (decoded bytes). Base64 on the wire adds about a third. */
export const CHUNK_BYTES = 1024 * 1024;

/** Incomplete uploads are abandoned after this long; their parts are deleted. */
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

export function chunkCount(totalBytes: number, chunkBytes = CHUNK_BYTES): number {
  if (!Number.isInteger(totalBytes) || totalBytes <= 0) return 0;
  return Math.ceil(totalBytes / chunkBytes);
}

/** Expected decoded size of chunk `index` (the last chunk may be short). */
export function expectedChunkSize(
  totalBytes: number,
  index: number,
  chunkBytes = CHUNK_BYTES,
): number {
  const count = chunkCount(totalBytes, chunkBytes);
  if (index < 0 || index >= count) return -1;
  return index === count - 1 ? totalBytes - chunkBytes * (count - 1) : chunkBytes;
}

/** Indexes not yet received, in order — what a resumed upload still has to send. */
export function missingIndexes(received: readonly number[], totalBytes: number): number[] {
  const have = new Set(received);
  return Array.from({ length: chunkCount(totalBytes) }, (_, i) => i).filter((i) => !have.has(i));
}

export type ChunkVerdict = { ok: true; duplicate: boolean } | { ok: false; reason: string };

/** Decides whether an incoming chunk may be stored. Same index + same bytes = duplicate no-op. */
export function checkChunk(input: {
  totalBytes: number;
  index: number;
  bytes: Uint8Array;
  /** SHA-256 of the bytes already stored for this index, when received before. */
  existingSha256?: string | null;
}): ChunkVerdict {
  const want = expectedChunkSize(input.totalBytes, input.index);
  if (want < 0) return { ok: false, reason: 'That part number is outside this upload.' };
  if (input.bytes.length !== want)
    return {
      ok: false,
      reason: `Part ${input.index + 1} should be ${want} bytes; got ${input.bytes.length}.`,
    };
  if (input.existingSha256) {
    return sha256(input.bytes) === input.existingSha256
      ? { ok: true, duplicate: true }
      : { ok: false, reason: 'That part was already received with different contents.' };
  }
  return { ok: true, duplicate: false };
}

/** Joins received chunks in order and verifies total size and (when given) the file SHA-256. */
export function assembleChunks(
  chunks: readonly Uint8Array[],
  totalBytes: number,
  expectedSha256?: string | null,
): { ok: true; bytes: Uint8Array } | { ok: false; reason: string } {
  if (chunks.length !== chunkCount(totalBytes))
    return { ok: false, reason: 'Some parts of the file are still missing.' };
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const [i, chunk] of chunks.entries()) {
    if (chunk.length !== expectedChunkSize(totalBytes, i))
      return { ok: false, reason: `Part ${i + 1} has the wrong size.` };
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (expectedSha256 && sha256(bytes) !== expectedSha256)
    return {
      ok: false,
      reason: 'The assembled file does not match its checksum. Upload it again.',
    };
  return { ok: true, bytes };
}

export function isUploadExpired(createdAt: Date, now: Date): boolean {
  return now.getTime() - createdAt.getTime() > UPLOAD_TTL_MS;
}

/** Storage key for one chunk part. Org-scoped like every other invoice-import object. */
export function chunkStorageKey(orgId: string, uploadId: string, index: number): string {
  return `orgs/${orgId}/invoice-imports/uploads/${uploadId}/chunk-${index}`;
}
