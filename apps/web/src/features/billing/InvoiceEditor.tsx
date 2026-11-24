'use client';

// Invoice Dashboard: make an invoice for any customer, preview it, print it as a PDF, save it,
// email it, or import invoices from another invoice app. Every saved, sent or imported invoice
// shows up in Billing, which is the history.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { errorHint, newIdempotencyKey } from '../../lib/api';
import { useApi, useSession } from '../../lib/session';
import type { InvoiceClient } from '@fieldline/contracts';
import { InvoiceImport } from './InvoiceImport';
import {
  type DraftLine,
  type DraftParty,
  type DraftPayment,
  type DraftState,
  EMPTY_PARTY,
  LINE_TEXT_LIMIT,
  TERMS,
  addDays,
  cleanQty,
  draftDiscount,
  draftFromInvoice,
  draftPaymentAmounts,
  draftProblems,
  draftRequest,
  draftTotals,
  effectiveTaxPercent,
  newLine,
  paymentPercentSum,
  toMinor,
  todayLocalIso,
} from './invoiceDraft';

const COLORS = [
  '',
  '#2b2f36',
  '#4b5563',
  '#475569',
  '#b3362c',
  '#c3285e',
  '#7a2aa6',
  '#4b2aa0',
  '#2e3a8c',
  '#2563c4',
  '#2f80c3',
  '#2d6b5f',
  '#3f7d3a',
  '#5e8a3a',
];

const money = (minor: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);

let keySeq = 1;
const nextKey = (prefix: string) => `${prefix}-${keySeq++}`;

interface ShowOptions {
  notes: boolean;
  signature: boolean;
  photos: boolean;
  extraContacts: boolean;
}

const DEFAULT_SHOW: ShowOptions = {
  notes: true,
  signature: true,
  photos: true,
  extraContacts: true,
};

function initialState(companyName: string, email: string): DraftState {
  return {
    title: 'Invoice',
    from: { ...EMPTY_PARTY, name: companyName, email },
    billTo: { ...EMPTY_PARTY },
    issuedOn: todayLocalIso(),
    terms: 'On Receipt',
    lines: [newLine(nextKey('line'))],
    notes: '',
    taxType: 'none',
    taxPercent: '',
    payments: [],
    discountType: 'none',
    discountValue: '',
  };
}

interface SavedInvoice {
  id: string;
  number: string;
  status: string;
  currency?: string;
}

function readOpenInvoiceId(): string | null {
  if (typeof window === 'undefined') return null;
  const id = new URLSearchParams(window.location.search).get('invoice');
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

export function InvoiceEditor() {
  const { api, endpoints } = useApi();
  const session = useSession();
  const queryClient = useQueryClient();
  const companyName =
    session.me.memberships.find((m) => m.orgId === session.orgId)?.orgDisplayName ?? '';
  const [draft, setDraft] = useState<DraftState>(() =>
    initialState(companyName, session.me.user.email ?? ''),
  );
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [color, setColor] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [signature, setSignature] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [showMoreFrom, setShowMoreFrom] = useState(false);
  const [show, setShow] = useState<ShowOptions>(DEFAULT_SHOW);
  const [customizing, setCustomizing] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const [saved, setSaved] = useState<SavedInvoice | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  // /invoice-dashboard?invoice=<id> opens a saved invoice (from Billing or a copied link). This
  // view only mounts in the browser after the session loads, so reading the URL here is safe.
  const [openId, setOpenId] = useState<string | null>(readOpenInvoiceId);
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const opened = useQuery({
    queryKey: ['invoice', openId],
    queryFn: () => endpoints.invoice(openId!),
    enabled: Boolean(openId),
  });
  if (opened.data && openId && appliedId !== opened.data.id) {
    // Adjust state while rendering when a different invoice finished loading.
    setAppliedId(opened.data.id);
    setDraft(draftFromInvoice(opened.data));
    setLogo(opened.data.attachments?.logo ?? null);
    setSignature(opened.data.attachments?.signature ?? null);
    setPhotos(opened.data.attachments?.photos ?? []);
    setSaved({
      id: opened.data.id,
      number: opened.data.number,
      status: opened.data.status,
      currency: opened.data.currency,
    });
    setScheduleOpen(Boolean(opened.data.paymentSchedule?.length));
    setTab('preview');
  }

  const canWrite = session.can('invoice:write');
  const canSend = session.can('invoice:issue');
  const readOnly = saved !== null;
  const discount = draftDiscount(draft.discountType, draft.discountValue);
  const taxPercent = effectiveTaxPercent(draft);
  const totals = useMemo(
    () => draftTotals(draft.lines, taxPercent, discount),
    [draft.lines, taxPercent, discount],
  );
  const paymentAmounts = draftPaymentAmounts(totals.totalMinor, draft.payments);
  const problems = draftProblems(draft);
  const term = TERMS.find((t) => t.label === draft.terms) ?? TERMS[0];
  const dueOn = addDays(draft.issuedOn, term.days);
  const sendTo = draft.billTo.email.trim();
  const editing = tab === 'edit' && !readOnly;

  const invoiceLink = (id: string) => `${window.location.origin}/invoice-dashboard?invoice=${id}`;

  const save = useMutation({
    mutationFn: async (mode: 'draft' | 'send' | 'link') => {
      if (saved) {
        // Already saved: only sending a saved draft changes anything.
        if (mode === 'send' && saved.status === 'draft') return endpoints.sendInvoice(saved.id);
        return endpoints.invoice(saved.id);
      }
      const attachments =
        logo || signature || photos.length > 0
          ? {
              ...(logo ? { logo } : {}),
              ...(signature ? { signature } : {}),
              ...(photos.length > 0 ? { photos } : {}),
            }
          : null;
      return endpoints.createInvoice(
        draftRequest(draft, { autoSend: mode === 'send', attachments }),
        key,
      );
    },
    onSuccess: (invoice, mode) => {
      setSaved({
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        currency: invoice.currency,
      });
      setKey(newIdempotencyKey());
      void queryClient.invalidateQueries();
      if (mode === 'link') {
        const url = invoiceLink(invoice.id);
        setLink(url);
        void navigator.clipboard?.writeText(url).catch(() => undefined);
        setNotice(`${invoice.number} is saved. Its link is below and was copied.`);
      } else if (mode === 'send') {
        setNotice(
          invoice.email
            ? `${invoice.number} was sent and is being emailed to ${invoice.email.recipient}.`
            : `${invoice.number} was marked sent. Add a client email to also email it.`,
        );
      } else {
        setNotice(`${invoice.number} was saved as a draft.`);
      }
    },
  });

  function set<K extends keyof DraftState>(k: K, v: DraftState[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }
  function setParty(which: 'from' | 'billTo', field: keyof DraftParty, value: string) {
    setDraft((d) => ({ ...d, [which]: { ...d[which], [field]: value } }));
  }
  function setLine(k: string, field: keyof DraftLine, value: string) {
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l) => (l.key === k ? { ...l, [field]: value } : l)),
    }));
  }
  function setPayment(k: string, field: keyof DraftPayment, value: string) {
    setDraft((d) => ({
      ...d,
      payments: d.payments.map((p) => (p.key === k ? { ...p, [field]: value } : p)),
    }));
  }
  function addPayment() {
    setDraft((d) => {
      const left = Math.max(0, Math.round((100 - paymentPercentSum(d.payments)) * 100) / 100);
      const first = d.payments.length === 0;
      return {
        ...d,
        payments: [
          ...d.payments,
          {
            key: nextKey('pay'),
            label: first ? 'Deposit' : `Payment ${d.payments.length + 1}`,
            dueOn: first ? d.issuedOn : addDays(d.issuedOn, 30 * d.payments.length),
            percent: first ? '50' : String(left || 0),
          },
        ],
      };
    });
  }
  function submit(mode: 'draft' | 'send' | 'link') {
    if (!saved) {
      setChecked(true);
      if (problems.length > 0) {
        setTab('edit');
        return;
      }
    }
    save.mutate(mode);
  }
  function startNew() {
    setDraft(initialState(companyName, session.me.user.email ?? ''));
    setPhotos([]);
    setSignature(null);
    setLogo(null);
    setChecked(false);
    setSaved(null);
    setNotice(null);
    setLink(null);
    setScheduleOpen(false);
    save.reset();
    setKey(newIdempotencyKey());
    setTab('edit');
    if (openId) {
      setOpenId(null);
      setAppliedId(null);
      window.history.replaceState(null, '', '/invoice-dashboard');
    }
  }
  function printPdf() {
    setTab('preview');
    setTimeout(() => window.print(), 80);
  }
  function readImages(e: ChangeEvent<HTMLInputElement>, add: (url: string) => void) {
    for (const file of Array.from(e.target.files ?? []).slice(0, 6)) {
      if (!file.type.startsWith('image/') || file.size > 8 * 1024 * 1024) continue;
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' && add(reader.result);
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  }

  const accent = color || '#2b2f36';
  const improve = (kind: 'line' | 'notes') => (text: string, context?: string) =>
    api.post(
      '/v1/invoices/improve-text',
      { text, kind, ...(context ? { context } : {}) },
      { schema: z.object({ text: z.string() }) },
    );

  return (
    <main className="ie-page">
      <div className="ie-topline">
        <div>
          <div className="ie-eyebrow">Field Pro // Invoices</div>
          <h1>Invoice Dashboard</h1>
        </div>
        <div className="ie-topline-actions">
          {canWrite && (
            <button type="button" className="ie-btn" onClick={() => setImportOpen((v) => !v)}>
              {importOpen ? 'Close import' : 'Import invoices'}
            </button>
          )}
          <button type="button" className="ie-btn" onClick={startNew}>
            + New invoice
          </button>
          <Link className="ie-btn" href="/billing">
            Invoice history
          </Link>
        </div>
      </div>

      {importOpen && <InvoiceImport onClose={() => setImportOpen(false)} />}

      {openId && opened.isPending && <p className="ie-muted">Opening the invoice…</p>}
      {opened.error && (
        <p className="web-error" role="alert">
          That invoice could not be opened. {errorHint(opened.error)}
        </p>
      )}

      <div className="ie-layout">
        <section className="ie-main">
          <div className="ie-toolbar">
            <div className="ie-tabs" role="tablist" aria-label="Invoice view">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'preview'}
                className={tab === 'preview' ? 'is-active' : ''}
                onClick={() => setTab('preview')}
              >
                Preview
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'edit'}
                className={tab === 'edit' ? 'is-active' : ''}
                disabled={readOnly}
                title={readOnly ? 'Saved invoices cannot be edited. Start a new invoice.' : ''}
                onClick={() => setTab('edit')}
              >
                Edit
              </button>
            </div>
            <div className="ie-actions">
              <button
                type="button"
                className={`ie-btn ${scheduleOpen ? 'is-on' : ''}`}
                aria-pressed={scheduleOpen}
                disabled={readOnly && draft.payments.length === 0}
                onClick={() => {
                  if (!scheduleOpen && draft.payments.length === 0 && !readOnly) addPayment();
                  setScheduleOpen((v) => !v);
                }}
              >
                Payment scheduling
              </button>
              <button type="button" className="ie-btn" onClick={printPdf}>
                PDF
              </button>
              <button
                type="button"
                className="ie-btn ie-btn--dark"
                disabled={
                  !canWrite ||
                  !canSend ||
                  save.isPending ||
                  (saved !== null && saved.status !== 'draft')
                }
                title={
                  !canSend
                    ? 'Your role cannot send invoices.'
                    : sendTo
                      ? `Email to ${sendTo}`
                      : 'Add a client email under Bill To to email it.'
                }
                onClick={() => submit('send')}
              >
                {save.isPending && save.variables === 'send' ? 'Sending…' : 'Email Invoice'}
              </button>
            </div>
          </div>

          {checked && !saved && problems.length > 0 && (
            <div className="web-error ie-problems" role="alert">
              {problems.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          )}
          {save.error && (
            <p className="web-error" role="alert">
              {errorHint(save.error)}
            </p>
          )}
          {(notice || saved) && (
            <div className="ie-done" role="status">
              <p>
                {notice ??
                  `${saved?.number} is saved (${saved?.status.replace('_', ' ')}). Saved invoices are read-only.`}{' '}
                It is listed in <Link href="/billing">Billing</Link>.
              </p>
              <button type="button" className="ie-btn" onClick={startNew}>
                Start a new invoice
              </button>
            </div>
          )}

          <article
            className={`ie-paper ${editing ? '' : 'ie-paper--preview'}`}
            style={{ ['--ie-accent' as string]: accent }}
          >
            {color && <div className="ie-band" aria-hidden="true" />}
            <div className="ie-head">
              {editing ? (
                <input
                  className="ie-title"
                  aria-label="Document title"
                  value={draft.title}
                  maxLength={60}
                  onChange={(e) => set('title', e.target.value)}
                />
              ) : (
                <h2 className="ie-title-text">{draft.title || 'Invoice'}</h2>
              )}
              <label className="ie-logo">
                {logo ? (
                  <img src={logo} alt="Company logo" />
                ) : (
                  editing && (
                    <span>
                      <span aria-hidden="true">▣</span> + Logo
                    </span>
                  )
                )}
                {editing && (
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => readImages(e, setLogo)}
                  />
                )}
              </label>
            </div>

            {editing ? (
              <>
                <div className="ie-parties">
                  <fieldset>
                    <legend>From</legend>
                    <Row label="Name">
                      <input
                        placeholder="Business Name"
                        aria-label="From business name"
                        value={draft.from.name}
                        onChange={(e) => setParty('from', 'name', e.target.value)}
                      />
                    </Row>
                    <Row label="Email">
                      <input
                        type="email"
                        placeholder="name@business.com"
                        aria-label="From email"
                        value={draft.from.email}
                        onChange={(e) => setParty('from', 'email', e.target.value)}
                      />
                    </Row>
                    <Row label="Address">
                      <input
                        placeholder="Street"
                        aria-label="From street address"
                        value={draft.from.street}
                        onChange={(e) => setParty('from', 'street', e.target.value)}
                      />
                    </Row>
                    <Row label="">
                      <input
                        placeholder="City, State"
                        aria-label="From city and state"
                        value={draft.from.cityState}
                        onChange={(e) => setParty('from', 'cityState', e.target.value)}
                      />
                    </Row>
                    <Row label="">
                      <input
                        placeholder="Zip code"
                        aria-label="From zip code"
                        value={draft.from.zip}
                        onChange={(e) => setParty('from', 'zip', e.target.value)}
                      />
                    </Row>
                    <Row label="Phone">
                      <input
                        placeholder="(123) 456 789"
                        aria-label="From phone"
                        value={draft.from.phone}
                        onChange={(e) => setParty('from', 'phone', e.target.value)}
                      />
                    </Row>
                    <Row label="Business Number">
                      <input
                        placeholder="123-45-6789"
                        aria-label="From business number"
                        value={draft.from.businessNumber}
                        onChange={(e) => setParty('from', 'businessNumber', e.target.value)}
                      />
                    </Row>
                    {showMoreFrom ? (
                      <>
                        <Row label="Mobile">
                          <input
                            placeholder="(123) 456 789"
                            aria-label="From mobile"
                            value={draft.from.mobile}
                            onChange={(e) => setParty('from', 'mobile', e.target.value)}
                          />
                        </Row>
                        <Row label="Fax">
                          <input
                            placeholder="(123) 456 789"
                            aria-label="From fax"
                            value={draft.from.fax}
                            onChange={(e) => setParty('from', 'fax', e.target.value)}
                          />
                        </Row>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="ie-link"
                        onClick={() => setShowMoreFrom(true)}
                      >
                        Show additional business details
                      </button>
                    )}
                  </fieldset>
                  <fieldset>
                    <legend>Bill To</legend>
                    <Row label="Name">
                      <ClientPicker
                        value={draft.billTo.name}
                        companyId={draft.billToCompanyId ?? null}
                        invalid={checked && !draft.billTo.name.trim()}
                        onType={(name) =>
                          setDraft((d) => ({
                            ...d,
                            billToCompanyId: null,
                            billTo: { ...d.billTo, name },
                          }))
                        }
                        onPick={(client) =>
                          setDraft((d) => ({
                            ...d,
                            billToCompanyId: client.kind === 'company' ? client.id : null,
                            billTo:
                              client.kind === 'company'
                                ? { ...EMPTY_PARTY, name: client.name }
                                : {
                                    ...EMPTY_PARTY,
                                    ...client.party,
                                    email: client.party?.email ?? '',
                                    name: client.name,
                                  },
                          }))
                        }
                      />
                    </Row>
                    {draft.billToCompanyId && (
                      <p className="ie-muted ie-company-note">
                        Connected company: the invoice is delivered to them inside Field Pro.
                      </p>
                    )}
                    <Row label="Email">
                      <input
                        type="email"
                        placeholder="name@client.com"
                        aria-label="Bill To email"
                        value={draft.billTo.email}
                        onChange={(e) => setParty('billTo', 'email', e.target.value)}
                      />
                    </Row>
                    <Row label="Address">
                      <input
                        placeholder="Street"
                        aria-label="Bill To street address"
                        value={draft.billTo.street}
                        onChange={(e) => setParty('billTo', 'street', e.target.value)}
                      />
                    </Row>
                    <Row label="">
                      <input
                        placeholder="City, State"
                        aria-label="Bill To city and state"
                        value={draft.billTo.cityState}
                        onChange={(e) => setParty('billTo', 'cityState', e.target.value)}
                      />
                    </Row>
                    <Row label="">
                      <input
                        placeholder="Zip code"
                        aria-label="Bill To zip code"
                        value={draft.billTo.zip}
                        onChange={(e) => setParty('billTo', 'zip', e.target.value)}
                      />
                    </Row>
                    <Row label="Phone">
                      <input
                        placeholder="(123) 456 789"
                        aria-label="Bill To phone"
                        value={draft.billTo.phone}
                        onChange={(e) => setParty('billTo', 'phone', e.target.value)}
                      />
                    </Row>
                    {show.extraContacts && (
                      <>
                        <Row label="Mobile">
                          <input
                            placeholder="(123) 456 789"
                            aria-label="Bill To mobile"
                            value={draft.billTo.mobile}
                            onChange={(e) => setParty('billTo', 'mobile', e.target.value)}
                          />
                        </Row>
                        <Row label="Fax">
                          <input
                            placeholder="(123) 456 789"
                            aria-label="Bill To fax"
                            value={draft.billTo.fax}
                            onChange={(e) => setParty('billTo', 'fax', e.target.value)}
                          />
                        </Row>
                      </>
                    )}
                  </fieldset>
                </div>

                <div className="ie-meta">
                  <Row label="Number">
                    <input value="Assigned when saved" readOnly aria-readonly="true" />
                  </Row>
                  <Row label="Date">
                    <input
                      type="date"
                      value={draft.issuedOn}
                      onChange={(e) => e.target.value && set('issuedOn', e.target.value)}
                    />
                  </Row>
                  <Row label="Terms">
                    <select value={draft.terms} onChange={(e) => set('terms', e.target.value)}>
                      {TERMS.map((t) => (
                        <option key={t.label}>{t.label}</option>
                      ))}
                    </select>
                  </Row>
                  {term.days > 0 && <p className="ie-muted ie-due-note">Due {dueOn}</p>}
                </div>

                <div className="ie-items" role="table" aria-label="Line items">
                  <div className="ie-items-head" role="row">
                    <span role="columnheader" className="ie-col-x" />
                    <span role="columnheader">Description</span>
                    <span role="columnheader" className="ie-num">
                      Rate
                    </span>
                    <span role="columnheader" className="ie-num">
                      Qty
                    </span>
                    <span role="columnheader" className="ie-num">
                      Amount
                    </span>
                  </div>
                  {draft.lines.map((line, i) => (
                    <LineItem
                      key={line.key}
                      line={line}
                      amountMinor={totals.amounts[i] ?? 0}
                      canRemove={draft.lines.length > 1}
                      onChange={(field, value) => setLine(line.key, field, value)}
                      onRemove={() =>
                        set(
                          'lines',
                          draft.lines.filter((l) => l.key !== line.key),
                        )
                      }
                      improve={improve('line')}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="ie-add"
                  aria-label="Add line item"
                  disabled={draft.lines.length >= 100}
                  onClick={() => set('lines', [...draft.lines, newLine(nextKey('line'))])}
                >
                  +
                </button>
              </>
            ) : (
              <PreviewBody
                draft={draft}
                dueOn={dueOn}
                amounts={totals.amounts}
                number={saved?.number ?? null}
              />
            )}

            <Totals
              subtotal={totals.subtotalMinor}
              discount={totals.discountMinor}
              tax={totals.taxMinor}
              taxPercent={taxPercent}
              total={totals.totalMinor}
            />

            {scheduleOpen && (
              <section className="ie-schedule" aria-label="Payment schedule">
                <h3>Payment schedule</h3>
                {draft.payments.length === 0 && <p className="ie-muted">No scheduled payments.</p>}
                {draft.payments.map((p, i) => (
                  <div key={p.key} className="ie-pay">
                    {editing ? (
                      <>
                        <input
                          aria-label="Payment name"
                          value={p.label}
                          maxLength={80}
                          onChange={(e) => setPayment(p.key, 'label', e.target.value)}
                        />
                        <input
                          type="date"
                          aria-label="Payment due date"
                          value={p.dueOn}
                          onChange={(e) => setPayment(p.key, 'dueOn', e.target.value)}
                        />
                        <span className="ie-pay-pct">
                          <input
                            inputMode="decimal"
                            aria-label="Percent of total"
                            value={p.percent}
                            onChange={(e) => setPayment(p.key, 'percent', e.target.value)}
                          />
                          %
                        </span>
                        <span className="ie-num">{money(paymentAmounts[i] ?? 0)}</span>
                        <button
                          type="button"
                          className="ie-x"
                          aria-label="Remove payment"
                          onClick={() =>
                            set(
                              'payments',
                              draft.payments.filter((x) => x.key !== p.key),
                            )
                          }
                        >
                          ×
                        </button>
                      </>
                    ) : (
                      <>
                        <span>{p.label}</span>
                        <span>Due {p.dueOn}</span>
                        <span>{Number(p.percent)}%</span>
                        <span className="ie-num">{money(paymentAmounts[i] ?? 0)}</span>
                      </>
                    )}
                  </div>
                ))}
                {editing && (
                  <div className="ie-pay-foot">
                    <button
                      type="button"
                      className="ie-btn"
                      onClick={addPayment}
                      disabled={draft.payments.length >= 12}
                    >
                      + Add payment
                    </button>
                    <span
                      className={
                        Math.abs(paymentPercentSum(draft.payments) - 100) > 0.001 &&
                        draft.payments.length
                          ? 'ie-warn'
                          : 'ie-muted'
                      }
                    >
                      Total scheduled: {Math.round(paymentPercentSum(draft.payments) * 100) / 100}%
                      of {money(totals.totalMinor)}
                    </span>
                  </div>
                )}
              </section>
            )}

            {show.notes && (
              <div className="ie-notes">
                <h3>Notes</h3>
                {editing ? (
                  <>
                    <textarea
                      placeholder="Notes - any relevant information not covered, additional terms and conditions"
                      aria-label="Invoice notes"
                      maxLength={2000}
                      rows={4}
                      value={draft.notes}
                      onChange={(e) => set('notes', e.target.value)}
                    />
                    <ImproveButton
                      text={draft.notes}
                      onResult={(t) => set('notes', t.slice(0, 2000))}
                      improve={(text) => improve('notes')(text)}
                    />
                  </>
                ) : (
                  <p className="ie-pre">{draft.notes || '—'}</p>
                )}
              </div>
            )}

            {show.signature && (
              <div className="ie-sign">
                <h3>Signature</h3>
                {signature ? (
                  <div className="ie-sign-row">
                    <img src={signature} alt="Signature" className="ie-sign-img" />
                    {editing && (
                      <button type="button" className="ie-link" onClick={() => setSignature(null)}>
                        Clear
                      </button>
                    )}
                  </div>
                ) : editing && signing ? (
                  <SignaturePad
                    onDone={(url) => {
                      setSignature(url);
                      setSigning(false);
                    }}
                    onCancel={() => setSigning(false)}
                  />
                ) : (
                  editing && (
                    <button
                      type="button"
                      className="ie-add"
                      aria-label="Add signature"
                      onClick={() => setSigning(true)}
                    >
                      +
                    </button>
                  )
                )}
              </div>
            )}

            {show.photos && (
              <div className="ie-photos">
                <h3>Photos</h3>
                <div className="ie-photo-grid">
                  {photos.map((src, i) => (
                    <figure key={src.slice(-40) + i}>
                      <img src={src} alt={`Job photo ${i + 1}`} />
                      {editing && (
                        <button
                          type="button"
                          className="ie-link"
                          onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                        >
                          Remove
                        </button>
                      )}
                    </figure>
                  ))}
                  {editing && photos.length < 6 && (
                    <label className="ie-photo-add">
                      <span>
                        <span aria-hidden="true">▣</span> Add Photo
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        onChange={(e) =>
                          readImages(e, (u) => setPhotos((p) => [...p, u].slice(0, 6)))
                        }
                      />
                    </label>
                  )}
                </div>
                {editing && (
                  <p className="ie-muted">
                    Logo, signature and photos print on the PDF and are stored with the saved
                    invoice, so a reopened invoice prints the same.
                  </p>
                )}
              </div>
            )}
          </article>

          <div className="ie-bottom">
            <button type="button" className="ie-btn" onClick={startNew}>
              Close Invoice
            </button>
          </div>

          <section className="ie-help" aria-label="How to use the invoice maker">
            <h2>How To Use The Invoice Maker</h2>
            <ul>
              <li>
                How to make an invoice: fill in From and Bill To, then add a line for each job item.
              </li>
              <li>How to send an invoice: add the client email and press Email Invoice.</li>
              <li>
                What to put on an invoice: your business details, the client, dates, terms, items,
                tax and notes.
              </li>
              <li>
                Improve with AI rewrites a line item or the notes so a customer reads them easily.
              </li>
              <li>Payment scheduling splits the total into a deposit and later payments.</li>
              <li>
                Import invoices brings in invoices from another invoice app by CSV file or copy and
                paste.
              </li>
              <li>
                Every saved, sent or imported invoice is listed in Billing as your invoice history.
              </li>
            </ul>
          </section>
        </section>

        <aside className="ie-side" aria-label="Invoice settings">
          <h3>Email to client</h3>
          <div className="ie-email-box">
            <input
              type="email"
              placeholder="name@client.com"
              value={draft.billTo.email}
              disabled={readOnly}
              onChange={(e) => setParty('billTo', 'email', e.target.value)}
              aria-label="Client email for sending"
            />
          </div>
          <button
            type="button"
            className="ie-btn ie-btn--wide ie-btn--grey"
            disabled={
              !canWrite ||
              !canSend ||
              !sendTo ||
              save.isPending ||
              (saved !== null && saved.status !== 'draft')
            }
            onClick={() => submit('send')}
          >
            Send
          </button>
          <p className="ie-muted">
            Sends from the Gmail or Outlook you connected in Settings &gt; Email.
          </p>

          <h3>Template</h3>
          <div className="ie-colors" role="radiogroup" aria-label="Accent color">
            {COLORS.map((c) => (
              <button
                key={c || 'none'}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c ? `Color ${c}` : 'No color'}
                className={`ie-swatch ${color === c ? 'is-active' : ''} ${c ? '' : 'ie-swatch--none'}`}
                style={c ? { background: c } : undefined}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
          <label className="ie-custom-color">
            <span className="ie-wheel" aria-hidden="true" />
            Custom Color
            <input
              type="color"
              value={color || '#2b2f36'}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="ie-btn ie-btn--wide"
            aria-expanded={customizing}
            onClick={() => setCustomizing((v) => !v)}
          >
            Customize
          </button>
          {customizing && (
            <div className="ie-customize">
              {(
                [
                  ['notes', 'Show notes'],
                  ['signature', 'Show signature'],
                  ['photos', 'Show photos'],
                  ['extraContacts', 'Show client mobile and fax'],
                ] as const
              ).map(([k, label]) => (
                <label key={k}>
                  <input
                    type="checkbox"
                    checked={show[k]}
                    onChange={(e) => setShow((s) => ({ ...s, [k]: e.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </div>
          )}

          <h3>Tax</h3>
          <div className="ie-side-row">
            <span>Type</span>
            <select
              value={draft.taxType}
              disabled={readOnly}
              onChange={(e) => set('taxType', e.target.value as DraftState['taxType'])}
              aria-label="Tax type"
            >
              <option value="none">None</option>
              <option value="total">On Total</option>
            </select>
          </div>
          {draft.taxType === 'total' && (
            <div className="ie-side-row">
              <span>Rate %</span>
              <input
                inputMode="decimal"
                placeholder="8.25"
                value={draft.taxPercent}
                disabled={readOnly}
                onChange={(e) => set('taxPercent', e.target.value)}
                aria-label="Tax rate percent"
              />
            </div>
          )}

          <h3>Discount</h3>
          <div className="ie-side-row">
            <span>Type</span>
            <select
              value={draft.discountType}
              disabled={readOnly}
              onChange={(e) => set('discountType', e.target.value as DraftState['discountType'])}
              aria-label="Discount type"
            >
              <option value="none">None</option>
              <option value="percent">Percent</option>
              <option value="flat">Flat Amount</option>
            </select>
          </div>
          {draft.discountType !== 'none' && (
            <div className="ie-side-row">
              <span>{draft.discountType === 'percent' ? 'Percent' : 'Amount $'}</span>
              <input
                inputMode="decimal"
                value={draft.discountValue}
                disabled={readOnly}
                onChange={(e) => set('discountValue', e.target.value)}
                aria-label="Discount value"
              />
            </div>
          )}

          <h3>Currency</h3>
          <p className="ie-currency">
            <span>{saved?.currency ?? 'USD'}</span>
            <span>$</span>
          </p>
          {!saved && (
            <p className="ie-muted">New invoices use your company currency from Settings.</p>
          )}

          <h3>Options</h3>
          <button
            type="button"
            className="ie-btn ie-btn--wide ie-btn--grey"
            disabled={!canWrite || save.isPending}
            title="Saves the invoice and copies a link that opens it in Field Pro"
            onClick={() => submit('link')}
          >
            Get Link
          </button>
          {link && (
            <input
              className="ie-link-box"
              readOnly
              value={link}
              aria-label="Invoice link"
              onFocus={(e) => e.target.select()}
            />
          )}
          <button
            type="button"
            className="ie-btn ie-btn--wide"
            disabled={!canWrite || save.isPending || saved !== null}
            onClick={() => submit('draft')}
          >
            {save.isPending && save.variables === 'draft' ? 'Saving…' : 'Save Draft'}
          </button>
          <button type="button" className="ie-btn ie-btn--wide" onClick={printPdf}>
            Print Invoice
          </button>
          {!canWrite && (
            <p className="ie-muted">Your role can view invoices but not create them.</p>
          )}
          <p className="ie-muted">
            The link opens the invoice for people signed in to your company.
          </p>
        </aside>
      </div>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ie-row">
      <span className="ie-row-label">{label}</span>
      <div>{children}</div>
    </div>
  );
}

function ClientPicker(props: {
  value: string;
  companyId: string | null;
  invalid: boolean;
  onType: (name: string) => void;
  onPick: (client: InvoiceClient) => void;
}) {
  const { endpoints } = useApi();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(props.value.trim()), 200);
    return () => clearTimeout(t);
  }, [props.value]);
  const clients = useQuery({
    queryKey: ['invoice-clients', q],
    queryFn: () => endpoints.invoiceClients(q || undefined),
    enabled: open,
    staleTime: 30_000,
  });
  const items = clients.data?.items ?? [];
  const exact = items.some((c) => c.name.toLowerCase() === props.value.trim().toLowerCase());
  function pick(client: InvoiceClient) {
    props.onPick(client);
    setOpen(false);
  }
  return (
    <div className="ie-picker">
      <input
        placeholder="Client Name"
        role="combobox"
        aria-expanded={open}
        aria-controls="ie-client-list"
        aria-autocomplete="list"
        aria-invalid={props.invalid}
        autoComplete="off"
        value={props.value}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          props.onType(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (!open || items.length === 0) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const c = items[active];
            if (c) pick(c);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      <button
        type="button"
        className="ie-picker-toggle"
        aria-label="Show saved clients and companies"
        aria-expanded={open}
        onMouseDown={(e) => {
          // Keep focus in the client input so typing continues after picking.
          e.preventDefault();
        }}
        onClick={() => setOpen((o) => !o)}
      >
        ▾
      </button>
      {open && (
        <ul id="ie-client-list" role="listbox" className="ie-picker-list">
          {clients.isPending && <li className="ie-picker-empty">Loading clients…</li>}
          {clients.error && <li className="ie-picker-empty">Clients could not be loaded.</li>}
          {!clients.isPending && items.length === 0 && (
            <li className="ie-picker-empty">
              {props.value.trim()
                ? `New client "${props.value.trim()}" is saved when you save the invoice.`
                : 'No saved clients yet. Type a name; it is saved with the invoice.'}
            </li>
          )}
          {items.map((c, i) => (
            <li
              key={`${c.kind}-${c.id}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : ''}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span>{c.name}</span>
              <small>
                {c.kind === 'company'
                  ? 'Connected company'
                  : [c.party?.email, c.party?.cityState].filter(Boolean).join(' · ') ||
                    'Saved client'}
              </small>
            </li>
          ))}
          {!clients.isPending && items.length > 0 && props.value.trim() && !exact && (
            <li className="ie-picker-empty">
              Or keep typing to add &quot;{props.value.trim()}&quot; as a new client.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function LineItem(props: {
  line: DraftLine;
  amountMinor: number;
  canRemove: boolean;
  onChange: (field: keyof DraftLine, value: string) => void;
  onRemove: () => void;
  improve: (text: string, context?: string) => Promise<{ text: string }>;
}) {
  const { line } = props;
  const detailsMax = Math.max(0, LINE_TEXT_LIMIT - line.description.trim().length - 1);
  return (
    <div className="ie-item" role="row">
      <button
        type="button"
        className="ie-x ie-item-x"
        aria-label="Remove line"
        disabled={!props.canRemove}
        onClick={props.onRemove}
      >
        ×
      </button>
      <input
        className="ie-item-desc"
        placeholder="Item Description"
        aria-label="Item description"
        maxLength={200}
        value={line.description}
        onChange={(e) => props.onChange('description', e.target.value)}
      />
      <label className="ie-item-rate">
        <span className="ie-item-cap">Rate</span>
        <input
          inputMode="decimal"
          aria-label="Rate"
          value={line.rate}
          onChange={(e) => props.onChange('rate', e.target.value)}
          onBlur={() => props.onChange('rate', (toMinor(line.rate) / 100).toFixed(2))}
        />
      </label>
      <label className="ie-item-qty">
        <span className="ie-item-cap">Qty</span>
        <input
          inputMode="decimal"
          aria-label="Quantity"
          value={line.qty}
          onChange={(e) => props.onChange('qty', e.target.value)}
          onBlur={() => props.onChange('qty', cleanQty(line.qty))}
        />
      </label>
      <div className="ie-item-amount">
        <span className="ie-item-cap">Amount</span>
        {money(props.amountMinor)}
      </div>
      <div className="ie-item-details">
        <div className="ie-details">
          <textarea
            placeholder="Additional details"
            aria-label="Additional details"
            rows={3}
            maxLength={detailsMax}
            value={line.details}
            onChange={(e) => props.onChange('details', e.target.value)}
          />
          <span className="ie-count">
            {line.details.length}/{detailsMax}
          </span>
        </div>
        <ImproveButton
          text={line.details || line.description}
          onResult={(t) =>
            line.details
              ? props.onChange('details', t.slice(0, detailsMax))
              : props.onChange('description', t.slice(0, 200))
          }
          improve={(text) =>
            props.improve(text, line.details ? line.description || undefined : undefined)
          }
        />
      </div>
    </div>
  );
}

function PreviewBody({
  draft,
  dueOn,
  amounts,
  number,
}: {
  draft: DraftState;
  dueOn: string;
  amounts: number[];
  number: string | null;
}) {
  const block = (p: DraftParty) =>
    [
      p.name,
      p.street,
      p.cityState,
      p.zip,
      p.email,
      p.phone && `Phone ${p.phone}`,
      p.mobile && `Mobile ${p.mobile}`,
      p.fax && `Fax ${p.fax}`,
      p.businessNumber && `Business No. ${p.businessNumber}`,
    ]
      .filter(Boolean)
      .map((t) => <div key={String(t)}>{t}</div>);
  return (
    <>
      <div className="ie-parties ie-parties--preview">
        <div>
          <h3>From</h3>
          {block(draft.from)}
        </div>
        <div>
          <h3>Bill To</h3>
          {draft.billTo.name ? block(draft.billTo) : <div className="ie-muted">No client yet</div>}
        </div>
        <div className="ie-meta-preview">
          <div>
            <span>Number</span> {number ?? 'Assigned when saved'}
          </div>
          <div>
            <span>Date</span> {draft.issuedOn}
          </div>
          <div>
            <span>Terms</span> {draft.terms}
          </div>
          <div>
            <span>Due</span> {dueOn}
          </div>
        </div>
      </div>
      <table className="ie-lines--preview">
        <thead>
          <tr>
            <th>Description</th>
            <th className="ie-num">Rate</th>
            <th className="ie-num">Qty</th>
            <th className="ie-num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {draft.lines.map((l, i) =>
            l.description.trim() ? (
              <tr key={l.key}>
                <td>
                  <strong>{l.description}</strong>
                  {l.details && <div className="ie-pre ie-muted">{l.details}</div>}
                </td>
                <td className="ie-num">{money(toMinor(l.rate))}</td>
                <td className="ie-num">{cleanQty(l.qty)}</td>
                <td className="ie-num">{money(amounts[i] ?? 0)}</td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    </>
  );
}

function ImproveButton(props: {
  text: string;
  onResult: (text: string) => void;
  improve: (text: string) => Promise<{ text: string }>;
}) {
  const run = useMutation({
    mutationFn: () => props.improve(props.text.trim()),
    onSuccess: (r) => props.onResult(r.text),
  });
  return (
    <div className="ie-ai">
      <button
        type="button"
        className="ie-ai-btn"
        disabled={!props.text.trim() || run.isPending}
        title={props.text.trim() ? 'Rewrite this text clearly' : 'Type something first'}
        onClick={() => run.mutate()}
      >
        <span aria-hidden="true">✦</span> {run.isPending ? 'Improving…' : 'Improve with AI'}
      </button>
      {run.error && <span className="ie-ai-error">{errorHint(run.error)}</span>}
    </div>
  );
}

function Totals(p: {
  subtotal: number;
  discount: number;
  tax: number;
  taxPercent: string;
  total: number;
}) {
  return (
    <dl className="ie-totals">
      <dt>Subtotal</dt>
      <dd>{money(p.subtotal)}</dd>
      {p.discount > 0 && (
        <>
          <dt>Discount</dt>
          <dd>-{money(p.discount)}</dd>
        </>
      )}
      {p.tax > 0 && (
        <>
          <dt>Tax ({Number(p.taxPercent)}%)</dt>
          <dd>{money(p.tax)}</dd>
        </>
      )}
      <dt>Total</dt>
      <dd>{money(p.total)}</dd>
      <dt className="ie-due">Balance Due</dt>
      <dd className="ie-due">{money(p.total)}</dd>
    </dl>
  );
}

function SignaturePad({
  onDone,
  onCancel,
}: {
  onDone: (url: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111';
  }, []);
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * e.currentTarget.width) / r.width,
      y: ((e.clientY - r.top) * e.currentTarget.height) / r.height,
    };
  };
  return (
    <div className="ie-pad">
      <canvas
        ref={ref}
        width={500}
        height={150}
        aria-label="Draw your signature"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const ctx = e.currentTarget.getContext('2d');
          const { x, y } = point(e);
          ctx?.beginPath();
          ctx?.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext('2d');
          const { x, y } = point(e);
          ctx?.lineTo(x, y);
          ctx?.stroke();
          setEmpty(false);
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
      />
      <div className="ie-pad-actions">
        <button type="button" className="ie-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="ie-btn ie-btn--dark"
          disabled={empty}
          onClick={() => ref.current && onDone(ref.current.toDataURL('image/png'))}
        >
          Use signature
        </button>
      </div>
    </div>
  );
}
