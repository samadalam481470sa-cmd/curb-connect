'use client';

// Proposals: draft → send → accept → job. Versions lock once sent; amounts are
// builder-entered per option and totals are computed from the defaults + entered tax.
// Sending emails the customer only when email is connected — the version shows the
// honest outcome either way.
import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { emailStateLabel, money, parseDollarsToMinor, prettyStatus } from '../builderOps/shared';

const Money = z.object({ amountMinor: z.number(), currency: z.string() });
const Option = z.object({
  id: z.string(),
  key: z.string(),
  kind: z.enum(['package', 'add_on']),
  tier: z.string().nullable(),
  label: z.string(),
  description: z.string().nullable(),
  estimateRevisionId: z.string().nullable(),
  amount: Money,
  isDefault: z.boolean(),
});
const Version = z.object({
  id: z.string(),
  proposalId: z.string(),
  versionNumber: z.number(),
  status: z.string(),
  content: z.record(z.string(), z.unknown()),
  options: z.array(Option),
  subtotal: Money,
  tax: Money,
  total: Money,
  deposit: Money.nullable(),
  documentSha256: z.string().nullable(),
  sentAt: z.string().nullable(),
  emailState: z.string().default('not_sent'),
  emailNote: z.string().nullable().default(null),
  emailSentAt: z.string().nullable().default(null),
});
const Proposal = z.object({
  id: z.string(),
  orgId: z.string(),
  revision: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  number: z.string(),
  jobId: z.string().nullable(),
  customerId: z.string(),
  contactId: z.string().nullable(),
  title: z.string(),
  status: z.string(),
  currentVersion: Version.nullable(),
  acceptedVersionId: z.string().nullable(),
  expiresOn: z.string().nullable(),
});
const ProposalList = z.object({ items: z.array(Proposal), nextCursor: z.string().nullable() });
const Selection = z.object({
  id: z.string(),
  versionId: z.string(),
  packageOptionId: z.string(),
  addOnOptionIds: z.array(z.string()),
  total: Money,
  selectedVia: z.string(),
  selectedAt: z.string(),
});
const Customer = z.object({ id: z.string(), displayName: z.string() }).passthrough();
const CustomerList = z.object({ items: z.array(Customer) });
const Contact = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
}).passthrough();
const CustomerDetail = z.object({ customer: Customer, contacts: z.array(Contact) });
const EmailStatus = z.object({ emailConnected: z.boolean(), message: z.string() });

type ProposalT = z.infer<typeof Proposal>;
type OptionInput = {
  key: string;
  kind: 'package' | 'add_on';
  label: string;
  amount: string;
  isDefault: boolean;
};

const PRODUCT_LINES = ['roof', 'curb', 'remodel', 'service', 'retail', 'commercial'] as const;

function slugKey(label: string, index: number): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return slug || `option-${index}`;
}

export function ProposalsView() {
  return (
    <RouteGate routeId="proposals">
      <ProposalsContent />
    </RouteGate>
  );
}

function ProposalsContent() {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const canWrite = session.can('proposal:write');
  const canSend = session.can('proposal:send');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const list = useQuery({
    queryKey: orgKey(session.orgId, 'proposals', 'list'),
    queryFn: () => api.get('/v1/proposals', { schema: ProposalList }),
  });
  const customers = useQuery({
    queryKey: orgKey(session.orgId, 'proposals', 'customers'),
    queryFn: () => api.get('/v1/customers', { schema: CustomerList }),
  });
  const emailStatus = useQuery({
    queryKey: orgKey(session.orgId, 'proposals', 'email-status'),
    queryFn: () => api.get('/v1/proposals/email-status', { schema: EmailStatus }),
  });
  const detail = useQuery({
    queryKey: orgKey(session.orgId, 'proposals', 'detail', selectedId ?? ''),
    queryFn: () => api.get(`/v1/proposals/${selectedId}`, { schema: Proposal }),
    enabled: Boolean(selectedId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'proposals') });
  };
  const fail = (e: unknown) => setError(errorHint(e));

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/v1/proposals', body, { schema: Proposal }),
    onSuccess: (p) => {
      setError('');
      setSelectedId(p.id);
      invalidate();
    },
    onError: fail,
  });

  const [newCustomer, setNewCustomer] = useState('');
  const [newContact, setNewContact] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newExpires, setNewExpires] = useState('');
  const [firstLabel, setFirstLabel] = useState('Standard package');
  const [firstAmount, setFirstAmount] = useState('');

  const customerDetail = useQuery({
    queryKey: orgKey(session.orgId, 'proposals', 'customer', newCustomer),
    queryFn: () => api.get(`/v1/customers/${newCustomer}`, { schema: CustomerDetail }),
    enabled: Boolean(newCustomer),
  });

  function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!newCustomer || !newTitle.trim() || !firstLabel.trim()) return;
    create.mutate({
      customerId: newCustomer,
      contactId: newContact || undefined,
      title: newTitle.trim(),
      expiresOn: newExpires || undefined,
      options: [
        {
          key: slugKey(firstLabel, 0),
          kind: 'package',
          label: firstLabel.trim(),
          amountMinor: parseDollarsToMinor(firstAmount) ?? 0,
          isDefault: true,
        },
      ],
      content: { scope: '', terms: '' },
    });
    setNewTitle('');
  }

  return (
    <main>
      <PageHeader title="Proposals" />
      {emailStatus.data ? <p className="web-muted">{emailStatus.data.message}</p> : null}
      {error ? (
        <p className="web-error" role="alert">
          {error}
        </p>
      ) : null}
      {list.error ? <ErrorNotice error={list.error} /> : null}

      {canWrite ? (
        <form className="web-card" onSubmit={onCreate}>
          <h2>New proposal</h2>
          <label>
            Customer
            <select
              className="fl-input"
              value={newCustomer}
              onChange={(e) => {
                setNewCustomer(e.target.value);
                setNewContact('');
              }}
            >
              <option value="">Pick a customer…</option>
              {(customers.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Contact (gets the email)
            <select className="fl-input" value={newContact} onChange={(e) => setNewContact(e.target.value)}>
              <option value="">No contact</option>
              {(customerDetail.data?.contacts ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.displayName}
                  {c.email ? ` — ${c.email}` : ' — no email on file'}
                </option>
              ))}
            </select>
          </label>
          <label>
            Title
            <input className="fl-input" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          </label>
          <label>
            Valid through
            <input className="fl-input" type="date" value={newExpires} onChange={(e) => setNewExpires(e.target.value)} />
          </label>
          <label>
            First package
            <input className="fl-input" value={firstLabel} onChange={(e) => setFirstLabel(e.target.value)} />
          </label>
          <label>
            Package amount ($)
            <input className="fl-input" inputMode="decimal" value={firstAmount} onChange={(e) => setFirstAmount(e.target.value)} />
          </label>
          <button type="submit" className="cc-btn cc-btn--primary" disabled={create.isPending}>
            Create proposal
          </button>
        </form>
      ) : null}

      <section className="web-card" aria-label="Proposals">
        <h2>Proposals</h2>
        {(list.data?.items ?? []).length === 0 && !list.isLoading ? (
          <p className="web-muted">No proposals yet.</p>
        ) : null}
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
          {(list.data?.items ?? []).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className={selectedId === p.id ? 'cc-btn cc-btn--primary' : 'cc-btn'}
                style={{ width: '100%', textAlign: 'left' }}
                onClick={() => setSelectedId(p.id)}
              >
                {p.number} — {p.title} · {prettyStatus(p.status)} ·{' '}
                {p.currentVersion ? money(p.currentVersion.total.amountMinor, p.currentVersion.total.currency) : '—'}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {selectedId && detail.data ? (
        <ProposalDetail
          key={detail.data.currentVersion?.id ?? detail.data.id}
          proposal={detail.data}
          canWrite={canWrite}
          canSend={canSend}
          onChanged={invalidate}
          onError={fail}
        />
      ) : null}
    </main>
  );
}

function ProposalDetail({
  proposal,
  canWrite,
  canSend,
  onChanged,
  onError,
}: {
  proposal: ProposalT;
  canWrite: boolean;
  canSend: boolean;
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const session = useSession();
  const { api } = useApi();
  const version = proposal.currentVersion;
  const isDraft = version?.status === 'draft';
  const content = version?.content ?? {};
  const [scope, setScope] = useState(typeof content.scope === 'string' ? content.scope : '');
  const [terms, setTerms] = useState(typeof content.terms === 'string' ? content.terms : '');
  const [tax, setTax] = useState(version ? String(version.tax.amountMinor / 100) : '0');
  const [deposit, setDeposit] = useState(
    version?.deposit ? String(version.deposit.amountMinor / 100) : '',
  );
  const [options, setOptions] = useState<OptionInput[]>(
    (version?.options ?? []).map((o) => ({
      key: o.key,
      kind: o.kind,
      label: o.label,
      amount: String(o.amount.amountMinor / 100),
      isDefault: o.isDefault,
    })),
  );
  const [acceptPackage, setAcceptPackage] = useState('');
  const [acceptAddOns, setAcceptAddOns] = useState<string[]>([]);
  const [productLine, setProductLine] = useState<string>('remodel');

  const selection = useQuery({
    queryKey: orgKey(session.orgId, 'proposals', 'selection', proposal.id),
    queryFn: async () => {
      try {
        return await api.get(`/v1/proposals/${proposal.id}/selection`, { schema: Selection });
      } catch (e) {
        if (isApiError(e) && e.is('not_found')) return null;
        throw e;
      }
    },
    enabled: proposal.status === 'accepted',
  });

  const save = useMutation({
    mutationFn: () =>
      api.patch(
        `/v1/proposals/${proposal.id}/versions/${version?.id}`,
        {
          content: { scope, terms },
          options: options.map((o, i) => ({
            key: slugKey(o.label, i),
            kind: o.kind,
            label: o.label,
            amountMinor: parseDollarsToMinor(o.amount) ?? 0,
            isDefault: o.isDefault,
          })),
          taxMinor: parseDollarsToMinor(tax) ?? 0,
          depositMinor: parseDollarsToMinor(deposit),
        },
        { schema: Proposal },
      ),
    onSuccess: onChanged,
    onError,
  });
  const send = useMutation({
    mutationFn: () =>
      api.post(
        `/v1/proposals/${proposal.id}/send`,
        {
          versionId: version?.id,
          recipientContactIds: proposal.contactId ? [proposal.contactId] : [],
          requireSignature: false,
        },
        { schema: Proposal },
      ),
    onSuccess: onChanged,
    onError,
  });
  const newVersion = useMutation({
    mutationFn: () => api.post(`/v1/proposals/${proposal.id}/versions`, {}, { schema: Proposal }),
    onSuccess: onChanged,
    onError,
  });
  const accept = useMutation({
    mutationFn: () =>
      api.post(
        `/v1/proposals/${proposal.id}/accept`,
        {
          versionId: version?.id,
          packageOptionId: acceptPackage,
          addOnOptionIds: acceptAddOns,
          createJob: !proposal.jobId,
          productLine,
        },
        { schema: Proposal },
      ),
    onSuccess: onChanged,
    onError,
  });
  const decline = useMutation({
    mutationFn: () => api.post(`/v1/proposals/${proposal.id}/decline`, {}, { schema: Proposal }),
    onSuccess: onChanged,
    onError,
  });

  const packages = useMemo(() => (version?.options ?? []).filter((o) => o.kind === 'package'), [version]);
  const addOns = useMemo(() => (version?.options ?? []).filter((o) => o.kind === 'add_on'), [version]);

  if (!version) return <p className="web-muted">No version yet.</p>;

  return (
    <section className="web-card" aria-label={`Proposal ${proposal.number}`}>
      <h2>
        {proposal.number} — {proposal.title}
      </h2>
      <p className="web-muted">
        Status: {prettyStatus(proposal.status)} · Version {version.versionNumber} (
        {prettyStatus(version.status)}) · Total {money(version.total.amountMinor, version.total.currency)}
        {version.sentAt ? ` · Sent ${new Date(version.sentAt).toLocaleDateString('en-US')}` : ''} ·{' '}
        {emailStateLabel(version.emailState)}
        {version.emailNote ? ` — ${version.emailNote}` : ''}
      </p>
      {proposal.jobId ? <p className="web-muted">Linked job: {proposal.jobId}</p> : null}
      {selection.data ? (
        <p>
          Accepted total: {money(selection.data.total.amountMinor, selection.data.total.currency)} (via{' '}
          {selection.data.selectedVia})
        </p>
      ) : null}

      {isDraft && canWrite ? (
        <div>
          <label>
            Scope of work
            <textarea className="fl-input" rows={4} value={scope} onChange={(e) => setScope(e.target.value)} />
          </label>
          <label>
            Terms
            <textarea className="fl-input" rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} />
          </label>
          <h3>Options</h3>
          {options.map((o, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
              <label>
                Label
                <input
                  className="fl-input"
                  value={o.label}
                  onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                />
              </label>
              <label>
                Kind
                <select
                  className="fl-input"
                  value={o.kind}
                  onChange={(e) =>
                    setOptions(options.map((x, j) => (j === i ? { ...x, kind: e.target.value as 'package' | 'add_on' } : x)))
                  }
                >
                  <option value="package">Package</option>
                  <option value="add_on">Add-on</option>
                </select>
              </label>
              <label>
                Amount ($)
                <input
                  className="fl-input"
                  inputMode="decimal"
                  value={o.amount}
                  onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={o.isDefault}
                  onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, isDefault: e.target.checked } : x)))}
                />{' '}
                Default
              </label>
              <button type="button" className="cc-btn" onClick={() => setOptions(options.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="cc-btn"
            onClick={() =>
              setOptions([...options, { key: `option-${options.length}`, kind: 'package', label: '', amount: '', isDefault: false }])
            }
          >
            Add option
          </button>
          <label>
            Tax ($)
            <input className="fl-input" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />
          </label>
          <label>
            Deposit ($, optional)
            <input className="fl-input" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="cc-btn cc-btn--primary" disabled={save.isPending} onClick={() => save.mutate()}>
              Save draft
            </button>
            {canSend ? (
              <button
                type="button"
                className="cc-btn"
                disabled={send.isPending || !proposal.contactId}
                title={proposal.contactId ? '' : 'Add a contact to email this proposal'}
                onClick={() => send.mutate()}
              >
                Send proposal
              </button>
            ) : null}
          </div>
          {!proposal.contactId ? (
            <p className="web-muted">This proposal has no contact, so it cannot be emailed. Create it with a contact to send.</p>
          ) : null}
        </div>
      ) : (
        <div>
          <p>{typeof content.scope === 'string' && content.scope ? content.scope : 'No scope written.'}</p>
          <ul>
            {version.options.map((o) => (
              <li key={o.id}>
                {o.label} ({prettyStatus(o.kind)}) — {money(o.amount.amountMinor, o.amount.currency)}
                {o.isDefault ? ' · default' : ''}
              </li>
            ))}
          </ul>
          {canWrite && !['accepted', 'voided'].includes(proposal.status) ? (
            <button type="button" className="cc-btn" disabled={newVersion.isPending} onClick={() => newVersion.mutate()}>
              Start new draft version
            </button>
          ) : null}
        </div>
      )}

      {canWrite && !['accepted', 'voided', 'declined'].includes(proposal.status) && packages.length > 0 ? (
        <div style={{ marginTop: 16 }}>
          <h3>Record acceptance</h3>
          <label>
            Package
            <select className="fl-input" value={acceptPackage} onChange={(e) => setAcceptPackage(e.target.value)}>
              <option value="">Pick the accepted package…</option>
              {packages.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label} — {money(o.amount.amountMinor, o.amount.currency)}
                </option>
              ))}
            </select>
          </label>
          {addOns.map((o) => (
            <label key={o.id} style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={acceptAddOns.includes(o.id)}
                onChange={(e) =>
                  setAcceptAddOns(e.target.checked ? [...acceptAddOns, o.id] : acceptAddOns.filter((x) => x !== o.id))
                }
              />{' '}
              {o.label} — {money(o.amount.amountMinor, o.amount.currency)}
            </label>
          ))}
          {!proposal.jobId ? (
            <label>
              Product line for the new job
              <select className="fl-input" value={productLine} onChange={(e) => setProductLine(e.target.value)}>
                {PRODUCT_LINES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              disabled={accept.isPending || !acceptPackage}
              onClick={() => accept.mutate()}
            >
              Accept{proposal.jobId ? '' : ' + create job'}
            </button>
            <button type="button" className="cc-btn" disabled={decline.isPending} onClick={() => decline.mutate()}>
              Mark declined
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
