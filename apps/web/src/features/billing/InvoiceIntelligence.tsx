'use client';
// Invoice Intelligence: bulk import invoices and bills exported from another platform, check what
// was read, fix uncertain fields, approve into Billing, and keep a history of every import.
// Additive to Billing: existing invoices, bills and the single-file import are unchanged.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { ErrorNotice, PageHeader } from '../../components/common';
import { orgKey, useApi, useSession } from '../../lib/session';

type Tab = 'import' | 'review' | 'records' | 'history';

interface Meta {
  formats: string[];
  limits: { fileMb: number; batchFiles: number; zipEntries: number; rows: number };
  fields: { key: string; label: string }[];
  platforms: { id: string; label: string }[];
  aiReading: boolean;
  virusScanner: string;
  knownLimits: string[];
}
interface Evidence {
  value: string | number | null;
  confidence: number;
  source: string;
  raw: string;
}
export interface ImportedRecord {
  id: string;
  batchId: string;
  fileId: string;
  direction: 'receivable' | 'payable' | 'unknown';
  docType: string;
  invoiceNumber: string | null;
  partyName: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  subtotalMinor: number | null;
  taxMinor: number | null;
  totalMinor: number | null;
  amountPaidMinor: number;
  status: string;
  category: string | null;
  projectLabel: string | null;
  location: string | null;
  costCode: string | null;
  reviewStatus: 'needs_review' | 'approved' | 'rejected' | 'duplicate';
  reviewReasons: string[];
  fields: Record<string, Evidence>;
  lines: {
    description: string;
    quantity: number | null;
    rateMinor: number | null;
    amountMinor: number | null;
  }[];
  sourceMeta: { confidence?: number; invoiceId?: string; corrections?: unknown[] };
}
interface FileResult {
  file: string;
  status: string;
  reason?: string;
  records?: number;
  needsReview?: number;
  duplicates?: number;
  fileId?: string;
  headers?: string[];
}
interface Batch {
  id: string;
  sourcePlatform: string;
  status: string;
  fileCount: number;
  rejectedCount: number;
  recordCount: number;
  needsReviewCount: number;
  importedCount: number;
  duplicateCount: number;
  createdAt: string;
  files: {
    id: string;
    fileName: string;
    kind: string;
    status: string;
    rejectReason: string | null;
    byteSize: number;
  }[];
}

export const fmtMoney = (minor: number | null | undefined, currency = 'USD') =>
  minor === null || minor === undefined
    ? '—'
    : (minor / 100).toLocaleString('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 2,
      });
const toMinor = (v: string) => {
  const n = Number(v.replace(/[$,\s]/g, ''));
  return v.trim() === '' ? null : Number.isFinite(n) ? Math.round(n * 100) : NaN;
};
const pct = (c: number | undefined) => (c === undefined ? '' : `${Math.round(c * 100)}%`);
const DIRECTION_LABEL = {
  receivable: 'Sent to customer',
  payable: 'Received from vendor',
  unknown: 'Not sure',
} as const;
const REVIEW_LABEL = {
  needs_review: 'Needs review',
  approved: 'Imported',
  rejected: 'Rejected',
  duplicate: 'Possible duplicate',
} as const;

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('The file could not be read.'));
    r.readAsDataURL(file);
  });
}

export function InvoiceIntelligence() {
  const { api } = useApi();
  const session = useSession();
  const orgId = session.orgId;
  const qc = useQueryClient();
  const canWrite = session.check('invoice:write').allowed;
  const initialRecord =
    typeof window === 'undefined'
      ? null
      : new URLSearchParams(window.location.search).get('record');
  const [tab, setTab] = useState<Tab>(initialRecord ? 'records' : 'import');
  const [selected, setSelected] = useState<string | null>(initialRecord);

  const meta = useQuery({
    queryKey: orgKey(orgId, 'invoice-intel', 'meta'),
    queryFn: async () => (await api.get('/v1/invoice-intel/meta')) as Meta,
    staleTime: 600_000,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: orgKey(orgId, 'invoice-intel') });

  return (
    <>
      <PageHeader
        title="Invoice import"
        description="Bring in invoices and bills exported from another app. Check what was read, fix anything uncertain, and approve. Approved customer invoices appear in Billing; everything approved feeds Analysis."
      />
      <p className="web-small">
        <Link href="/billing">← Back to Billing</Link> · <Link href="/analysis">Open Analysis</Link>
      </p>
      <div role="tablist" aria-label="Invoice import" className="cc-tabs">
        {(
          [
            ['import', 'Import invoices'],
            ['review', 'Review queue'],
            ['records', 'Imported records'],
            ['history', 'Import history'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`cc-btn${tab === id ? ' cc-btn--primary' : ''}`}
            onClick={() => {
              setTab(id);
              setSelected(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {meta.error && (
        <ErrorNotice
          error={meta.error}
          title="Import settings could not be loaded"
          onRetry={() => void meta.refetch()}
        />
      )}
      {tab === 'import' && meta.data && (
        <ImportPanel
          meta={meta.data}
          canWrite={canWrite}
          onDone={() => {
            refresh();
          }}
          onReview={() => setTab('review')}
        />
      )}
      {tab === 'review' && (
        <RecordList
          review="needs_review"
          canWrite={canWrite}
          selected={selected}
          onSelect={setSelected}
          onChanged={refresh}
        />
      )}
      {tab === 'records' && (
        <RecordList
          review="approved"
          canWrite={canWrite}
          selected={selected}
          onSelect={setSelected}
          onChanged={refresh}
        />
      )}
      {tab === 'history' && <History onOpenBatch={() => setTab('review')} />}
    </>
  );
}

function ImportPanel({
  meta,
  canWrite,
  onDone,
  onReview,
}: {
  meta: Meta;
  canWrite: boolean;
  onDone: () => void;
  onReview: () => void;
}) {
  const { api } = useApi();
  const [platform, setPlatform] = useState('other');
  const [direction, setDirection] = useState<'auto' | 'receivable' | 'payable' | 'mixed'>('auto');
  const [queue, setQueue] = useState<File[]>([]);
  const [results, setResults] = useState<(FileResult & { local: string })[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [mappingFile, setMappingFile] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const tooBig = [...list].filter((f) => f.size > meta.limits.fileMb * 1024 * 1024);
    setQueue((q) =>
      [...q, ...[...list].filter((f) => f.size <= meta.limits.fileMb * 1024 * 1024)].slice(
        0,
        meta.limits.batchFiles,
      ),
    );
    if (tooBig.length)
      setResults((r) => [
        ...r,
        ...tooBig.map((f) => ({
          local: f.name,
          file: f.name,
          status: 'rejected',
          reason: `Larger than ${meta.limits.fileMb} MB. Split the export or ZIP it.`,
        })),
      ]);
  };

  async function upload(files: File[]) {
    setError(null);
    try {
      let id = batchId;
      if (!id) {
        const res = (await api.post('/v1/invoice-intel/batches', {
          sourcePlatform: platform,
          directionHint: direction,
        })) as { batch: { id: string } };
        id = res.batch.id;
        setBatchId(id);
      }
      setProgress({ done: 0, total: files.length });
      for (const [i, f] of files.entries()) {
        try {
          const dataBase64 = await readBase64(f);
          const res = (await api.post(`/v1/invoice-intel/batches/${id}/files`, {
            name: f.name,
            dataBase64,
          })) as { results: FileResult[] };
          setResults((r) => [
            ...r.filter((x) => x.local !== f.name),
            ...res.results.map((x) => ({ ...x, local: f.name })),
          ]);
        } catch (e) {
          setResults((r) => [
            ...r.filter((x) => x.local !== f.name),
            {
              local: f.name,
              file: f.name,
              status: 'upload_failed',
              reason: e instanceof Error ? e.message : 'Upload failed. Retry.',
            },
          ]);
        }
        setProgress({ done: i + 1, total: files.length });
      }
      setQueue([]);
      onDone();
    } catch (e) {
      setError(e);
    }
  }

  const failed = results.filter((r) => r.status === 'upload_failed').map((r) => r.local);
  const totals = results.reduce(
    (s, r) => ({
      records: s.records + (r.records ?? 0),
      review: s.review + (r.needsReview ?? 0),
      dups: s.dups + (r.duplicates ?? 0),
    }),
    { records: 0, review: 0, dups: 0 },
  );

  return (
    <section className="web-section" aria-labelledby="import-heading">
      <h2 id="import-heading">Import invoices</h2>
      <p className="web-muted web-small">
        Export your invoices or bills from the other app (QuickBooks, Xero, FreshBooks, Wave,
        Jobber, ServiceTitan and others), then upload the files here. You can upload many files or
        one ZIP. Nothing goes into Billing until you approve it.
      </p>
      <details className="web-small">
        <summary>Supported files and limits</summary>
        <ul>
          {meta.formats.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <p>
          Up to {meta.limits.fileMb} MB per file, {meta.limits.batchFiles} files per import,{' '}
          {meta.limits.zipEntries} files per ZIP, {meta.limits.rows.toLocaleString()} rows per
          sheet.
        </p>
        <p>
          Reading scans with AI:{' '}
          {meta.aiReading ? 'on' : 'off (scans are entered by hand in review)'}. Virus scanner:{' '}
          {meta.virusScanner === 'noop'
            ? 'not set up; files are checked for dangerous content but not virus-scanned'
            : meta.virusScanner}
          .
        </p>
        <ul>
          {meta.knownLimits.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </details>
      <div className="cc-work-board__form">
        <label>
          Exported from
          <select
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            disabled={!!batchId}
          >
            {meta.platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          These are
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as typeof direction)}
            disabled={!!batchId}
          >
            <option value="auto">Let Curb Connect decide from the columns</option>
            <option value="receivable">Invoices I sent to customers</option>
            <option value="payable">Bills I received from vendors</option>
            <option value="mixed">A mix of both</option>
          </select>
        </label>
        <div
          className="web-card"
          role="button"
          tabIndex={0}
          aria-label="Choose files or drop them here"
          onClick={() => input.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') input.current?.click();
          }}
          onDragOver={(e: DragEvent) => e.preventDefault()}
          onDrop={(e: DragEvent) => {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }}
          style={{ textAlign: 'center', padding: '1.5rem', cursor: 'pointer' }}
        >
          <strong>Drop files here or click to choose</strong>
          <p className="web-muted web-small">CSV, TSV, XLSX, PDF, PNG, JPEG, WebP or ZIP</p>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            accept=".csv,.tsv,.txt,.xlsx,.pdf,.png,.jpg,.jpeg,.webp,.zip"
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        {queue.length > 0 && (
          <p className="web-small">
            {queue.length} file{queue.length === 1 ? '' : 's'} ready:{' '}
            {queue
              .slice(0, 6)
              .map((f) => f.name)
              .join(', ')}
            {queue.length > 6 ? '…' : ''}{' '}
            <button type="button" className="cc-btn" onClick={() => setQueue([])}>
              Clear
            </button>
          </p>
        )}
        <p>
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            disabled={
              !canWrite ||
              queue.length === 0 ||
              (progress !== null && progress.done < progress.total)
            }
            onClick={() => void upload(queue)}
          >
            {progress && progress.done < progress.total
              ? `Uploading ${progress.done + 1} of ${progress.total}…`
              : 'Upload and read'}
          </button>{' '}
          {failed.length > 0 && (
            <button type="button" className="cc-btn" onClick={() => input.current?.click()}>
              Choose the {failed.length} failed file{failed.length === 1 ? '' : 's'} again
            </button>
          )}{' '}
          {batchId && (
            <button
              type="button"
              className="cc-btn"
              onClick={() => {
                setBatchId(null);
                setResults([]);
                setProgress(null);
              }}
            >
              Start a new import
            </button>
          )}
        </p>
        {!canWrite && (
          <p className="web-denied-reason">Your role can view imports but not upload them.</p>
        )}
      </div>
      {error !== null && <ErrorNotice error={error} title="The import could not start" />}
      {results.length > 0 && (
        <div aria-live="polite">
          <h3>What was read</h3>
          <p className="web-small">
            {totals.records} records found · {totals.review} need a check · {totals.dups} possible
            duplicates.{' '}
            <button type="button" className="cc-btn cc-btn--primary" onClick={onReview}>
              Open the review queue
            </button>
          </p>
          <table className="web-small">
            <thead>
              <tr>
                <th>File</th>
                <th>Result</th>
                <th>Records</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={`${r.file}-${i}`}>
                  <td>{r.file}</td>
                  <td>
                    {r.status === 'extracted'
                      ? 'Read'
                      : r.status === 'needs_mapping'
                        ? 'Needs column matching'
                        : r.status === 'duplicate_file'
                          ? 'Already imported'
                          : r.status === 'upload_failed'
                            ? 'Upload failed'
                            : 'Not imported'}
                  </td>
                  <td>{r.records ?? '—'}</td>
                  <td>
                    {r.reason}
                    {r.status === 'needs_mapping' && r.fileId && (
                      <button
                        type="button"
                        className="cc-btn"
                        onClick={() => setMappingFile(r.fileId!)}
                      >
                        Match columns
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {mappingFile && (
        <MappingWizard
          fileId={mappingFile}
          fields={meta.fields}
          onDone={(n) => {
            setResults((rs) =>
              rs.map((r) =>
                r.fileId === mappingFile ? { ...r, status: 'extracted', records: n } : r,
              ),
            );
            setMappingFile(null);
            onDone();
          }}
          onCancel={() => setMappingFile(null)}
        />
      )}
    </section>
  );
}

function MappingWizard({
  fileId,
  fields,
  onDone,
  onCancel,
}: {
  fileId: string;
  fields: Meta['fields'];
  onDone: (records: number) => void;
  onCancel: () => void;
}) {
  const { api } = useApi();
  const { orgId } = useSession();
  const info = useQuery({
    queryKey: orgKey(orgId, 'invoice-intel', 'file', fileId),
    queryFn: async () =>
      (await api.get(`/v1/invoice-intel/files/${fileId}`)) as {
        file: { fileName: string; mapping: Record<string, number> | null };
        headers: string[];
        sample: string[][];
        rowCount: number;
      },
  });
  const [edited, setMap] = useState<Record<string, number> | null>(null);
  const map = edited ?? info.data?.file.mapping ?? {};
  const [dir, setDir] = useState<'auto' | 'receivable' | 'payable'>('auto');
  const [profile, setProfile] = useState('');
  const save = useMutation({
    mutationFn: async () =>
      (await api.put(`/v1/invoice-intel/files/${fileId}/mapping`, {
        mapping: map,
        direction: dir,
        ...(profile.trim() ? { saveProfileName: profile.trim() } : {}),
      })) as { records: number },
    onSuccess: (r) => onDone(r.records),
  });
  if (!info.data)
    return info.error ? (
      <ErrorNotice error={info.error} title="The file could not be loaded" />
    ) : (
      <p>Loading columns…</p>
    );
  const headers = info.data.headers;
  return (
    <section className="web-card" aria-labelledby="map-heading">
      <h3 id="map-heading">Match columns: {info.data.file.fileName}</h3>
      <p className="web-muted web-small">
        Pick which column holds each value. Customer or vendor, Total, and Invoice number or date
        are needed. {info.data.rowCount} rows.
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="web-small">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i}>{h || `Column ${i + 1}`}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {info.data.sample.map((r, i) => (
              <tr key={i}>
                {headers.map((_, j) => (
                  <td key={j}>{r[j]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        className="cc-work-board__form"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: '0.5rem',
        }}
      >
        {fields.map((f) => (
          <label key={f.key} className="web-small">
            {f.label}
            <select
              value={map[f.key] ?? ''}
              onChange={(e) =>
                setMap(() => {
                  const m = map;
                  const n = { ...m };
                  if (e.target.value === '') delete n[f.key];
                  else n[f.key] = Number(e.target.value);
                  return n;
                })
              }
            >
              <option value="">— not in this file —</option>
              {headers.map((h, i) => (
                <option key={i} value={i}>
                  {h || `Column ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <label className="web-small">
        These rows are
        <select value={dir} onChange={(e) => setDir(e.target.value as typeof dir)}>
          <option value="auto">Decide from the columns</option>
          <option value="receivable">Invoices sent to customers</option>
          <option value="payable">Bills received from vendors</option>
        </select>
      </label>
      <label className="web-small">
        Save this matching for next time as (optional)
        <input
          value={profile}
          maxLength={120}
          onChange={(e) => setProfile(e.target.value)}
          placeholder="e.g. QuickBooks bills export"
        />
      </label>
      {save.error && <ErrorNotice error={save.error} title="Matching was not saved" />}
      <p>
        <button
          type="button"
          className="cc-btn cc-btn--primary"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Reading rows…' : 'Read the file with this matching'}
        </button>{' '}
        <button type="button" className="cc-btn" onClick={onCancel}>
          Cancel
        </button>
      </p>
    </section>
  );
}

interface SavedView {
  name: string;
  q: string;
  direction: string;
  status: string;
  sort: string;
}
const VIEWS_KEY = 'cc.invoiceImports.views';
const loadViews = (): SavedView[] => {
  try {
    return JSON.parse(localStorage.getItem(VIEWS_KEY) ?? '[]') as SavedView[];
  } catch {
    return [];
  }
};

function RecordList({
  review,
  canWrite,
  selected,
  onSelect,
  onChanged,
}: {
  review: 'needs_review' | 'approved';
  canWrite: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChanged: () => void;
}) {
  const { api } = useApi();
  const { orgId } = useSession();
  const [q, setQ] = useState('');
  const [direction, setDirection] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState(review === 'needs_review' ? 'confidence' : 'date');
  const [reviewFilter, setReviewFilter] = useState<string>(review);
  const [page, setPage] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [views, setViews] = useState<SavedView[]>(() =>
    typeof window === 'undefined' ? [] : loadViews(),
  );
  const params = new URLSearchParams({
    review: reviewFilter,
    sort,
    limit: '50',
    offset: String(page * 50),
  });
  if (q.trim()) params.set('q', q.trim());
  if (direction) params.set('direction', direction);
  if (status) params.set('status', status);
  const list = useQuery({
    queryKey: orgKey(orgId, 'invoice-intel', 'records', params.toString()),
    queryFn: async () =>
      (await api.get(`/v1/invoice-intel/records?${params.toString()}`)) as {
        items: ImportedRecord[];
        total: number;
      },
  });
  const bulk = useMutation({
    mutationFn: async (action: 'approve_clean' | 'reject') =>
      (await api.post('/v1/invoice-intel/records/bulk', { ids: [...checked], action })) as {
        done: string[];
        skipped: { id: string; reason: string }[];
      },
    onSuccess: () => {
      setChecked(new Set());
      onChanged();
    },
  });
  const exportCsv = useMutation({
    mutationFn: async () => {
      const text = (await api.get(
        `/v1/invoice-intel/export.csv?view=imports&review=${reviewFilter}`,
      )) as string;
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-imports-${reviewFilter}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });
  const items = list.data?.items ?? [];
  const allChecked = items.length > 0 && items.every((r) => checked.has(r.id));

  return (
    <section className="web-section">
      <h2>{review === 'needs_review' ? 'Review queue' : 'Imported records'}</h2>
      <p className="web-muted web-small">
        {review === 'needs_review'
          ? 'Records sorted with the least certain first. Open one to compare it with the original, fix fields, then approve or reject. "Approve selected" only takes records with nothing left to check and 85% or higher confidence.'
          : 'Approved records. Customer invoices are also in Billing. Record payments on vendor bills here.'}
      </p>
      <div
        className="cc-work-board__form"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'end' }}
      >
        <label className="web-small">
          Search
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            placeholder="Party, number, project, category"
          />
        </label>
        <label className="web-small">
          Show
          <select
            value={reviewFilter}
            onChange={(e) => {
              setReviewFilter(e.target.value);
              setPage(0);
            }}
          >
            {review === 'needs_review' ? (
              <>
                <option value="needs_review">Needs review</option>
                <option value="duplicate">Possible duplicates</option>
                <option value="rejected">Rejected</option>
              </>
            ) : (
              <>
                <option value="approved">Imported</option>
                <option value="all">Everything</option>
              </>
            )}
          </select>
        </label>
        <label className="web-small">
          Sent or received
          <select value={direction} onChange={(e) => setDirection(e.target.value)}>
            <option value="">All</option>
            <option value="receivable">Sent to customers</option>
            <option value="payable">Received from vendors</option>
            <option value="unknown">Not sure</option>
          </select>
        </label>
        <label className="web-small">
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any</option>
            {['open', 'partially_paid', 'paid', 'overdue', 'void', 'disputed', 'written_off'].map(
              (s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="web-small">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="confidence">Least certain first</option>
            <option value="date">Newest date</option>
            <option value="total">Largest total</option>
            <option value="party">Party A–Z</option>
          </select>
        </label>
        <label className="web-small">
          Saved views
          <select
            value=""
            onChange={(e) => {
              const v = views.find((x) => x.name === e.target.value);
              if (v) {
                setQ(v.q);
                setDirection(v.direction);
                setStatus(v.status);
                setSort(v.sort);
              }
            }}
          >
            <option value="">Choose…</option>
            {views.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="cc-btn"
          onClick={() => {
            const name = window.prompt('Name this view');
            if (!name) return;
            const next = [
              ...views.filter((v) => v.name !== name),
              { name: name.slice(0, 60), q, direction, status, sort },
            ].slice(-20);
            setViews(next);
            try {
              localStorage.setItem(VIEWS_KEY, JSON.stringify(next));
            } catch {
              /* storage off */
            }
          }}
        >
          Save view
        </button>
        <button
          type="button"
          className="cc-btn"
          disabled={exportCsv.isPending}
          onClick={() => exportCsv.mutate()}
        >
          Export CSV
        </button>
      </div>
      {canWrite && checked.size > 0 && (
        <p className="web-small">
          {checked.size} selected:{' '}
          {review === 'needs_review' && (
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              disabled={bulk.isPending}
              onClick={() => bulk.mutate('approve_clean')}
            >
              Approve selected
            </button>
          )}{' '}
          <button
            type="button"
            className="cc-btn"
            disabled={bulk.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `Reject ${checked.size} records? They stay in history and can be reopened by editing.`,
                )
              )
                bulk.mutate('reject');
            }}
          >
            Reject selected
          </button>
        </p>
      )}
      {bulk.data && (
        <p className="web-small" aria-live="polite">
          Done: {bulk.data.done.length}. Skipped: {bulk.data.skipped.length}
          {bulk.data.skipped.length > 0 &&
            ` (${[...new Set(bulk.data.skipped.map((s) => s.reason))].join(' ')})`}
        </p>
      )}
      {list.error && (
        <ErrorNotice
          error={list.error}
          title="Records could not be loaded"
          onRetry={() => void list.refetch()}
        />
      )}
      {list.data && items.length === 0 && (
        <p className="web-muted">
          {review === 'needs_review' ? 'Nothing waiting for review.' : 'No imported records yet.'}
        </p>
      )}
      {items.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="web-small">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allChecked}
                    onChange={(e) =>
                      setChecked(e.target.checked ? new Set(items.map((r) => r.id)) : new Set())
                    }
                  />
                </th>
                <th>Number</th>
                <th>Party</th>
                <th>Sent / received</th>
                <th>Date</th>
                <th>Total</th>
                <th>Status</th>
                <th>Category</th>
                <th>Confidence</th>
                <th>To check</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} aria-selected={selected === r.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${r.invoiceNumber ?? r.id}`}
                      checked={checked.has(r.id)}
                      onChange={(e) =>
                        setChecked((s) => {
                          const n = new Set(s);
                          if (e.target.checked) n.add(r.id);
                          else n.delete(r.id);
                          return n;
                        })
                      }
                    />
                  </td>
                  <td>
                    <button type="button" className="cc-btn" onClick={() => onSelect(r.id)}>
                      {r.invoiceNumber ?? 'No number'}
                    </button>
                  </td>
                  <td>{r.partyName ?? '—'}</td>
                  <td>
                    {DIRECTION_LABEL[r.direction]}
                    {r.docType !== 'invoice' ? ` · ${r.docType.replace('_', ' ')}` : ''}
                  </td>
                  <td>{r.issueDate ?? '—'}</td>
                  <td>{fmtMoney(r.totalMinor, r.currency)}</td>
                  <td>{r.status.replace('_', ' ')}</td>
                  <td>{r.category ?? '—'}</td>
                  <td>{pct(r.sourceMeta.confidence)}</td>
                  <td>
                    {REVIEW_LABEL[r.reviewStatus]}
                    {r.reviewReasons.length
                      ? `: ${r.reviewReasons[0]}${r.reviewReasons.length > 1 ? ` (+${r.reviewReasons.length - 1})` : ''}`
                      : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="web-small">
            {page * 50 + 1}–{page * 50 + items.length} of {list.data?.total ?? 0}{' '}
            <button
              type="button"
              className="cc-btn"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>{' '}
            <button
              type="button"
              className="cc-btn"
              disabled={(page + 1) * 50 >= (list.data?.total ?? 0)}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </p>
        </div>
      )}
      {selected && (
        <RecordDetail
          key={selected}
          id={selected}
          canWrite={canWrite}
          onClose={() => onSelect(null)}
          onChanged={onChanged}
        />
      )}
    </section>
  );
}

function RecordDetail({
  id,
  canWrite,
  onClose,
  onChanged,
}: {
  id: string;
  canWrite: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { api } = useApi();
  const { orgId } = useSession();
  const qc = useQueryClient();
  const key = orgKey(orgId, 'invoice-intel', 'record', id);
  const detail = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await api.get(`/v1/invoice-intel/records/${id}`)) as {
        record: ImportedRecord;
        payments: {
          id: string;
          paidOn: string;
          amountMinor: number;
          method: string | null;
          reference: string | null;
        }[];
        file: { id: string; fileName: string; kind: string; hasOriginal: boolean } | null;
      },
  });
  const rec = detail.data?.record;
  const [edits, setForm] = useState<Record<string, string>>({});
  const [override, setOverride] = useState('');
  const [pay, setPay] = useState({
    paidOn: new Date().toISOString().slice(0, 10),
    amount: '',
    method: '',
    reference: '',
  });
  const m = (v: number | null) => (v === null ? '' : (v / 100).toFixed(2));
  const base: Record<string, string> = rec
    ? {
        direction: rec.direction,
        docType: rec.docType,
        invoiceNumber: rec.invoiceNumber ?? '',
        partyName: rec.partyName ?? '',
        issueDate: rec.issueDate ?? '',
        dueDate: rec.dueDate ?? '',
        currency: rec.currency,
        subtotal: m(rec.subtotalMinor),
        tax: m(rec.taxMinor),
        total: m(rec.totalMinor),
        paid: m(rec.amountPaidMinor),
        category: rec.category ?? '',
        projectLabel: rec.projectLabel ?? '',
        location: rec.location ?? '',
        costCode: rec.costCode ?? '',
      }
    : {};
  const form: Record<string, string> = { ...base, ...edits };
  const after = () => {
    setForm({});
    void qc.invalidateQueries({ queryKey: key });
    onChanged();
  };
  const save = useMutation({
    mutationFn: async () => {
      const money = (k: string) => {
        const v = toMinor(form[k] ?? '');
        if (Number.isNaN(v)) throw new Error(`${k} is not a number`);
        return v;
      };
      const body: Record<string, unknown> = {
        invoiceNumber: form.invoiceNumber || null,
        partyName: form.partyName || null,
        issueDate: form.issueDate || null,
        dueDate: form.dueDate || null,
        currency: (form.currency ?? 'USD').toUpperCase(),
        subtotalMinor: money('subtotal'),
        taxMinor: money('tax'),
        totalMinor: money('total'),
        amountPaidMinor: Math.max(0, money('paid') ?? 0),
        category: form.category || null,
        projectLabel: form.projectLabel || null,
        location: form.location || null,
        costCode: form.costCode || null,
        docType: form.docType,
      };
      if (form.direction === 'receivable' || form.direction === 'payable')
        body.direction = form.direction;
      return api.patch(`/v1/invoice-intel/records/${id}`, body);
    },
    onSuccess: after,
  });
  const approve = useMutation({
    mutationFn: () =>
      api.post(
        `/v1/invoice-intel/records/${id}/approve`,
        override.trim() ? { overrideReason: override.trim() } : {},
      ),
    onSuccess: after,
  });
  const reject = useMutation({
    mutationFn: () =>
      api.post(`/v1/invoice-intel/records/${id}/reject`, { reason: 'Rejected in review' }),
    onSuccess: after,
  });
  const addPay = useMutation({
    mutationFn: () =>
      api.post(`/v1/invoice-intel/records/${id}/payments`, {
        paidOn: pay.paidOn,
        amountMinor: toMinor(pay.amount),
        method: pay.method || null,
        reference: pay.reference || null,
      }),
    onSuccess: () => {
      setPay((p) => ({ ...p, amount: '', reference: '' }));
      after();
    },
  });
  const original = useMutation({
    mutationFn: async () =>
      (await api.get(`/v1/invoice-intel/files/${detail.data!.file!.id}/original`)) as {
        url: string;
      },
    onSuccess: (r) => window.open(r.url, '_blank', 'noopener,noreferrer'),
  });
  if (!rec)
    return detail.error ? (
      <ErrorNotice error={detail.error} title="The record could not be loaded" />
    ) : (
      <p>Loading…</p>
    );
  const editable = canWrite && rec.reviewStatus !== 'approved';
  const field = (k: string, label: string, evKey: string, type = 'text') => {
    const ev = rec.fields[evKey];
    return (
      <label className="web-small" key={k}>
        {label}
        {ev ? (
          <span className="web-muted">
            {' '}
            · {pct(ev.confidence)} from {ev.source}
            {ev.raw && String(ev.raw) !== String(ev.value ?? '')
              ? ` (“${String(ev.raw).slice(0, 40)}”)`
              : ''}
          </span>
        ) : null}
        <input
          type={type}
          value={form[k] ?? ''}
          disabled={!editable}
          onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
          style={ev && ev.confidence < 0.7 ? { outline: '2px solid #d97706' } : undefined}
        />
      </label>
    );
  };
  const invoiceId = rec.sourceMeta.invoiceId;
  return (
    <section className="web-card" aria-labelledby="rec-heading">
      <h3 id="rec-heading">
        {rec.invoiceNumber ?? 'Record'} · {REVIEW_LABEL[rec.reviewStatus]}
      </h3>
      <p className="web-small">
        {detail.data?.file && <>From {detail.data.file.fileName}. </>}
        {detail.data?.file?.hasOriginal && (
          <button type="button" className="cc-btn" onClick={() => original.mutate()}>
            Open the original
          </button>
        )}{' '}
        {invoiceId && <Link href={`/billing/invoices/${invoiceId}`}>Open in Billing</Link>}{' '}
        <button type="button" className="cc-btn" onClick={onClose}>
          Close
        </button>
      </p>
      {rec.reviewReasons.length > 0 && (
        <div className="web-small" role="note">
          <strong>Check these:</strong>
          <ul>
            {rec.reviewReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: '0.5rem',
        }}
      >
        <label className="web-small">
          Sent or received
          <select
            value={form.direction ?? 'unknown'}
            disabled={!editable}
            onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))}
          >
            <option value="unknown" disabled>
              Not sure
            </option>
            <option value="receivable">Sent to a customer</option>
            <option value="payable">Received from a vendor</option>
          </select>
        </label>
        <label className="web-small">
          Document type
          <select
            value={form.docType ?? 'invoice'}
            disabled={!editable}
            onChange={(e) => setForm((f) => ({ ...f, docType: e.target.value }))}
          >
            {['invoice', 'credit_note', 'debit_note', 'receipt', 'statement', 'other'].map((t) => (
              <option key={t} value={t}>
                {t.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        {field('invoiceNumber', 'Invoice number', 'invoiceNumber')}
        {field('partyName', 'Customer or vendor', 'partyName')}
        {field('issueDate', 'Invoice date', 'issueDate', 'date')}
        {field('dueDate', 'Due date', 'dueDate', 'date')}
        {field('currency', 'Currency', 'currency')}
        {field('subtotal', 'Subtotal', 'subtotal')}
        {field('tax', 'Tax', 'tax')}
        {field('total', 'Total', 'total')}
        {field('paid', 'Amount paid', 'amountPaid')}
        {field('category', 'Category', 'category')}
        {field('projectLabel', 'Project / job', 'project')}
        {field('location', 'Location', 'location')}
        {field('costCode', 'Cost code', 'costCode')}
      </div>
      {rec.lines.length > 0 && (
        <details className="web-small">
          <summary>{rec.lines.length} line items</summary>
          <table>
            <thead>
              <tr>
                <th>Description</th>
                <th>Qty</th>
                <th>Rate</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {rec.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.description}</td>
                  <td>{l.quantity ?? ''}</td>
                  <td>{fmtMoney(l.rateMinor, rec.currency)}</td>
                  <td>{fmtMoney(l.amountMinor, rec.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {[save.error, approve.error, reject.error, addPay.error, original.error]
        .filter(Boolean)
        .map((e, i) => (
          <ErrorNotice key={i} error={e} title="That did not work" />
        ))}
      {editable && (
        <p>
          <button
            type="button"
            className="cc-btn"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            Save corrections
          </button>{' '}
          {rec.reviewStatus === 'duplicate' && (
            <label className="web-small">
              Why import it anyway
              <input
                value={override}
                onChange={(e) => setOverride(e.target.value)}
                placeholder="e.g. Different job, same number"
              />
            </label>
          )}{' '}
          <button
            type="button"
            className="cc-btn cc-btn--primary"
            disabled={approve.isPending}
            onClick={() => approve.mutate()}
          >
            Approve
          </button>{' '}
          <button
            type="button"
            className="cc-btn"
            disabled={reject.isPending}
            onClick={() => reject.mutate()}
          >
            Reject
          </button>
        </p>
      )}
      {rec.reviewStatus === 'approved' && !invoiceId && (
        <div>
          <h4>Payments</h4>
          <ul className="web-small">
            {(detail.data?.payments ?? []).map((p) => (
              <li key={p.id}>
                {p.paidOn}: {fmtMoney(p.amountMinor, rec.currency)}
                {p.method ? ` by ${p.method}` : ''}
                {p.reference ? ` (${p.reference})` : ''}
              </li>
            ))}
            {(detail.data?.payments ?? []).length === 0 && <li>No payments recorded.</li>}
          </ul>
          <p className="web-small">
            Balance:{' '}
            {fmtMoney(
              Math.max(0, Math.abs(rec.totalMinor ?? 0) - rec.amountPaidMinor),
              rec.currency,
            )}{' '}
            · Status: {rec.status.replace('_', ' ')}
          </p>
          {canWrite && (
            <div
              className="cc-work-board__form"
              style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}
            >
              <label className="web-small">
                Date
                <input
                  type="date"
                  value={pay.paidOn}
                  onChange={(e) => setPay((p) => ({ ...p, paidOn: e.target.value }))}
                />
              </label>
              <label className="web-small">
                Amount
                <input
                  value={pay.amount}
                  onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value }))}
                  inputMode="decimal"
                />
              </label>
              <label className="web-small">
                Method
                <input
                  value={pay.method}
                  onChange={(e) => setPay((p) => ({ ...p, method: e.target.value }))}
                  placeholder="Check, ACH, card"
                />
              </label>
              <label className="web-small">
                Reference
                <input
                  value={pay.reference}
                  onChange={(e) => setPay((p) => ({ ...p, reference: e.target.value }))}
                />
              </label>
              <button
                type="button"
                className="cc-btn"
                disabled={addPay.isPending || !(toMinor(pay.amount) ?? 0)}
                onClick={() => addPay.mutate()}
              >
                Record payment
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function History({ onOpenBatch }: { onOpenBatch: () => void }) {
  const { api } = useApi();
  const { orgId } = useSession();
  const batches = useQuery({
    queryKey: orgKey(orgId, 'invoice-intel', 'batches'),
    queryFn: async () => (await api.get('/v1/invoice-intel/batches')) as { items: Batch[] },
  });
  const rows = useMemo(() => batches.data?.items ?? [], [batches.data]);
  return (
    <section className="web-section">
      <h2>Import history</h2>
      {batches.error && (
        <ErrorNotice
          error={batches.error}
          title="History could not be loaded"
          onRetry={() => void batches.refetch()}
        />
      )}
      {rows.length === 0 && batches.data && <p className="web-muted">No imports yet.</p>}
      {rows.map((b) => (
        <details key={b.id} className="web-card">
          <summary>
            {new Date(b.createdAt).toLocaleString('en-US')} · {b.sourcePlatform} ·{' '}
            {b.status.replace(/_/g, ' ')} · {b.fileCount} files · {b.recordCount} records ·{' '}
            {b.importedCount} imported · {b.needsReviewCount} to review · {b.duplicateCount}{' '}
            duplicates · {b.rejectedCount} files not imported
          </summary>
          <ul className="web-small">
            {b.files.map((f) => (
              <li key={f.id}>
                {f.fileName} ({Math.ceil(f.byteSize / 1024)} KB, {f.kind}):{' '}
                {f.status.replace(/_/g, ' ')}
                {f.rejectReason ? ` — ${f.rejectReason}` : ''}
              </li>
            ))}
          </ul>
          {b.needsReviewCount > 0 && (
            <button type="button" className="cc-btn" onClick={onOpenBatch}>
              Review these records
            </button>
          )}
        </details>
      ))}
    </section>
  );
}
