'use client';

import type { IssuedInvoice } from '@fieldline/contracts';
import { useState } from 'react';
import {
  invoiceComposeUrl,
  invoiceCsv,
  invoiceSummary,
  safeFilename,
  validateInstructionFile,
  type EmailProvider,
} from './invoiceTools';

function downloadText(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function InvoiceOperations({ invoices }: { invoices: readonly IssuedInvoice[] }) {
  const [selectedId, setSelectedId] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [provider, setProvider] = useState<EmailProvider>('default');
  const [error, setError] = useState('');
  const [instructions, setInstructions] = useState<{ name: string; contents: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const invoice = invoices.find((item) => item.id === selectedId) ?? invoices[0] ?? null;

  const startCompose = () => {
    if (!invoice) return;
    try {
      const url = invoiceComposeUrl(provider, invoice, recipientEmail);
      setError('');
      // A user gesture opens their email provider. No message is sent by the application.
      if (provider === 'default') {
        window.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare the email.');
    }
  };

  const importInstructions = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    const validationError = validateInstructionFile(file.name, file.size);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    try {
      const contents = await file.text();
      if (file.name.toLowerCase().endsWith('.json')) {
        JSON.parse(contents);
      }
      setInstructions({ name: file.name, contents: contents.slice(0, 100_000) });
    } catch {
      setError('The selected file could not be read or contains invalid JSON.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="web-card invoice-studio" aria-labelledby="invoice-studio-title">
      <div className="invoice-studio__heading">
        <div>
          <p className="invoice-studio__eyebrow">ConstructionOS // Invoicing</p>
          <h2 id="invoice-studio-title">Invoice delivery & imports</h2>
          <p className="web-muted">
            Export real company invoices and prepare email drafts for customers outside the Field Pro
            network. Existing billing approvals and ledger records remain authoritative.
          </p>
        </div>
        <span className="invoice-studio__badge">Manual send · no mailbox connected</span>
      </div>
      <div className="invoice-studio__columns">
        <div className="invoice-studio__panel">
          <h3>01 — Select an existing invoice</h3>
          <label className="invoice-studio__field">
            <span>Invoice</span>
            <select
              value={invoice?.id ?? ''}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setShowPreview(false);
                setError('');
              }}
              disabled={invoices.length === 0}
            >
              {invoices.length === 0 && <option value="">Create an invoice above first</option>}
              {invoices.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.number} · {item.recipientName ?? 'Recipient'} · {item.currency}{' '}
                  {(item.totalMinor / 100).toFixed(2)}
                </option>
              ))}
            </select>
          </label>
          {invoice && (
            <>
              <div className="invoice-studio__summary">
                <span>{invoice.number} · {invoice.deliveryStatus}</span>
                <strong>
                  {new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: invoice.currency,
                  }).format(invoice.totalMinor / 100)}
                </strong>
                <span>Due {invoice.dueOn ?? 'not specified'} · {invoice.lines.length} line(s)</span>
              </div>
              <div className="invoice-studio__actions">
                <button type="button" onClick={() => setShowPreview((value) => !value)}>
                  {showPreview ? 'Hide preview' : 'Preview invoice'}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadText(safeFilename(invoice.number) + '.csv', invoiceCsv(invoice), 'text/csv')
                  }
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadText(safeFilename(invoice.number) + '.txt', invoiceSummary(invoice), 'text/plain')
                  }
                >
                  Download summary
                </button>
              </div>
              {showPreview && (
                <pre className="invoice-studio__preview" aria-label="Invoice detail preview">
                  {invoiceSummary(invoice)}
                </pre>
              )}
            </>
          )}
        </div>
        <div className="invoice-studio__panel">
          <h3>02 — Compose outbound email</h3>
          <label className="invoice-studio__field">
            <span>Recipient email address</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={recipientEmail}
              maxLength={254}
              onChange={(event) => setRecipientEmail(event.target.value)}
              placeholder="accounts@customer.com"
            />
          </label>
          <label className="invoice-studio__field">
            <span>Send using</span>
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value as EmailProvider)}
            >
              <option value="default">Device email application</option>
              <option value="gmail">Gmail compose</option>
              <option value="outlook">Outlook / Microsoft 365 compose</option>
            </select>
          </label>
          <button
            className="invoice-studio__primary"
            type="button"
            disabled={!invoice || !recipientEmail.trim()}
            onClick={startCompose}
          >
            Open prefilled email draft ↗
          </button>
          <p className="invoice-studio__note">
            You must review the message and press Send in Gmail, Outlook or your mail app. This does
            not connect to your mailbox, attach a PDF, send automatically, or record email delivery.
            Download the invoice summary above if you need to attach it.
          </p>
        </div>
      </div>

      <div className="invoice-studio__panel invoice-studio__import">
        <h3>03 — Import instructions from another application</h3>
        <p className="web-muted">
          Review job notes, CSV exports and structured JSON instructions locally before manually
          applying them to a Field Pro invoice or project. Imported files do not alter your ledger.
        </p>
        <label className="invoice-studio__field">
          <span>Choose TXT, Markdown, CSV or JSON (max 1 MB)</span>
          <input
            type="file"
            accept=".txt,.md,.csv,.json,text/plain,text/csv,application/json"
            disabled={busy}
            onChange={(event) => void importInstructions(event.target.files?.[0])}
          />
        </label>
        {instructions && (
          <div className="invoice-studio__imported">
            <strong>{instructions.name} · local preview</strong>
            <pre className="invoice-studio__preview">{instructions.contents}</pre>
            <button type="button" onClick={() => setInstructions(null)}>Clear imported preview</button>
          </div>
        )}
      </div>
      {error && <p className="web-error" role="alert">{error}</p>}
    </section>
  );
}
