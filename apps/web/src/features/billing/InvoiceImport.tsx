'use client';

// "Import invoices": bring invoices over from another invoice app with a CSV export or by
// pasting rows copied from a spreadsheet. The file is read by the bulk import engine
// (Invoice Intelligence) with the column matches chosen here, and the records land in the
// import review queue — nothing is emailed to anyone and nothing enters Billing until approved.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState, type ChangeEvent } from 'react';
import { errorHint } from '../../lib/api';
import { useApi } from '../../lib/session';
import { importViaBulkEngine } from './bulkImport';
import {
  type ColumnMap,
  IMPORT_FIELDS,
  type ImportField,
  buildInvoices,
  guessColumns,
  parseDelimited,
} from './invoiceImport';

const SOURCES = [
  'Invoice Simple',
  'QuickBooks',
  'FreshBooks',
  'Wave',
  'Square',
  'Zoho Invoice',
  'Stripe',
  'PayPal',
  'Excel or Google Sheets',
  'Other',
];

const money = (minor: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);

export function InvoiceImport({ onClose }: { onClose: () => void }) {
  const { api } = useApi();
  const queryClient = useQueryClient();
  const [source, setSource] = useState(SOURCES[0]!);
  const [otherSource, setOtherSource] = useState('');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [map, setMap] = useState<ColumnMap>({});
  const [fileError, setFileError] = useState<string | null>(null);

  const rows = useMemo(() => (text.trim() ? parseDelimited(text) : []), [text]);
  const headers = rows[0] ?? [];
  const body = rows.slice(1);
  const preview = useMemo(() => buildInvoices(body, map), [body, map]);
  const missing = IMPORT_FIELDS.filter((f) => f.required && map[f.key] === undefined);
  const sourceName = source === 'Other' ? otherSource.trim() || 'Other app' : source;

  function load(newText: string) {
    setText(newText);
    const parsed = newText.trim() ? parseDelimited(newText) : [];
    setMap(parsed[0] ? guessColumns(parsed[0]) : {});
    run.reset();
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    setFileError(null);
    if (!file) return;
    if (/\.(xlsx?|numbers|pdf)$/i.test(file.name)) {
      setFileError(
        'This is not a CSV file. Open it in Excel or Google Sheets and save or download it as CSV, or copy the rows and paste them below.',
      );
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setFileError('That file is larger than 12 MB. Split it into smaller files or ZIP it.');
      return;
    }
    setFileName(file.name);
    setPickedFile(file);
    void file.text().then(load);
  }

  const run = useMutation({
    mutationFn: async () => {
      // The bulk engine reads the original file (or the pasted rows as a CSV file) with the
      // column matches from the preview; records wait in the review queue for approval.
      const file = pickedFile ?? new File([text], 'pasted-invoices.csv', { type: 'text/csv' });
      return importViaBulkEngine(api, { source: sourceName, file, map });
    },
    onSuccess: () => void queryClient.invalidateQueries(),
  });

  return (
    <section className="ie-import" aria-label="Import invoices from another app">
      <div className="ie-import-head">
        <h2>Import invoices from another app</h2>
        <button type="button" className="ie-btn" onClick={onClose}>
          Close
        </button>
      </div>
      <ol className="ie-import-steps">
        <li>
          In your old invoice app, export or download your invoices as a CSV file. Most apps have an
          Export or Download option on their invoice list or reports page.
        </li>
        <li>
          Upload that file here, or copy the rows from a spreadsheet and paste them in the box.
        </li>
        <li>Check the column matches and the preview, then press Import.</li>
      </ol>
      <p className="ie-muted">
        The bulk import engine reads the file with your column matches and puts every invoice in the
        review queue. Nothing is emailed to your clients, and nothing enters Billing until you
        approve it. Importing the same file again is flagged as a duplicate.
      </p>

      <div className="ie-import-grid">
        <label>
          <span>Coming from</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {SOURCES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        {source === 'Other' && (
          <label>
            <span>App name</span>
            <input
              value={otherSource}
              maxLength={60}
              placeholder="Name of the app"
              onChange={(e) => setOtherSource(e.target.value)}
            />
          </label>
        )}
        <label className="ie-btn ie-file">
          Upload CSV file
          <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden onChange={onFile} />
        </label>
        {fileName && <span className="ie-muted">Loaded {fileName}</span>}
      </div>
      {fileError && (
        <p className="web-error" role="alert">
          {fileError}
        </p>
      )}

      <label className="ie-paste">
        <span>Or paste rows here (include the header row)</span>
        <textarea
          rows={6}
          value={text}
          placeholder={
            'Invoice Number,Client,Date,Status,Total\nINV0001,Jane Smith,11/01/2026,Paid,1250.00'
          }
          onChange={(e) => {
            setPickedFile(null);
            setFileName(null);
            load(e.target.value);
          }}
        />
      </label>

      {headers.length > 0 && (
        <>
          <h3>Match your columns</h3>
          <div className="ie-map">
            {IMPORT_FIELDS.map((f) => (
              <label key={f.key}>
                <span>
                  {f.label}
                  {f.required ? ' *' : ''}
                </span>
                <select
                  value={map[f.key] ?? ''}
                  onChange={(e) =>
                    setMap((m) => {
                      const next = { ...m };
                      if (e.target.value === '') delete next[f.key as ImportField];
                      else next[f.key as ImportField] = Number(e.target.value);
                      return next;
                    })
                  }
                >
                  <option value="">Not in my file</option>
                  {headers.map((h, i) => (
                    <option key={`${h}-${i}`} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {missing.length > 0 && (
            <p className="web-error" role="alert">
              Choose a column for: {missing.map((m) => m.label).join(', ')}.
            </p>
          )}

          {missing.length === 0 && (
            <>
              <h3>
                Preview: {preview.invoices.length} invoice
                {preview.invoices.length === 1 ? '' : 's'} from {body.length} row
                {body.length === 1 ? '' : 's'}
              </h3>
              {preview.problems.length > 0 && (
                <details className="ie-import-problems">
                  <summary>{preview.problems.length} row(s) will be left out</summary>
                  <ul>
                    {preview.problems.slice(0, 50).map((p) => (
                      <li key={`${p.row}-${p.message}`}>
                        Row {p.row}: {p.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="ie-import-table">
                <table>
                  <thead>
                    <tr>
                      <th>Number</th>
                      <th>Client</th>
                      <th>Date</th>
                      <th>Status</th>
                      <th className="ie-num">Total</th>
                      <th className="ie-num">Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.invoices.slice(0, 20).map((inv) => (
                      <tr key={inv.number}>
                        <td>{inv.number}</td>
                        <td>{inv.clientName}</td>
                        <td>{inv.issuedOn ?? '—'}</td>
                        <td>{inv.status.replace('_', ' ')}</td>
                        <td className="ie-num">{money(inv.totalMinor)}</td>
                        <td className="ie-num">{money(inv.amountPaidMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.invoices.length > 20 && <p className="ie-muted">Showing the first 20.</p>}
              </div>
              <button
                type="button"
                className="ie-btn ie-btn--dark"
                disabled={preview.invoices.length === 0 || run.isPending || run.isSuccess}
                onClick={() => run.mutate()}
              >
                {run.isPending
                  ? 'Importing…'
                  : `Import ${preview.invoices.length} invoice${preview.invoices.length === 1 ? '' : 's'}`}
              </button>
            </>
          )}
        </>
      )}

      {run.error && (
        <p className="web-error" role="alert">
          The import stopped. {errorHint(run.error)} Nothing was added to Billing; fix the file and
          run the import again.
        </p>
      )}
      {run.data && (
        <div className="ie-done" role="status">
          <p>
            The bulk engine read {run.data.records} invoice{run.data.records === 1 ? '' : 's'} from{' '}
            {sourceName}
            {run.data.needsReview > 0 && ` — ${run.data.needsReview} need your review`}
            {run.data.duplicates > 0 && `, ${run.data.duplicates} flagged as duplicates`}. Approve
            them in the <Link href="/billing/imports">import review queue</Link> to add them to{' '}
            <Link href="/billing">Billing</Link>.
          </p>
        </div>
      )}
    </section>
  );
}
