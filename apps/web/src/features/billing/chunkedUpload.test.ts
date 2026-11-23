import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../lib/api';
import { CHUNK_BYTES, chunkRanges, missingRanges, uploadFileChunked } from './chunkedUpload';

describe('chunk ranges', () => {
  it('splits into 1 MiB ranges with a short last range', () => {
    expect(chunkRanges(0)).toEqual([]);
    expect(chunkRanges(CHUNK_BYTES + 5)).toEqual([
      { index: 0, start: 0, end: CHUNK_BYTES },
      { index: 1, start: CHUNK_BYTES, end: CHUNK_BYTES + 5 },
    ]);
  });

  it('resumes by sending only missing ranges', () => {
    expect(missingRanges(3 * CHUNK_BYTES, [0, 2]).map((r) => r.index)).toEqual([1]);
    expect(missingRanges(3 * CHUNK_BYTES, [0, 1, 2])).toEqual([]);
  });
});

function fakeApi(received: number[]) {
  const posts: string[] = [];
  const api = {
    get: vi.fn(async () => ({
      upload: { id: 'u1', receivedIndexes: received, missingIndexes: [], status: 'receiving' },
    })),
    post: vi.fn(async (path: string) => {
      posts.push(path);
      if (path.endsWith('/uploads'))
        return {
          upload: { id: 'u1', receivedIndexes: [], missingIndexes: [], status: 'receiving' },
        };
      if (path.endsWith('/complete')) return { results: [{ file: 'a.csv', status: 'extracted' }] };
      return { upload: { id: 'u1', receivedIndexes: [], missingIndexes: [], status: 'receiving' } };
    }),
  } as unknown as ApiClient;
  return { api, posts };
}

describe('uploadFileChunked', () => {
  it('sends every part then completes', async () => {
    const { api, posts } = fakeApi([]);
    const file = new File([new Uint8Array(CHUNK_BYTES + 4)], 'a.csv');
    const result = await uploadFileChunked(api, 'batch1', file);
    expect(result.results).toEqual([{ file: 'a.csv', status: 'extracted' }]);
    expect(posts.filter((p) => p.includes('/chunks/'))).toHaveLength(2);
    expect(posts.at(-1)).toContain('/complete');
  });

  it('resumes an existing upload by sending only missing parts', async () => {
    const { api, posts } = fakeApi([0]);
    const file = new File([new Uint8Array(CHUNK_BYTES + 4)], 'a.csv');
    await uploadFileChunked(api, 'batch1', file, { existingUploadId: 'u1' });
    expect(posts.filter((p) => p.includes('/chunks/'))).toEqual([
      '/v1/invoice-intel/uploads/u1/chunks/1',
    ]);
  });

  it('retries a failed part once', async () => {
    const { api, posts } = fakeApi([]);
    let failed = false;
    (api.post as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
      posts.push(path);
      if (path.includes('/chunks/0') && !failed) {
        failed = true;
        throw new Error('connection dropped');
      }
      if (path.endsWith('/uploads'))
        return {
          upload: { id: 'u1', receivedIndexes: [], missingIndexes: [], status: 'receiving' },
        };
      if (path.endsWith('/complete')) return { results: [] };
      return { upload: { id: 'u1', receivedIndexes: [], missingIndexes: [], status: 'receiving' } };
    });
    const file = new File([new Uint8Array(10)], 'a.csv');
    await expect(uploadFileChunked(api, 'batch1', file)).resolves.toBeDefined();
    expect(posts.filter((p) => p.includes('/chunks/0'))).toHaveLength(2);
  });
});
