// Single-file import through the bulk engine (Phase B item 7): the Invoice Dashboard's
// "Import invoices" panel keeps its column matching and preview, but the file itself is sent
// to Invoice Intelligence (batch + file + mapping), so records land in the same review queue
// as bulk imports. The old /invoices/import endpoint is unchanged for other callers.
import type { ApiClient } from '../../lib/api';
import { CHUNKED_THRESHOLD_BYTES, uploadFileChunked } from './chunkedUpload';
import type { ColumnMap, ImportField } from './invoiceImport';

/** Dashboard column choices translated to bulk-engine field names. */
export const BULK_FIELD_FOR: Record<ImportField, string> = {
  number: 'invoiceNumber',
  client: 'partyName',
  email: 'partyEmail',
  date: 'issueDate',
  due: 'dueDate',
  status: 'status',
  total: 'total',
  tax: 'tax',
  paid: 'amountPaid',
  balance: 'balance',
  description: 'description',
  qty: 'quantity',
  rate: 'rate',
  lineAmount: 'lineAmount',
  notes: 'memo',
};

export function toBulkMapping(map: ColumnMap): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, index] of Object.entries(map)) {
    if (index === undefined) continue;
    out[BULK_FIELD_FOR[key as ImportField]] = index;
  }
  return out;
}

export interface BulkImportOutcome {
  batchId: string;
  fileId: string | null;
  status: string;
  records: number;
  needsReview: number;
  duplicates: number;
}

interface FileResult {
  file: string;
  status: string;
  reason?: string;
  records?: number;
  needsReview?: number;
  duplicates?: number;
  fileId?: string;
}

function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('The file could not be read.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Sends one CSV (uploaded file or pasted rows) through the bulk engine and applies the
 * dashboard's column mapping, so the records appear in the import review queue.
 */
export async function importViaBulkEngine(
  api: ApiClient,
  input: { source: string; file: Blob & { name: string }; map: ColumnMap },
): Promise<BulkImportOutcome> {
  const batch = (await api.post('/v1/invoice-intel/batches', {
    sourcePlatform: input.source.slice(0, 60) || 'other',
    directionHint: 'receivable',
  })) as { batch: { id: string } };
  let results: FileResult[];
  if (input.file.size > CHUNKED_THRESHOLD_BYTES) {
    results = (await uploadFileChunked(api, batch.batch.id, input.file)).results;
  } else {
    const res = (await api.post(`/v1/invoice-intel/batches/${batch.batch.id}/files`, {
      name: input.file.name,
      dataBase64: await readBase64(input.file),
    })) as { results: FileResult[] };
    results = res.results;
  }
  const first = results[0];
  if (!first) throw new Error('The bulk import engine did not accept the file.');
  if (
    first.status === 'rejected' ||
    first.status === 'failed' ||
    first.status === 'duplicate_file'
  ) {
    throw new Error(first.reason ?? 'The bulk import engine could not read this file.');
  }
  let status = first.status;
  let records = first.records ?? 0;
  let needsReview = first.needsReview ?? 0;
  let duplicates = first.duplicates ?? 0;
  // Apply the column mapping chosen in the dashboard so the review queue reads the same columns
  // the preview showed. When the engine already extracted with an identical auto-mapping this
  // re-reads with the user's mapping, which is the point of showing the preview.
  if (first.fileId) {
    const mapped = (await api.put(`/v1/invoice-intel/files/${first.fileId}/mapping`, {
      mapping: toBulkMapping(input.map),
      direction: 'receivable',
    })) as { records?: number; needsReview?: number; duplicates?: number };
    status = 'extracted';
    records = mapped.records ?? records;
    needsReview = mapped.needsReview ?? needsReview;
    duplicates = mapped.duplicates ?? duplicates;
  }
  return {
    batchId: batch.batch.id,
    fileId: first.fileId ?? null,
    status,
    records,
    needsReview,
    duplicates,
  };
}
