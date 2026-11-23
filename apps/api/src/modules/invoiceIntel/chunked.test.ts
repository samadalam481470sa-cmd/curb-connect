import { describe, expect, it } from 'vitest';
import {
  CHUNK_BYTES,
  assembleChunks,
  checkChunk,
  chunkCount,
  expectedChunkSize,
  isUploadExpired,
  missingIndexes,
} from './chunked';
import { sha256 } from './intake';

const MB = CHUNK_BYTES;

describe('chunked upload planning', () => {
  it('splits a file into 1 MiB parts with a short last part', () => {
    expect(chunkCount(0)).toBe(0);
    expect(chunkCount(1)).toBe(1);
    expect(chunkCount(MB)).toBe(1);
    expect(chunkCount(MB + 1)).toBe(2);
    expect(chunkCount(12 * MB)).toBe(12);
    expect(expectedChunkSize(MB + 5, 0)).toBe(MB);
    expect(expectedChunkSize(MB + 5, 1)).toBe(5);
    expect(expectedChunkSize(MB + 5, 2)).toBe(-1);
  });

  it('lists only the parts still missing on resume', () => {
    expect(missingIndexes([], 3 * MB)).toEqual([0, 1, 2]);
    expect(missingIndexes([0, 2], 3 * MB)).toEqual([1]);
    expect(missingIndexes([0, 1, 2], 3 * MB)).toEqual([]);
  });
});

describe('chunk checks', () => {
  const total = MB + 3;
  const first = new Uint8Array(MB).fill(7);

  it('accepts a correctly sized first part', () => {
    expect(checkChunk({ totalBytes: total, index: 0, bytes: first })).toEqual({
      ok: true,
      duplicate: false,
    });
  });

  it('treats re-sending the same part as an idempotent duplicate', () => {
    expect(
      checkChunk({ totalBytes: total, index: 0, bytes: first, existingSha256: sha256(first) }),
    ).toEqual({ ok: true, duplicate: true });
  });

  it('refuses different bytes for a part already received', () => {
    const other = new Uint8Array(MB).fill(9);
    const verdict = checkChunk({
      totalBytes: total,
      index: 0,
      bytes: other,
      existingSha256: sha256(first),
    });
    expect(verdict.ok).toBe(false);
  });

  it('refuses wrong sizes and out-of-range indexes', () => {
    expect(checkChunk({ totalBytes: total, index: 0, bytes: new Uint8Array(3) }).ok).toBe(false);
    expect(checkChunk({ totalBytes: total, index: 5, bytes: first }).ok).toBe(false);
  });
});

describe('assembly', () => {
  it('joins parts in order and verifies the checksum', () => {
    const a = new Uint8Array(MB).fill(1);
    const b = new Uint8Array([2, 3, 4]);
    const whole = new Uint8Array([...a, ...b]);
    const result = assembleChunks([a, b], whole.length, sha256(whole));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bytes).toEqual(whole);
  });

  it('fails when a part is missing (interrupted upload)', () => {
    const a = new Uint8Array(MB).fill(1);
    expect(assembleChunks([a], MB + 3).ok).toBe(false);
  });

  it('fails when the checksum does not match', () => {
    const a = new Uint8Array(MB).fill(1);
    const b = new Uint8Array([2, 3, 4]);
    expect(assembleChunks([a, b], MB + 3, '0'.repeat(64)).ok).toBe(false);
  });

  it('expires incomplete uploads after a day', () => {
    const created = new Date('2026-11-22T00:00:00Z');
    expect(isUploadExpired(created, new Date('2026-11-22T12:00:00Z'))).toBe(false);
    expect(isUploadExpired(created, new Date('2026-11-23T00:00:01Z'))).toBe(true);
  });
});
