'use client';

// Invoice Dashboard: make an invoice for any customer, preview it, print it as a PDF, save it as
// a draft or email it. Every saved or sent invoice shows up in Billing, which is the history.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { errorHint, newIdempotencyKey } from '../../lib/api';
import { useApi, useSession } from '../../lib/session';
import {
  type DraftLine,
  type DraftParty,
  type DraftState,
  EMPTY_PARTY,
  LINE_TEXT_LIMIT,
  TERMS,
  draftDiscount,
  draftProblems,
  draftRequest,
  draftTotals,
  addDays,
  newLine,
  todayLocalIso,
  toMinor,
  cleanQty,
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

let lineSeq = 1;
const nextKey = () => `line-${lineSeq++}`;

function initialState(companyName: string, email: string): DraftState {
  return {
    title: 'Invoice',
    from: { ...EMPTY_PARTY, name: companyName, email },
    billTo: { ...EMPTY_PARTY },
    issuedOn: todayLocalIso(),
    terms: 'On Receipt',
    lines: [newLine(nextKey())],
    notes: '',
    taxPercent: '',
    discountType: 'none',
    discountValue: '',
  };
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
  const [checked, setChecked] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const [done, setDone] = useState<{ number: string; sent: boolean; emailed: boolean } | null>(
    null,
  );

  const canWrite = session.can('invoice:write');
  const canSend = session.can('invoice:issue');
  const discount = draftDiscount(draft.discountType, draft.discountValue);
  const totals = useMemo(
    () => draftTotals(draft.lines, draft.taxPercent, discount),
    [draft.lines, draft.taxPercent, discount],
  );
  const problems = draftProblems(draft);
  const term = TERMS.find((t) => t.label === draft.terms) ?? TERMS[0];
  const dueOn = addDays(draft.issuedOn, term.days);

  const save = useMutation({
    mutationFn: (autoSend: boolean) =>
      endpoints.createInvoice(draftRequest(draft, { autoSend }), key),
    onSuccess: (invoice, autoSend) => {
      setDone({
        number: invoice.number,
        sent: invoice.status !== 'draft',
        emailed: autoSend && Boolean(invoice.email),
      });
      setKey(newIdempotencyKey());
      void queryClient.invalidateQueries();
    },
  });

  function set<K extends keyof DraftState>(k: K, v: DraftState[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
    setDone(null);
  }
  function setParty(which: 'from' | 'billTo', field: keyof DraftParty, value: string) {
    setDraft((d) => ({ ...d, [which]: { ...d[which], [field]: value } }));
    setDone(null);
  }
  function setLine(k: string, field: keyof DraftLine, value: string) {
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l) => (l.key === k ? { ...l, [field]: value } : l)),
    }));
    setDone(null);
  }
  function submit(autoSend: boolean) {
    setChecked(true);
    if (problems.length > 0) {
      setTab('edit');
      return;
    }
    save.mutate(autoSend);
  }
  function startNew() {
    setDraft(initialState(companyName, session.me.user.email ?? ''));
    setPhotos([]);
    setSignature(null);
    setLogo(null);
    setChecked(false);
    setDone(null);
    save.reset();
    setKey(newIdempotencyKey());
    setTab('edit');
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
  const sendTo = draft.billTo.email.trim();

  return (
    <main className="ie-page">
      <div className="ie-topline">
        <div>
          <div className="cc-eyebrow">Field Pro // Invoices</div>
          <h1>Invoice Dashboard</h1>
        </div>
        <Link className="cc-btn" href="/billing">
          Invoice history (Billing)
        </Link>
      </div>

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
                onClick={() => setTab('edit')}
              >
                Edit
              </button>
            </div>
            <div className="ie-actions">
              <button
                type="button"
                className="ie-btn"
                onClick={() => {
                  setTab('preview');
                  setTimeout(() => window.print(), 50);
                }}
              >
                PDF
              </button>
              <button
                type="button"
                className="ie-btn ie-btn--dark"
                disabled={!canWrite || !canSend || save.isPending}
                title={
                  !canSend
                    ? 'Your role cannot send invoices.'
                    : sendTo
                      ? `Email to ${sendTo}`
                      : 'Add a client email under Bill To to email it.'
                }
                onClick={() => submit(true)}
              >
                {save.isPending && save.variables ? 'Sending…' : 'Email Invoice'}
              </button>
            </div>
          </div>

          {checked && problems.length > 0 && (
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
          {done && (
            <div className="ie-done" role="status">
              <p>
                <strong>{done.number}</strong>{' '}
                {done.sent
                  ? done.emailed
                    ? `was sent and is being emailed to ${sendTo}.`
                    : 'was sent. Add a client email to also email it.'
                  : 'was saved as a draft.'}{' '}
                It is listed in <Link href="/billing">Billing</Link>.
              </p>
              <button type="button" className="ie-btn" onClick={startNew}>
                Start a new invoice
              </button>
            </div>
          )}

          <article
            className={`ie-paper ${tab === 'preview' ? 'ie-paper--preview' : ''}`}
            style={{ ['--ie-accent' as string]: accent }}
          >
            {color && <div className="ie-band" aria-hidden="true" />}
            <div className="ie-head">
              {tab === 'edit' ? (
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
                  tab === 'edit' && <span>+ Logo</span>
                )}
                {tab === 'edit' && (
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => readImages(e, setLogo)}
                  />
                )}
              </label>
            </div>

            {tab === 'edit' ? (
              <>
                <div className="ie-parties">
                  <fieldset>
                    <legend>From</legend>
                    <Row label="Name">
                      <input
                        placeholder="Business Name"
                        value={draft.from.name}
                        onChange={(e) => setParty('from', 'name', e.target.value)}
                      />
                    </Row>
                    <Row label="Email">
                      <input
                        type="email"
                        placeholder="name@business.com"
                        value={draft.from.email}
                        onChange={(e) => setParty('from', 'email', e.target.value)}
                      />
                    </Row>
                    <Row label="Address">
                      <input
                        placeholder="Street"
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
                        value={draft.from.phone}
                        onChange={(e) => setParty('from', 'phone', e.target.value)}
                      />
                    </Row>
                    {showMoreFrom ? (
                      <>
                        <Row label="Business Number">
                          <input
                            placeholder="EIN or license number"
                            value={draft.from.businessNumber}
                            onChange={(e) => setParty('from', 'businessNumber', e.target.value)}
                          />
                        </Row>
                        <Row label="Mobile">
                          <input
                            placeholder="(123) 456 789"
                            value={draft.from.mobile}
                            onChange={(e) => setParty('from', 'mobile', e.target.value)}
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
                      <input
                        placeholder="Client Name"
                        value={draft.billTo.name}
                        aria-invalid={checked && !draft.billTo.name.trim()}
                        onChange={(e) => setParty('billTo', 'name', e.target.value)}
                      />
                    </Row>
                    <Row label="Email">
                      <input
                        type="email"
                        placeholder="name@client.com"
                        value={draft.billTo.email}
                        onChange={(e) => setParty('billTo', 'email', e.target.value)}
                      />
                    </Row>
                    <Row label="Address">
                      <input
                        placeholder="Street"
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
                    <Row label="Phone">
                      <input
                        placeholder="(123) 456 789"
                        value={draft.billTo.phone}
                        onChange={(e) => setParty('billTo', 'phone', e.target.value)}
                      />
                    </Row>
                    <Row label="Mobile">
                      <input
                        placeholder="(123) 456 789"
                        value={draft.billTo.mobile}
                        onChange={(e) => setParty('billTo', 'mobile', e.target.value)}
                      />
                    </Row>
                    <Row label="Fax">
                      <input
                        placeholder="(123) 456 789"
                        value={draft.billTo.fax}
                        onChange={(e) => setParty('billTo', 'fax', e.target.value)}
                      />
                    </Row>
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
                  {term.days > 0 && <p className="ie-muted">Due {dueOn}</p>}
                </div>

                <table className="ie-lines">
                  <thead>
                    <tr>
                      <th aria-label="Remove" />
                      <th>Description</th>
                      <th className="ie-num">Rate</th>
                      <th className="ie-num">Qty</th>
                      <th className="ie-num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.lines.map((line, i) => (
                      <LineRow
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
                        improve={(text, context) =>
                          api.post(
                            '/v1/invoices/improve-text',
                            { text, kind: 'line', ...(context ? { context } : {}) },
                            { schema: z.object({ text: z.string() }) },
                          )
                        }
                      />
                    ))}
                  </tbody>
                </table>
                <button
                  type="button"
                  className="ie-add"
                  aria-label="Add line item"
                  disabled={draft.lines.length >= 100}
                  onClick={() => set('lines', [...draft.lines, newLine(nextKey())])}
                >
                  +
                </button>
              </>
            ) : (
              <PreviewBody draft={draft} dueOn={dueOn} totalsAmounts={totals.amounts} />
            )}

            <Totals
              subtotal={totals.subtotalMinor}
              discount={totals.discountMinor}
              tax={totals.taxMinor}
              taxPercent={draft.taxPercent}
              total={totals.totalMinor}
            />

            <div className="ie-notes">
              <h3>Notes</h3>
              {tab === 'edit' ? (
                <>
                  <textarea
                    placeholder="Notes - any relevant information not covered, additional terms and conditions"
                    maxLength={2000}
                    rows={4}
                    value={draft.notes}
                    onChange={(e) => set('notes', e.target.value)}
                  />
                  <ImproveButton
                    text={draft.notes}
                    onResult={(t) => set('notes', t.slice(0, 2000))}
                    improve={(text) =>
                      api.post(
                        '/v1/invoices/improve-text',
                        { text, kind: 'notes' },
                        { schema: z.object({ text: z.string() }) },
                      )
                    }
                  />
                </>
              ) : (
                <p className="ie-pre">{draft.notes || '—'}</p>
              )}
            </div>

            <div className="ie-sign">
              <h3>Signature</h3>
              {signature ? (
                <div className="ie-sign-row">
                  <img src={signature} alt="Signature" className="ie-sign-img" />
                  {tab === 'edit' && (
                    <button type="button" className="ie-link" onClick={() => setSignature(null)}>
                      Clear
                    </button>
                  )}
                </div>
              ) : tab === 'edit' && signing ? (
                <SignaturePad
                  onDone={(url) => {
                    setSignature(url);
                    setSigning(false);
                  }}
                  onCancel={() => setSigning(false)}
                />
              ) : (
                tab === 'edit' && (
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

            <div className="ie-photos">
              <h3>Photos</h3>
              <div className="ie-photo-grid">
                {photos.map((src, i) => (
                  <figure key={src.slice(-40) + i}>
                    <img src={src} alt={`Job photo ${i + 1}`} />
                    {tab === 'edit' && (
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
                {tab === 'edit' && photos.length < 6 && (
                  <label className="ie-photo-add">
                    Add Photo
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
              {tab === 'edit' && (
                <p className="ie-muted">
                  Logo, signature and photos print on the PDF. They are not stored with the saved
                  invoice yet.
                </p>
              )}
            </div>
          </article>

          <div className="ie-bottom">
            <button type="button" className="ie-btn" onClick={startNew}>
              Close Invoice
            </button>
          </div>

          <section className="ie-help" aria-label="How to use the invoice maker">
            <h2>How to use the invoice maker</h2>
            <ol>
              <li>Fill in From with your business and Bill To with your client.</li>
              <li>Pick the date and terms. The due date follows the terms.</li>
              <li>Add a line for each job item. Press + for more lines.</li>
              <li>Press Improve with AI to make a description or the notes read clearly.</li>
              <li>Set tax and discount on the right. Totals update as you type.</li>
              <li>Press Save draft to keep it, PDF to print it, or Email Invoice to send it.</li>
              <li>Every saved or sent invoice is listed in Billing as your invoice history.</li>
            </ol>
          </section>
        </section>

        <aside className="ie-side" aria-label="Invoice settings">
          <h3>Send by email</h3>
          <input
            type="email"
            placeholder="name@client.com"
            value={draft.billTo.email}
            onChange={(e) => setParty('billTo', 'email', e.target.value)}
            aria-label="Client email for sending"
          />
          <button
            type="button"
            className="ie-btn ie-btn--wide"
            disabled={!canWrite || !canSend || !sendTo || save.isPending}
            onClick={() => submit(true)}
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
            Custom Color
            <input
              type="color"
              value={color || '#2b2f36'}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>

          <h3>Tax</h3>
          <div className="ie-side-row">
            <span>Rate %</span>
            <input
              inputMode="decimal"
              placeholder="None"
              value={draft.taxPercent}
              onChange={(e) => set('taxPercent', e.target.value)}
              aria-label="Tax rate percent"
            />
          </div>

          <h3>Discount</h3>
          <div className="ie-side-row">
            <span>Type</span>
            <select
              value={draft.discountType}
              onChange={(e) => set('discountType', e.target.value as DraftState['discountType'])}
              aria-label="Discount type"
            >
              <option value="none">None</option>
              <option value="percent">Percent</option>
              <option value="flat">Flat amount</option>
            </select>
          </div>
          {draft.discountType !== 'none' && (
            <div className="ie-side-row">
              <span>{draft.discountType === 'percent' ? 'Percent' : 'Amount $'}</span>
              <input
                inputMode="decimal"
                value={draft.discountValue}
                onChange={(e) => set('discountValue', e.target.value)}
                aria-label="Discount value"
              />
            </div>
          )}

          <h3>Currency</h3>
          <p className="ie-currency">USD $</p>

          <h3>Options</h3>
          <button
            type="button"
            className="ie-btn ie-btn--wide ie-btn--grey"
            disabled={!canWrite || save.isPending}
            onClick={() => submit(false)}
          >
            {save.isPending && !save.variables ? 'Saving…' : 'Save draft'}
          </button>
          <button
            type="button"
            className="ie-btn ie-btn--wide"
            onClick={() => {
              setTab('preview');
              setTimeout(() => window.print(), 50);
            }}
          >
            Print Invoice
          </button>
          <Link className="ie-btn ie-btn--wide" href="/billing">
            Invoice history
          </Link>
          {!canWrite && (
            <p className="ie-muted">Your role can view invoices but not create them.</p>
          )}
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

function LineRow(props: {
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
    <>
      <tr className="ie-line">
        <td>
          <button
            type="button"
            className="ie-x"
            aria-label="Remove line"
            disabled={!props.canRemove}
            onClick={props.onRemove}
          >
            ×
          </button>
        </td>
        <td>
          <input
            placeholder="Item Description"
            maxLength={200}
            value={line.description}
            onChange={(e) => props.onChange('description', e.target.value)}
          />
        </td>
        <td className="ie-num">
          <input
            inputMode="decimal"
            aria-label="Rate"
            value={line.rate}
            onChange={(e) => props.onChange('rate', e.target.value)}
            onBlur={() => props.onChange('rate', (toMinor(line.rate) / 100).toFixed(2))}
          />
        </td>
        <td className="ie-num">
          <input
            inputMode="decimal"
            aria-label="Quantity"
            value={line.qty}
            onChange={(e) => props.onChange('qty', e.target.value)}
            onBlur={() => props.onChange('qty', cleanQty(line.qty))}
          />
        </td>
        <td className="ie-num ie-amount">{money(props.amountMinor)}</td>
      </tr>
      <tr className="ie-line-details">
        <td />
        <td colSpan={2}>
          <div className="ie-details">
            <textarea
              placeholder="Additional details"
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
        </td>
        <td colSpan={2} />
      </tr>
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

function PreviewBody({
  draft,
  dueOn,
  totalsAmounts,
}: {
  draft: DraftState;
  dueOn: string;
  totalsAmounts: number[];
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
            <span>Number</span> Assigned when saved
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
      <table className="ie-lines ie-lines--preview">
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
                <td className="ie-num">{money(totalsAmounts[i] ?? 0)}</td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>
    </>
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
