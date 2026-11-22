'use client';

// Bid outreach inside Bidding: today's Texas companies, emails from the member's own connected
// mailbox, call logging, and the replies and offers read back from that mailbox.
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice } from '../../components/common';
import { useApi, useSession, orgKey } from '../../lib/session';
import { errorHint } from '../../lib/api';

const Settings = z.object({
  autoRefresh: z.boolean(),
  businessName: z.string(),
  businessAddress: z.string(),
  businessPhone: z.string(),
  trades: z.array(z.string()),
  cities: z.array(z.string()),
  dailyLeadTarget: z.number(),
  dailyEmailLimit: z.number(),
  subjectTemplate: z.string(),
  bodyTemplate: z.string(),
  lastRefreshAt: z.string().nullable(),
  lastRefreshMessage: z.string(),
  lastSyncAt: z.string().nullable(),
  lastSyncMessage: z.string(),
  licenseTypes: z.array(z.string()),
  licenseCounties: z.array(z.string()),
  licenseDays: z.number(),
  callScriptTemplate: z.string(),
  revision: z.number(),
});
type Settings = z.infer<typeof Settings>;
const Overview = z.object({
  settings: Settings,
  placesConfigured: z.boolean(),
  mailerAvailable: z.boolean(),
  mailbox: z.object({ connected: z.boolean(), address: z.string().nullable() }),
  trades: z.array(z.object({ id: z.string(), label: z.string() })),
  defaultCities: z.array(z.string()),
  licenseTypes: z.array(z.object({ id: z.string(), label: z.string() })),
  defaultLicenseCounties: z.array(z.string()),
  stats: z.object({
    today: z.number(),
    total: z.number(),
    withEmail: z.number(),
    queued: z.number(),
    sentToday: z.number(),
    unhandledReplies: z.number(),
    offers: z.number(),
    interested: z.number(),
  }),
});
const Company = z.object({
  id: z.string(),
  source: z.string(),
  name: z.string(),
  trade: z.string(),
  city: z.string(),
  state: z.string(),
  address: z.string(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  email: z.string().nullable(),
  emailSource: z.string().nullable(),
  status: z.string(),
  foundOn: z.string(),
  lastContactedAt: z.string().nullable(),
  lastReplyAt: z.string().nullable(),
  offerAmountMinor: z.number().nullable(),
  notes: z.string(),
  ownerName: z.string().nullable(),
  county: z.string().nullable(),
  licenseType: z.string().nullable(),
  licenseNumber: z.string().nullable(),
  licenseExpiresOn: z.string().nullable(),
  score: z.number().nullable(),
  callScript: z.string().nullable(),
  revision: z.number(),
});
type Company = z.infer<typeof Company>;
const CompanyList = z.object({ items: z.array(Company), total: z.number() });
const Message = z.object({
  id: z.string(),
  companyId: z.string(),
  companyName: z.string(),
  companyPhone: z.string().nullable(),
  direction: z.string(),
  status: z.string(),
  subject: z.string(),
  body: z.string(),
  toEmail: z.string().nullable(),
  fromEmail: z.string().nullable(),
  webLink: z.string().nullable(),
  classification: z.string().nullable(),
  amountMinor: z.number().nullable(),
  error: z.string().nullable(),
  handled: z.boolean(),
  at: z.string(),
});
type Message = z.infer<typeof Message>;
const MessageList = z.object({ items: z.array(Message) });
const Ok = z.object({ message: z.string() });
const RefreshResult = z.object({
  added: z.number(),
  searched: z.number(),
  emailsFound: z.number(),
  message: z.string(),
});
const SendResult = z.object({
  queued: z.number(),
  sent: z.number(),
  failed: z.number(),
  remaining: z.number(),
  skipped: z.array(z.object({ companyId: z.string(), reason: z.string() })),
  message: z.string(),
});
const ImportResult = z.object({
  found: z.number(),
  added: z.number(),
  updated: z.number(),
  message: z.string(),
});
const SyncResult = z.object({ sent: z.number(), newReplies: z.number(), message: z.string() });

const STATUS_LABEL: Record<string, string> = {
  new: 'New',
  contacted: 'Contacted',
  replied: 'Replied',
  interested: 'Interested',
  offer: 'Offer received',
  declined: 'Declined',
  do_not_contact: 'Do not contact',
};
const REPLY_LABEL: Record<string, string> = {
  offer: 'Offer',
  interested: 'Interested',
  declined: 'Declined',
  opt_out: 'Asked to be removed',
  auto_reply: 'Auto-reply',
  reply: 'Reply',
};
const CALL_OUTCOMES = [
  ['no_answer', 'No answer'],
  ['voicemail', 'Left voicemail'],
  ['interested', 'Spoke: interested'],
  ['call_back', 'Call back later'],
  ['not_interested', 'Spoke: not interested'],
  ['do_not_call', 'Do not call again'],
] as const;

const money = (minor: number | null) =>
  minor === null
    ? ''
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(minor / 100);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never');

type Tab = 'today' | 'all' | 'licenses' | 'replies' | 'sent' | 'settings';

export function OutreachWorkspace() {
  const session = useSession();
  const { api } = useApi();
  const client = useQueryClient();
  const canWrite = session.check('job:write');
  const [tab, setTab] = useState<Tab>('today');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const base = orgKey(session.orgId, 'outreach');
  const overview = useQuery({
    queryKey: [...base, 'overview'],
    queryFn: () => api.get('/v1/outreach/overview', { schema: Overview }),
  });
  const refreshAll = () => void client.invalidateQueries({ queryKey: base });
  const done = (message: string) => {
    setFeedback(message);
    setError('');
    refreshAll();
  };
  const fail = (cause: unknown) => {
    setError(errorHint(cause));
    setFeedback('');
  };

  const findNow = useMutation({
    mutationFn: () => api.post('/v1/outreach/refresh', {}, { schema: RefreshResult }),
    onSuccess: (r) => done(r.message),
    onError: fail,
  });
  const syncNow = useMutation({
    mutationFn: () => api.post('/v1/outreach/sync', {}, { schema: SyncResult }),
    onSuccess: (r) => done(r.message),
    onError: fail,
  });

  const o = overview.data;
  const tabs: [Tab, string][] = [
    ['today', `Today's companies${o ? ` (${o.stats.today})` : ''}`],
    ['all', `All companies${o ? ` (${o.stats.total})` : ''}`],
    ['licenses', 'Texas license leads'],
    [
      'replies',
      `Replies & offers${o?.stats.unhandledReplies ? ` (${o.stats.unhandledReplies} new)` : ''}`,
    ],
    ['sent', 'Sent & calls'],
    ['settings', 'Outreach settings'],
  ];

  return (
    <section className="web-card cc-outreach" aria-labelledby="outreach-title">
      <div className="cc-work-board__cardhead">
        <h2 id="outreach-title">Company outreach</h2>
        <span>Texas · concrete · home building · general contractors</span>
      </div>
      <p className="web-muted web-small">
        Every morning Field Pro finds new Texas construction companies, looks for the contact email
        on their own website, and checks your connected mailbox for replies. Emails go out from your
        own Gmail or Outlook, one at a time, with your company address and an opt-out line.
      </p>
      {overview.isPending && <p role="status">Loading outreach…</p>}
      {overview.error && (
        <ErrorNotice
          error={overview.error}
          title="Could not load outreach"
          onRetry={() => void overview.refetch()}
        />
      )}
      {o && (
        <>
          <div className="cc-outreach__stats">
            <Stat label="New today" value={o.stats.today} />
            <Stat label="With email" value={o.stats.withEmail} />
            <Stat
              label="Sent last 24h"
              value={`${o.stats.sentToday}/${o.settings.dailyEmailLimit}`}
            />
            <Stat label="Queued" value={o.stats.queued} />
            <Stat label="Interested" value={o.stats.interested} />
            <Stat label="Offers" value={o.stats.offers} />
          </div>
          <SetupNotices o={o} />
          <div className="cc-outreach__actions">
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              disabled={!canWrite.allowed || findNow.isPending}
              onClick={() => findNow.mutate()}
            >
              {findNow.isPending ? 'Searching Texas…' : 'Find new companies now'}
            </button>
            <button
              type="button"
              className="cc-btn"
              disabled={!canWrite.allowed || syncNow.isPending || !o.mailerAvailable}
              onClick={() => syncNow.mutate()}
            >
              {syncNow.isPending ? 'Checking mailbox…' : 'Send queued & check replies'}
            </button>
            <span className="web-muted web-small">
              Last search: {when(o.settings.lastRefreshAt)}. Last mailbox check:{' '}
              {when(o.settings.lastSyncAt)}.
            </span>
          </div>
          {o.settings.lastRefreshMessage && (
            <p className="web-small">Search: {o.settings.lastRefreshMessage}</p>
          )}
          {o.settings.lastSyncMessage && (
            <p className="web-small">Mailbox: {o.settings.lastSyncMessage}</p>
          )}
          <div className="cc-outreach__tabs" role="tablist" aria-label="Outreach views">
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? 'cc-btn cc-btn--primary' : 'cc-btn'}
                onClick={() => {
                  setTab(id);
                  setFeedback('');
                  setError('');
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === 'licenses' && (
            <LicenseImport overview={o} canWrite={canWrite.allowed} onDone={done} onFail={fail} />
          )}
          {(tab === 'today' || tab === 'all' || tab === 'licenses') && (
            <CompanyTable
              key={tab}
              view={tab}
              overview={o}
              canWrite={canWrite.allowed}
              onDone={done}
              onFail={fail}
            />
          )}
          {tab === 'replies' && <Replies canWrite={canWrite.allowed} onDone={done} onFail={fail} />}
          {tab === 'sent' && <History canWrite={canWrite.allowed} onDone={done} onFail={fail} />}
          {tab === 'settings' && (
            <SettingsForm
              key={o.settings.revision}
              overview={o}
              canWrite={canWrite.allowed}
              onDone={done}
              onFail={fail}
            />
          )}
        </>
      )}
      {!canWrite.allowed && <p className="web-muted web-small">{canWrite.reason}</p>}
      {feedback && (
        <p role="status" className="cc-outreach__note">
          {feedback}
        </p>
      )}
      {error && (
        <p role="alert" className="web-error">
          {error}
        </p>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="cc-outreach__stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function SetupNotices({ o }: { o: z.infer<typeof Overview> }) {
  const items: React.ReactNode[] = [];
  if (!o.settings.businessName || !o.settings.businessAddress)
    items.push(
      <>
        Add your company name and mailing address in <b>Outreach settings</b>. Emails cannot go out
        without them.
      </>,
    );
  if (!o.mailerAvailable)
    items.push(<>The mail server is not running on this server yet, so emails stay queued.</>);
  else if (!o.mailbox.connected)
    items.push(
      <>
        Connect your Gmail or Outlook in <Link href="/settings/email">Settings → Email</Link> to
        send and to read replies.
      </>,
    );
  if (!o.placesConfigured)
    items.push(
      <>
        Company search uses free OpenStreetMap data (© OpenStreetMap contributors). Adding a Google
        Places key on the server finds more companies.
      </>,
    );
  if (/reconnect/i.test(o.settings.lastSyncMessage))
    items.push(
      <>
        Reconnect your mailbox in <Link href="/settings/email">Settings → Email</Link> and allow
        reading mail, so replies show up here.
      </>,
    );
  if (!items.length)
    return o.mailbox.address ? (
      <p className="web-small">Sending from {o.mailbox.address}.</p>
    ) : null;
  return (
    <ul className="cc-outreach__setup">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

interface ChildProps {
  canWrite: boolean;
  onDone: (message: string) => void;
  onFail: (cause: unknown) => void;
}

function CompanyTable({
  view,
  overview,
  canWrite,
  onDone,
  onFail,
}: ChildProps & { view: 'today' | 'all' | 'licenses'; overview: z.infer<typeof Overview> }) {
  const session = useSession();
  const { api } = useApi();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [trade, setTrade] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const params = new URLSearchParams({
    view,
    q,
    ...(status && { status }),
    ...(trade && { trade }),
  });
  const list = useQuery({
    queryKey: orgKey(session.orgId, 'outreach', 'companies', params.toString()),
    queryFn: () => api.get('/v1/outreach/companies?' + params.toString(), { schema: CompanyList }),
  });
  const send = useMutation({
    mutationFn: (ids: string[]) =>
      api.post('/v1/outreach/send', { companyIds: ids }, { schema: SendResult }),
    onSuccess: (r) => {
      setSelected(new Set());
      const skipped = r.skipped.length
        ? ` Skipped ${r.skipped.length}: ${[...new Set(r.skipped.map((s) => s.reason))].join(' ')}`
        : '';
      onDone(`Queued ${r.queued}. ${r.message}${skipped}`);
    },
    onError: onFail,
  });
  const items = list.data?.items ?? [];
  const emailable = items.filter((c) => c.email && c.status !== 'do_not_contact');
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [script, setScript] = useState<string | null>(null);
  const tradeLabel = (id: string) =>
    id === 'licensed_contractor'
      ? 'TDLR licensed contractor'
      : (overview.trades.find((t) => t.id === id)?.label ?? id);
  return (
    <div className="cc-outreach__panel">
      <div className="cc-work-board__form">
        <label>
          Search
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, city or email"
          />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            {Object.entries(STATUS_LABEL).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Trade
          <select value={trade} onChange={(e) => setTrade(e.target.value)}>
            <option value="">All</option>
            {overview.trades.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="cc-outreach__actions">
        <button
          type="button"
          className="cc-btn"
          disabled={!emailable.length}
          onClick={() => setSelected(new Set(emailable.map((c) => c.id)))}
        >
          Select all with email ({emailable.length})
        </button>
        <button
          type="button"
          className="cc-btn"
          disabled={!selected.size}
          onClick={() => setSelected(new Set())}
        >
          Clear selection
        </button>
        <button
          type="button"
          className="cc-btn cc-btn--primary"
          disabled={!canWrite || !selected.size || send.isPending}
          onClick={() => send.mutate([...selected])}
        >
          {send.isPending ? 'Sending…' : `Email selected (${selected.size})`}
        </button>
        <button
          type="button"
          className="cc-btn"
          disabled={!canWrite}
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? 'Close add form' : 'Add a company'}
        </button>
      </div>
      {adding && (
        <AddCompany
          trades={overview.trades}
          onAdded={(m) => {
            setAdding(false);
            onDone(m);
          }}
          onFail={onFail}
        />
      )}
      {list.isPending && <p role="status">Loading companies…</p>}
      {list.error && (
        <ErrorNotice
          error={list.error}
          title="Could not load companies"
          onRetry={() => void list.refetch()}
        />
      )}
      {list.data && !items.length && (
        <p className="web-card">
          {view === 'today'
            ? 'No new companies yet today. Press "Find new companies now", or the morning search will fill this list.'
            : view === 'licenses'
              ? 'No license leads yet. Press "Import license leads" above.'
              : 'No companies match these filters.'}
        </p>
      )}
      <div className="cc-outreach__list">
        {items.map((c) => (
          <article key={c.id} className="web-card cc-outreach__company">
            <div className="cc-work-board__cardhead">
              <label className="cc-outreach__check">
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  disabled={!c.email || c.status === 'do_not_contact'}
                  onChange={() => toggle(c.id)}
                  aria-label={'Select ' + c.name}
                />
                <strong>{c.name}</strong>
              </label>
              <span className={'cc-outreach__badge cc-outreach__badge--' + c.status}>
                {STATUS_LABEL[c.status] ?? c.status}
              </span>
            </div>
            <p className="web-muted web-small">
              {tradeLabel(c.trade)} · {c.city || 'Texas'}
              {c.address ? ' · ' + c.address : ''}
              {c.offerAmountMinor !== null ? ' · Offer ' + money(c.offerAmountMinor) : ''}
            </p>
            {c.licenseType && (
              <p className="web-small">
                {c.licenseType} #{c.licenseNumber}
                {c.ownerName ? ' · Owner ' + c.ownerName : ''}
                {c.county ? ' · ' + c.county + ' County' : ''}
                {c.licenseExpiresOn ? ' · License expires ' + c.licenseExpiresOn : ''}
                {c.score !== null ? ' · Score ' + c.score + '/100' : ''}
              </p>
            )}
            {c.callScript && (
              <>
                <button
                  type="button"
                  className="cc-btn"
                  aria-expanded={script === c.id}
                  onClick={() => setScript(script === c.id ? null : c.id)}
                >
                  {script === c.id ? 'Hide call script' : 'Show call script'}
                </button>
                {script === c.id && (
                  <div className="cc-outreach__script">
                    <p className="cc-outreach__body">{c.callScript}</p>
                    <button
                      type="button"
                      className="cc-btn"
                      onClick={() =>
                        void navigator.clipboard
                          ?.writeText(c.callScript ?? '')
                          .then(() => onDone('Call script copied.'))
                      }
                    >
                      Copy script
                    </button>
                  </div>
                )}
              </>
            )}
            <p className="cc-outreach__contact">
              {c.phone ? (
                <a className="cc-btn" href={'tel:' + c.phone.replace(/[^\d+]/g, '')}>
                  Call {c.phone}
                </a>
              ) : (
                <span className="web-muted">No phone</span>
              )}
              {c.email ? <span>{c.email}</span> : <span className="web-muted">No email yet</span>}
              {c.website && (
                <a href={c.website} target="_blank" rel="noopener noreferrer">
                  Website ↗
                </a>
              )}
            </p>
            <button
              type="button"
              className="cc-btn"
              aria-expanded={open === c.id}
              onClick={() => setOpen(open === c.id ? null : c.id)}
            >
              {open === c.id ? 'Close' : 'Details, call log & edit'}
            </button>
            {open === c.id && (
              <CompanyDetail
                company={c}
                canWrite={canWrite}
                onDone={onDone}
                onFail={onFail}
                onClose={() => setOpen(null)}
              />
            )}
          </article>
        ))}
      </div>
      {list.data && list.data.total > items.length && (
        <p className="web-muted web-small">
          Showing {items.length} of {list.data.total}. Use search or filters to narrow the list.
        </p>
      )}
    </div>
  );
}

function LicenseImport({
  overview,
  canWrite,
  onDone,
  onFail,
}: ChildProps & { overview: z.infer<typeof Overview> }) {
  const { api } = useApi();
  const s = overview.settings;
  const [types, setTypes] = useState<string[]>(
    s.licenseTypes.length ? s.licenseTypes : ['A/C Contractor', 'Electrical Contractor'],
  );
  const [counties, setCounties] = useState(
    (s.licenseCounties.length ? s.licenseCounties : overview.defaultLicenseCounties).join(', '),
  );
  const [days, setDays] = useState(s.licenseDays);
  const run = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/outreach/licenses/import',
        {
          types,
          counties: counties
            .split(',')
            .map((c) => c.trim())
            .filter((c) => c.length >= 2),
          days,
        },
        { schema: ImportResult },
      ),
    onSuccess: (r) => onDone(r.message),
    onError: onFail,
  });
  return (
    <form
      className="cc-work-board__form web-card"
      onSubmit={(e) => {
        e.preventDefault();
        run.mutate();
      }}
    >
      <p className="web-small cc-work-board__wide">
        Free public data from the Texas Department of Licensing and Regulation (TDLR). It lists
        licensed A/C, electrical, sign, elevator, appliance and water-well contractors with owner,
        phone, address and license expiration date. Texas does not license general contractors,
        roofers or concrete companies, so they are not in this file. The date is the license
        expiration, not an insurance date. Before calling, follow Texas telemarketing and federal
        TCPA rules, and never text without written consent.
      </p>
      <fieldset className="cc-work-board__wide cc-outreach__trades">
        <legend>License types</legend>
        {overview.licenseTypes.map((t) => (
          <label key={t.id} className="cc-outreach__check">
            <input
              type="checkbox"
              checked={types.includes(t.id)}
              onChange={(e) =>
                setTypes(e.target.checked ? [...types, t.id] : types.filter((x) => x !== t.id))
              }
            />{' '}
            {t.label}
          </label>
        ))}
      </fieldset>
      <label className="cc-work-board__wide">
        Counties (comma separated, empty = all of Texas)
        <input
          value={counties}
          onChange={(e) => setCounties(e.target.value)}
          placeholder="Dallas, Collin, Denton, Tarrant"
        />
      </label>
      <label>
        License expires within (days)
        <input
          type="number"
          min={7}
          max={365}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        />
      </label>
      <button
        className="cc-btn cc-btn--primary"
        type="submit"
        disabled={!canWrite || !types.length || run.isPending}
      >
        {run.isPending ? 'Importing…' : 'Import license leads'}
      </button>
    </form>
  );
}

function AddCompany({
  trades,
  onAdded,
  onFail,
}: {
  trades: { id: string; label: string }[];
  onAdded: (m: string) => void;
  onFail: (cause: unknown) => void;
}) {
  const session = useSession();
  const { api } = useApi();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [trade, setTrade] = useState(trades[0]?.id ?? 'concrete');
  const [city, setCity] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const add = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/outreach/companies',
        {
          name: name.trim(),
          trade,
          city: city.trim(),
          ...(phone.trim() && { phone: phone.trim() }),
          ...(email.trim() && { email: email.trim() }),
          ...(website.trim() && { website: website.trim() }),
        },
        { schema: Company },
      ),
    onSuccess: (c) => {
      void client.invalidateQueries({ queryKey: orgKey(session.orgId, 'outreach') });
      onAdded(`${c.name} was added to today's list.`);
    },
    onError: onFail,
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  return (
    <form className="cc-work-board__form web-card" onSubmit={submit}>
      <label>
        Company name
        <input
          required
          minLength={2}
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Trade
        <select value={trade} onChange={(e) => setTrade(e.target.value)}>
          {trades.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        City
        <input
          maxLength={100}
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="Dallas"
        />
      </label>
      <label>
        Phone
        <input maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label>
        Email
        <input
          type="email"
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="bids@company.com"
        />
      </label>
      <label>
        Website
        <input
          type="url"
          maxLength={500}
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          placeholder="https://"
        />
      </label>
      <button className="cc-btn cc-btn--primary" type="submit" disabled={add.isPending}>
        {add.isPending ? 'Adding…' : 'Add company'}
      </button>
    </form>
  );
}

function CompanyDetail({
  company,
  canWrite,
  onDone,
  onFail,
  onClose,
}: ChildProps & { company: Company; onClose: () => void }) {
  const session = useSession();
  const { api } = useApi();
  const client = useQueryClient();
  const [email, setEmail] = useState(company.email ?? '');
  const [phone, setPhone] = useState(company.phone ?? '');
  const [notes, setNotes] = useState(company.notes);
  const [status, setStatus] = useState(company.status);
  const [outcome, setOutcome] = useState<string>('no_answer');
  const [callNotes, setCallNotes] = useState('');
  const invalidate = () =>
    void client.invalidateQueries({ queryKey: orgKey(session.orgId, 'outreach') });
  const history = useQuery({
    queryKey: orgKey(session.orgId, 'outreach', 'history', company.id),
    queryFn: () =>
      api.get('/v1/outreach/messages?direction=all&days=365&companyId=' + company.id, {
        schema: MessageList,
      }),
  });
  const save = useMutation({
    mutationFn: () =>
      api.patch(
        '/v1/outreach/companies/' + company.id,
        { email: email.trim(), phone: phone.trim(), notes, status },
        { schema: Company },
      ),
    onSuccess: () => {
      invalidate();
      onDone('Company saved.');
    },
    onError: onFail,
  });
  const findEmail = useMutation({
    mutationFn: () =>
      api.post('/v1/outreach/companies/' + company.id + '/find-email', {}, { schema: Company }),
    onSuccess: (c) => {
      invalidate();
      if (c.email) setEmail(c.email);
      onDone(
        c.email
          ? `Found ${c.email} on their website.`
          : 'No email is published on their website. Try calling instead.',
      );
    },
    onError: onFail,
  });
  const logCall = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/outreach/companies/' + company.id + '/calls',
        { outcome, notes: callNotes.trim() },
        { schema: Company },
      ),
    onSuccess: (c) => {
      setCallNotes('');
      setStatus(c.status);
      invalidate();
      onDone('Call logged.');
    },
    onError: onFail,
  });
  const emailOne = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/outreach/send',
        { companyIds: [company.id], resend: true },
        { schema: SendResult },
      ),
    onSuccess: (r) => {
      invalidate();
      onDone(r.queued ? r.message : (r.skipped[0]?.reason ?? r.message));
    },
    onError: onFail,
  });
  const remove = useMutation({
    mutationFn: () => api.delete('/v1/outreach/companies/' + company.id, { schema: Ok }),
    onSuccess: (r) => {
      invalidate();
      onClose();
      onDone(r.message);
    },
    onError: onFail,
  });
  return (
    <div className="cc-outreach__detail">
      <form
        className="cc-work-board__form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="bids@company.com"
          />
        </label>
        <label>
          Phone
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {Object.entries(STATUS_LABEL).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="cc-work-board__wide">
          Notes
          <textarea
            rows={2}
            maxLength={4000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <button
          className="cc-btn cc-btn--primary"
          type="submit"
          disabled={!canWrite || save.isPending}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="cc-btn"
          disabled={!canWrite || !company.website || findEmail.isPending}
          onClick={() => findEmail.mutate()}
        >
          {findEmail.isPending ? 'Looking…' : 'Find email on website'}
        </button>
        <button
          type="button"
          className="cc-btn"
          disabled={
            !canWrite || !company.email || company.status === 'do_not_contact' || emailOne.isPending
          }
          onClick={() => emailOne.mutate()}
        >
          {emailOne.isPending ? 'Sending…' : 'Email this company now'}
        </button>
        <button
          type="button"
          className="cc-btn"
          disabled={!canWrite || remove.isPending}
          onClick={() => {
            if (window.confirm(`Remove ${company.name} from your list?`)) remove.mutate();
          }}
        >
          Remove from list
        </button>
      </form>
      <form
        className="cc-work-board__form"
        onSubmit={(e) => {
          e.preventDefault();
          logCall.mutate();
        }}
      >
        <label>
          Call outcome
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            {CALL_OUTCOMES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="cc-work-board__wide">
          Call notes
          <input
            maxLength={2000}
            value={callNotes}
            onChange={(e) => setCallNotes(e.target.value)}
            placeholder="Who you spoke with, next step"
          />
        </label>
        <button className="cc-btn" type="submit" disabled={!canWrite || logCall.isPending}>
          {logCall.isPending ? 'Saving…' : 'Log call'}
        </button>
      </form>
      <h4>History</h4>
      {history.isPending && <p role="status">Loading history…</p>}
      {history.data && !history.data.items.length && (
        <p className="web-muted web-small">No emails or calls yet.</p>
      )}
      <ul className="cc-outreach__history">
        {history.data?.items.map((m) => (
          <li key={m.id}>
            <b>{m.direction === 'in' ? 'Reply' : m.direction === 'call' ? 'Call' : 'Email'}</b> ·{' '}
            {new Date(m.at).toLocaleString()} ·{' '}
            {m.direction === 'in'
              ? (REPLY_LABEL[m.classification ?? ''] ?? 'Reply')
              : m.direction === 'call'
                ? m.subject
                : m.status}
            {m.amountMinor !== null && ' · ' + money(m.amountMinor)}
            {m.error && <span className="web-error"> · {m.error}</span>}
            {m.body && (
              <p className="web-small">
                {m.body.length > 400 ? m.body.slice(0, 400) + '…' : m.body}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Replies({ canWrite, onDone, onFail }: ChildProps) {
  const session = useSession();
  const { api } = useApi();
  const client = useQueryClient();
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [kind, setKind] = useState('');
  const list = useQuery({
    queryKey: orgKey(session.orgId, 'outreach', 'replies', String(onlyOpen)),
    queryFn: () =>
      api.get('/v1/outreach/messages?direction=in&unhandled=' + onlyOpen, { schema: MessageList }),
  });
  const mark = useMutation({
    mutationFn: ({ id, handled }: { id: string; handled: boolean }) =>
      api.post('/v1/outreach/messages/' + id + '/handled', { handled }, { schema: Ok }),
    onSuccess: (r) => {
      void client.invalidateQueries({ queryKey: orgKey(session.orgId, 'outreach') });
      onDone(r.message);
    },
    onError: onFail,
  });
  const items = (list.data?.items ?? []).filter((m) => !kind || m.classification === kind);
  return (
    <div className="cc-outreach__panel">
      <div className="cc-work-board__form">
        <label>
          Show
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All replies</option>
            {Object.entries(REPLY_LABEL).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="cc-outreach__check">
          <input
            type="checkbox"
            checked={onlyOpen}
            onChange={(e) => setOnlyOpen(e.target.checked)}
          />{' '}
          Only replies not handled yet
        </label>
      </div>
      {list.isPending && <p role="status">Loading replies…</p>}
      {list.error && (
        <ErrorNotice
          error={list.error}
          title="Could not load replies"
          onRetry={() => void list.refetch()}
        />
      )}
      {list.data && !items.length && (
        <p className="web-card">
          No replies here yet. Replies appear after the mailbox check runs (every 15 minutes, or
          press "Send queued & check replies").
        </p>
      )}
      <div className="cc-outreach__list">
        {items.map((m) => (
          <ReplyCard
            key={m.id}
            m={m}
            canWrite={canWrite}
            busy={mark.isPending}
            onMark={(handled) => mark.mutate({ id: m.id, handled })}
          />
        ))}
      </div>
    </div>
  );
}

function ReplyCard({
  m,
  canWrite,
  busy,
  onMark,
}: {
  m: Message;
  canWrite: boolean;
  busy: boolean;
  onMark: (handled: boolean) => void;
}) {
  return (
    <article className="web-card cc-outreach__company">
      <div className="cc-work-board__cardhead">
        <strong>{m.companyName}</strong>
        <span className={'cc-outreach__badge cc-outreach__badge--' + (m.classification ?? 'reply')}>
          {REPLY_LABEL[m.classification ?? ''] ?? 'Reply'}
          {m.amountMinor !== null ? ' · ' + money(m.amountMinor) : ''}
        </span>
      </div>
      <p className="web-muted web-small">
        {m.fromEmail} · {new Date(m.at).toLocaleString()} · {m.subject}
      </p>
      <p className="cc-outreach__body">
        {m.body.length > 1200 ? m.body.slice(0, 1200) + '…' : m.body}
      </p>
      <p className="cc-outreach__contact">
        {m.webLink && (
          <a
            className="cc-btn cc-btn--primary"
            href={m.webLink}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open and reply in your mailbox ↗
          </a>
        )}
        {m.companyPhone && (
          <a className="cc-btn" href={'tel:' + m.companyPhone.replace(/[^\d+]/g, '')}>
            Call {m.companyPhone}
          </a>
        )}
        <button
          type="button"
          className="cc-btn"
          disabled={!canWrite || busy}
          onClick={() => onMark(!m.handled)}
        >
          {m.handled ? 'Mark as not handled' : 'Mark as handled'}
        </button>
      </p>
    </article>
  );
}

function History({ canWrite, onDone, onFail }: ChildProps) {
  const session = useSession();
  const { api } = useApi();
  const client = useQueryClient();
  const [direction, setDirection] = useState<'out' | 'call'>('out');
  const list = useQuery({
    queryKey: orgKey(session.orgId, 'outreach', 'history-all', direction),
    queryFn: () => api.get('/v1/outreach/messages?direction=' + direction, { schema: MessageList }),
  });
  const cancel = useMutation({
    mutationFn: (id: string) =>
      api.post('/v1/outreach/messages/' + id + '/cancel', {}, { schema: Ok }),
    onSuccess: (r) => {
      void client.invalidateQueries({ queryKey: orgKey(session.orgId, 'outreach') });
      onDone(r.message);
    },
    onError: onFail,
  });
  return (
    <div className="cc-outreach__panel">
      <div className="cc-outreach__actions">
        <button
          type="button"
          className={direction === 'out' ? 'cc-btn cc-btn--primary' : 'cc-btn'}
          onClick={() => setDirection('out')}
        >
          Emails
        </button>
        <button
          type="button"
          className={direction === 'call' ? 'cc-btn cc-btn--primary' : 'cc-btn'}
          onClick={() => setDirection('call')}
        >
          Calls
        </button>
      </div>
      {list.isPending && <p role="status">Loading…</p>}
      {list.error && (
        <ErrorNotice
          error={list.error}
          title="Could not load history"
          onRetry={() => void list.refetch()}
        />
      )}
      {list.data && !list.data.items.length && (
        <p className="web-card">Nothing in the last 60 days.</p>
      )}
      <ul className="cc-outreach__history">
        {list.data?.items.map((m) => (
          <li key={m.id}>
            <b>{m.companyName}</b> · {new Date(m.at).toLocaleString()} ·{' '}
            {m.direction === 'call'
              ? m.subject
              : `${m.status}${m.toEmail ? ' to ' + m.toEmail : ''}`}
            {m.error && <span className="web-error"> · {m.error}</span>}
            {m.direction === 'out' && (m.status === 'queued' || m.status === 'failed') && (
              <button
                type="button"
                className="cc-btn"
                disabled={!canWrite || cancel.isPending}
                onClick={() => cancel.mutate(m.id)}
              >
                {m.status === 'queued' ? 'Cancel' : 'Remove'}
              </button>
            )}
            {m.direction === 'out' && <p className="web-small">{m.subject}</p>}
            {m.direction === 'call' && m.body && <p className="web-small">{m.body}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SettingsForm({
  overview,
  canWrite,
  onDone,
  onFail,
}: ChildProps & { overview: z.infer<typeof Overview> }) {
  const { api } = useApi();
  const s = overview.settings;
  const [form, setForm] = useState<Settings>(s);
  const [cities, setCities] = useState(s.cities.join(', '));
  const [licenseCounties, setLicenseCounties] = useState(s.licenseCounties.join(', '));
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const save = useMutation({
    mutationFn: () =>
      api.put(
        '/v1/outreach/settings',
        {
          autoRefresh: form.autoRefresh,
          businessName: form.businessName,
          businessAddress: form.businessAddress,
          businessPhone: form.businessPhone,
          trades: form.trades,
          cities: cities
            .split(',')
            .map((c) => c.trim())
            .filter((c) => c.length >= 2),
          dailyLeadTarget: form.dailyLeadTarget,
          dailyEmailLimit: form.dailyEmailLimit,
          subjectTemplate: form.subjectTemplate,
          bodyTemplate: form.bodyTemplate,
          licenseTypes: form.licenseTypes,
          licenseCounties: licenseCounties
            .split(',')
            .map((c) => c.trim())
            .filter((c) => c.length >= 2),
          licenseDays: form.licenseDays,
          callScriptTemplate: form.callScriptTemplate,
        },
        { schema: Settings },
      ),
    onSuccess: () => onDone('Outreach settings saved.'),
    onError: onFail,
  });
  return (
    <form
      className="cc-work-board__form cc-outreach__panel"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <label>
        Your company name
        <input
          required
          maxLength={160}
          value={form.businessName}
          onChange={(e) => set('businessName', e.target.value)}
        />
      </label>
      <label className="cc-work-board__wide">
        Mailing address (required by law in business emails)
        <input
          required
          maxLength={300}
          value={form.businessAddress}
          onChange={(e) => set('businessAddress', e.target.value)}
          placeholder="123 Main St, Carrollton, TX 75006"
        />
      </label>
      <label>
        Phone for replies
        <input
          maxLength={40}
          value={form.businessPhone}
          onChange={(e) => set('businessPhone', e.target.value)}
        />
      </label>
      <fieldset className="cc-work-board__wide cc-outreach__trades">
        <legend>Company types to find</legend>
        {overview.trades.map((t) => (
          <label key={t.id} className="cc-outreach__check">
            <input
              type="checkbox"
              checked={form.trades.includes(t.id)}
              onChange={(e) =>
                set(
                  'trades',
                  e.target.checked ? [...form.trades, t.id] : form.trades.filter((x) => x !== t.id),
                )
              }
            />{' '}
            {t.label}
          </label>
        ))}
      </fieldset>
      <label className="cc-work-board__wide">
        Cities (comma separated; leave empty to cover {overview.defaultCities.length} Texas cities
        in rotation)
        <input
          value={cities}
          onChange={(e) => setCities(e.target.value)}
          placeholder="Dallas, Fort Worth, Carrollton"
        />
      </label>
      <label>
        New companies per morning
        <input
          type="number"
          min={0}
          max={100}
          value={form.dailyLeadTarget}
          onChange={(e) => set('dailyLeadTarget', Number(e.target.value))}
        />
      </label>
      <label>
        Most emails per day
        <input
          type="number"
          min={0}
          max={200}
          value={form.dailyEmailLimit}
          onChange={(e) => set('dailyEmailLimit', Number(e.target.value))}
        />
      </label>
      <label className="cc-outreach__check">
        <input
          type="checkbox"
          checked={form.autoRefresh}
          onChange={(e) => set('autoRefresh', e.target.checked)}
        />{' '}
        Find new companies every morning
      </label>
      <label className="cc-work-board__wide">
        Email subject
        <input
          required
          maxLength={250}
          value={form.subjectTemplate}
          onChange={(e) => set('subjectTemplate', e.target.value)}
        />
      </label>
      <label className="cc-work-board__wide">
        Email text. You can use{' '}
        {'{{company}} {{city}} {{trade}} {{sender}} {{my_company}} {{my_phone}}'}. Your name,
        address and an opt-out line are added at the end.
        <textarea
          required
          rows={10}
          minLength={20}
          maxLength={8000}
          value={form.bodyTemplate}
          onChange={(e) => set('bodyTemplate', e.target.value)}
        />
      </label>
      <fieldset className="cc-work-board__wide cc-outreach__trades">
        <legend>Import these Texas license types every morning (leave all off to skip)</legend>
        {overview.licenseTypes.map((t) => (
          <label key={t.id} className="cc-outreach__check">
            <input
              type="checkbox"
              checked={form.licenseTypes.includes(t.id)}
              onChange={(e) =>
                set(
                  'licenseTypes',
                  e.target.checked
                    ? [...form.licenseTypes, t.id]
                    : form.licenseTypes.filter((x) => x !== t.id),
                )
              }
            />{' '}
            {t.label}
          </label>
        ))}
      </fieldset>
      <label className="cc-work-board__wide">
        License counties (comma separated)
        <input
          value={licenseCounties}
          onChange={(e) => setLicenseCounties(e.target.value)}
          placeholder={overview.defaultLicenseCounties.join(', ')}
        />
      </label>
      <label>
        License expires within (days)
        <input
          type="number"
          min={7}
          max={365}
          value={form.licenseDays}
          onChange={(e) => set('licenseDays', Number(e.target.value))}
        />
      </label>
      <label className="cc-work-board__wide">
        Call script. You can use{' '}
        {
          '{{owner_first}} {{business}} {{trade}} {{license_type}} {{expires}} {{days_left}} {{city}} {{sender}} {{my_company}} {{my_phone}}'
        }
        .
        <textarea
          rows={10}
          maxLength={4000}
          value={form.callScriptTemplate}
          onChange={(e) => set('callScriptTemplate', e.target.value)}
        />
      </label>
      <button
        className="cc-btn cc-btn--primary"
        type="submit"
        disabled={!canWrite || save.isPending || !form.trades.length}
      >
        {save.isPending ? 'Saving…' : 'Save settings'}
      </button>
    </form>
  );
}
