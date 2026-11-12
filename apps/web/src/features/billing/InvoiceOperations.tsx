'use client';

import type { IssuedInvoice } from '@fieldline/contracts';
import { useState } from 'react';
import { useAccountDraft } from '../../lib/accountDrafts';
import { InvoicePrint } from './InvoicePrint';
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

type RecentRecipient = { name: string; email: string; usedAt: string };

export function InvoiceOperations({ invoices, companyName }: { invoices: readonly IssuedInvoice[]; companyName: string }) {
  const [selectedId, setSelectedId] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientCompany, setRecipientCompany] = useState('');
  const [recentRecipients, setRecentRecipients] = useState<RecentRecipient[]>([]);
  const contactsDraft = useAccountDraft({
    key: 'invoice-contacts', value: { recentRecipients }, legacyKey: '__no_legacy_invoice_contacts__',
    onRestore: (saved) => {
      if (Array.isArray(saved.recentRecipients)) {
        setRecentRecipients(saved.recentRecipients.filter((item): item is RecentRecipient =>
          Boolean(item && typeof item.email === 'string' && typeof item.name === 'string' &&
            typeof item.usedAt === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(item.email)),
        ).slice(0, 15));
      }
    },
  });
  const [provider, setProvider] = useState<EmailProvider>('default');
  const [error, setError] = useState('');
  const [instructions, setInstructions] = useState<{ name: string; contents: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const invoice = invoices.find((item) => item.id === selectedId) ?? invoices[0] ?? null;

  const rememberRecipient = () => {
    const email = recipientEmail.trim();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
      setError('Enter a valid recipient email address before saving.');
      return false;
    }
    const name = recipientCompany.trim() || invoice?.recipientName || email;
    setRecentRecipients((previous) => [
      { name: name.slice(0, 120), email: email.slice(0, 254), usedAt: new Date().toISOString() },
      ...previous.filter((item) => item.email.toLowerCase() !== email.toLowerCase()),
    ].slice(0, 15));
    setError('');
    return true;
  };
  const startCompose = (using: EmailProvider = provider) => {
    if (!invoice) { setError('Create an invoice before opening an email draft.'); return; }
    try {
      const url = invoiceComposeUrl(using, invoice, recipientEmail);
      rememberRecipient();
      setError('');
      // A user gesture opens their email provider. No message is sent by the application.
      if (using === 'default') {
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
                  {showPreview ? 'Hide text view' : 'Show text view'}
                </button>
                <button type="button" onClick={() => window.print()}>
                  Print / save as PDF
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
          <div className="invoice-studio__contact-grid">
            <div>
              <label className="invoice-studio__field">
                <span>Recipient company</span>
                <input type="text" maxLength={120} value={recipientCompany}
                  onChange={(event) => setRecipientCompany(event.target.value)}
                  placeholder={invoice?.recipientName ?? 'Company name'} />
              </label>
              <label className="invoice-studio__field">
                <span>Recipient email address</span>
                <input type="email" inputMode="email" autoComplete="email"
                  value={recipientEmail} maxLength={254}
                  onChange={(event) => setRecipientEmail(event.target.value)}
                  placeholder="accounts@customer.com" />
              </label>
              <button type="button" onClick={rememberRecipient}
                disabled={!recipientEmail.trim() || !contactsDraft.ready}>
                Save company to recent recipients
              </button>
            </div>
            <aside className="invoice-studio__recents" aria-label="Recently used recipient companies">
              <strong>Recent companies</strong>
              <p className="web-muted web-small">Tap a company to fill its email. Saved privately to your signed-in account.</p>
              {recentRecipients.length === 0 ? <p className="web-muted web-small">No recent companies saved.</p> :
                recentRecipients.map((contact) => <button type="button" key={contact.email}
                  onClick={() => { setRecipientEmail(contact.email); setRecipientCompany(contact.name); setError(''); }}>
                  <strong>{contact.name}</strong><small>{contact.email}</small>
                </button>)}
              <p className="web-muted web-small" role="status">
                Recent contacts: {contactsDraft.status === 'saved' ? 'saved to account' :
                  contactsDraft.status === 'saving' ? 'saving…' :
                  contactsDraft.status === 'loading' ? 'loading…' :
                  contactsDraft.status === 'error' || contactsDraft.status === 'conflict'
                    ? 'sync needs attention' : 'pending save'}.
                {contactsDraft.message && <> {contactsDraft.message}</>}
              </p>
              {(contactsDraft.status === 'error' || contactsDraft.status === 'conflict') &&
                <button type="button" onClick={contactsDraft.reload}>Reload saved contacts</button>}
            </aside>
          </div>
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
            onClick={() => startCompose()}
          >
            Open prefilled email draft ↗
          </button>
          <div className="invoice-studio__provider-shortcuts" aria-label="Choose email app">
            <button type="button" disabled={!invoice || !recipientEmail.trim()} onClick={() => startCompose('gmail')}>Open Gmail draft</button>
            <button type="button" disabled={!invoice || !recipientEmail.trim()} onClick={() => startCompose('outlook')}>Open Outlook draft</button>
            <button type="button" disabled={!invoice || !recipientEmail.trim()} onClick={() => startCompose('default')}>Open device Mail draft</button>
          </div>
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
      {invoice && <InvoicePrint invoice={invoice} companyName={companyName} />}
      {error && <p className="web-error" role="alert">{error}</p>}
    </section>
  );
}
