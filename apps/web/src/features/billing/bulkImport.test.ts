import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../lib/api';
import { importViaBulkEngine, toBulkMapping } from './bulkImport';

describe('toBulkMapping', () => {
  it('translates dashboard columns to bulk-engine fields', () => {
    expect(toBulkMapping({ number: 0, client: 1, total: 4, paid: 5, notes: 6 })).toEqual({
      invoiceNumber: 0,
      partyName: 1,
      total: 4,
      amountPaid: 5,
      memo: 6,
    });
  });

  it('skips unmapped columns', () => {
    expect(toBulkMapping({})).toEqual({});
  });
});

function fakeApi(fileStatus = 'needs_mapping') {
  const calls: string[] = [];
  const api = {
    post: vi.fn(async (path: string) => {
      calls.push(`POST ${path}`);
      if (path.endsWith('/batches')) return { batch: { id: 'b1' } };
      return { results: [{ file: 'in.csv', status: fileStatus, fileId: 'f1' }] };
    }),
    put: vi.fn(async (path: string) => {
      calls.push(`PUT ${path}`);
      return { records: 3, needsReview: 1, duplicates: 0 };
    }),
  } as unknown as ApiClient;
  return { api, calls };
}

describe('importViaBulkEngine (item 7)', () => {
  it('sends a single file through batch, file upload and mapping into the review queue', async () => {
    const { api, calls } = fakeApi();
    const file = new File(['Number,Client,Total\nINV1,Acme,10'], 'in.csv', { type: 'text/csv' });
    const outcome = await importViaBulkEngine(api, {
      source: 'QuickBooks',
      file,
      map: { number: 0, client: 1, total: 2 },
    });
    expect(outcome).toEqual({
      batchId: 'b1',
      fileId: 'f1',
      status: 'extracted',
      records: 3,
      needsReview: 1,
      duplicates: 0,
    });
    expect(calls).toEqual([
      'POST /v1/invoice-intel/batches',
      'POST /v1/invoice-intel/batches/b1/files',
      'PUT /v1/invoice-intel/files/f1/mapping',
    ]);
  });

  it('surfaces the engine reason when the file is rejected', async () => {
    const { api } = fakeApi('rejected');
    (api.post as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
      if (path.endsWith('/batches')) return { batch: { id: 'b1' } };
      return {
        results: [{ file: 'in.csv', status: 'rejected', reason: 'Not a supported file type.' }],
      };
    });
    const file = new File(['x'], 'in.csv');
    await expect(
      importViaBulkEngine(api, { source: 'Other', file, map: { number: 0, client: 1, total: 2 } }),
    ).rejects.toThrow('Not a supported file type.');
  });
});
