'use client';

// Workstreams 07-09: outgoing invoices, received bills and the ledger, in one screen.
//
// The two sides are deliberately separate: "Sent" is this company's receivable record and
// "Received" is another company's invoice, frozen as it arrived. Every action is guarded by the
// same permission the API enforces, and a refusal is explained rather than hidden (PLT-015 A).
import {
  type Bill,
  type Connection,
  type IssuedInvoice,
  type NetworkProject,
} from '@fieldline/contracts';
import {
  Button,
  DataTable,
  EmptyState,
  Field,
  Select,
  StatusPill,
  TextInput,
  useToast,
  type DataTableColumn,
} from '@fieldline/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { InvoiceOperations } from './InvoiceOperations';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ErrorNotice, GuardedButton, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint, newIdempotencyKey } from '../../lib/api';
import { useDisplay } from '../../lib/display';
import { formatDate, formatMoney } from '../../lib/format';
import { orgKey, useApi, useSession } from '../../lib/session';

/** Dollars typed by a person -> integer cents. Rounds once, at the boundary. */
export function parseMoneyInput(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

function todayPlusDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export function BillingView({ routeId = 'billing' }: { routeId?: 'billing' | 'billing.bills' }) {
  return (
    <RouteGate routeId={routeId}>
      <BillingContent />
    </RouteGate>
  );
}

function BillingContent() {
  const { endpoints } = useApi();
  const session = useSession();
  const display = useDisplay();
  const queryClient = useQueryClient();
  const invoicesKey = orgKey(session.orgId, 'billing', 'invoices');
  const billsKey = orgKey(session.orgId, 'billing', 'bills');
  const ledgerKey = orgKey(session.orgId, 'billing', 'ledger');
  const connectionsKey = orgKey(session.orgId, 'network', 'connections');
  const projectsKey = orgKey(session.orgId, 'network', 'projects');

  const invoices = useQuery({ queryKey: invoicesKey, queryFn: () => endpoints.invoices() });
  const bills = useQuery({ queryKey: billsKey, queryFn: () => endpoints.bills() });
  const ledger = useQuery({
    queryKey: ledgerKey,
    queryFn: () => endpoints.ledger(),
    enabled: session.check('ledger:read').allowed,
  });
  const connections = useQuery({
    queryKey: connectionsKey,
    queryFn: () => endpoints.connections(),
  });
  const projects = useQuery({ queryKey: projectsKey, queryFn: () => endpoints.networkProjects() });

  const activePartners = (connections.data?.items ?? []).filter(
    (c) => c.status === 'active' && c.scopes.includes('invoices'),
  );
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const selectedBill = (bills.data?.items ?? []).find((b) => b.id === selectedBillId) ?? null;

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: invoicesKey });
    void queryClient.invalidateQueries({ queryKey: billsKey });
    void queryClient.invalidateQueries({ queryKey: ledgerKey });
  };

  return (
    <>
      <div className="cc-invoice-dashboard-link"><Link href="/invoice-dashboard" className="cc-btn cc-btn--primary">
        Open Invoice Master Dashboard
      </Link></div>
      <PageHeader
        title="Billing"
        description="Invoices you issue to other companies, the bills they send you, and the ledger entries that follow settlement. Each company keeps its own books."
      />

      {activePartners.length === 0 && (
        <p className="web-muted">
          No active invoice connection yet. Add one in <a href="/network">Network</a> before issuing
          an invoice to another company.
        </p>
      )}

      <section aria-labelledby="sent-heading" className="web-section">
        <h2 id="sent-heading">Invoices you sent</h2>
        <IssueInvoiceForm
          partners={activePartners}
          projects={projects.data?.items ?? []}
          onIssued={refreshAll}
        />
        {invoices.error ? (
          <ErrorNotice
            error={invoices.error}
            title="Invoices could not be loaded"
            onRetry={() => void invoices.refetch()}
          />
        ) : (
          <SentInvoiceTable
            invoices={invoices.data?.items ?? []}
            loading={invoices.isPending}
            onChanged={refreshAll}
          />
        )}
      </section>

      <InvoiceOperations
        invoices={invoices.data?.items ?? []}
        companyName={
          session.me.memberships.find((membership) => membership.orgId === session.orgId)
            ?.orgDisplayName ?? 'Company'
        }
      />

      <section aria-labelledby="bills-heading" className="web-section">
        <h2 id="bills-heading">Bills you received</h2>
        {bills.error ? (
          <ErrorNotice
            error={bills.error}
            title="Bills could not be loaded"
            onRetry={() => void bills.refetch()}
          />
        ) : (
          <BillTable
            bills={bills.data?.items ?? []}
            loading={bills.isPending}
            locale={display.locale}
            timeZone={display.timeZone}
            selectedId={selectedBillId}
            onSelect={setSelectedBillId}
          />
        )}
        {selectedBill && (
          <BillDetail
            bill={selectedBill}
            onChanged={refreshAll}
            onClose={() => setSelectedBillId(null)}
          />
        )}
      </section>

      <section aria-labelledby="ledger-heading" className="web-section">
        <h2 id="ledger-heading">Ledger</h2>
        {ledger.error ? (
          <ErrorNotice
            error={ledger.error}
            title="The ledger could not be loaded"
            onRetry={() => void ledger.refetch()}
          />
        ) : !session.check('ledger:read').allowed ? (
          <p className="web-denied-reason">{session.check('ledger:read').reason}</p>
        ) : (
          <>
            <p>
              Debits{' '}
              {formatMoney(
                {
                  amountMinor: ledger.data?.totals.debitsMinor ?? 0,
                  currency: ledger.data?.totals.currency ?? 'USD',
                },
                display.locale,
              )}{' '}
              · credits{' '}
              {formatMoney(
                {
                  amountMinor: ledger.data?.totals.creditsMinor ?? 0,
                  currency: ledger.data?.totals.currency ?? 'USD',
                },
                display.locale,
              )}{' '}
              ·{' '}
              {ledger.data?.totals.balanced
                ? 'balanced'
                : 'not balanced — review before closing the period'}
            </p>
            <ul className="web-list" aria-label="Recent ledger entries">
              {(ledger.data?.entries ?? []).slice(0, 10).map((entry) => (
                <li key={entry.id}>
                  <span>
                    {entry.direction === 'debit' ? 'Debit' : 'Credit'}{' '}
                    {entry.account.replaceAll('_', ' ')} ·{' '}
                    {formatMoney(entry.amount, display.locale)} · {entry.memo ?? 'No memo'} ·{' '}
                    {formatDate(entry.postedAt, display.locale, display.timeZone)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}

function IssueInvoiceForm({
  partners,
  projects,
  onIssued,
}: {
  partners: readonly Connection[];
  projects: readonly NetworkProject[];
  onIssued: () => void;
}) {
  const { endpoints } = useApi();
  const toast = useToast();
  const [partnerOrgId, setPartnerOrgId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [description, setDescription] = useState('Roof replacement — final invoice');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('1250.00');
  const [taxPercent, setTaxPercent] = useState('0');
  const [dueOn, setDueOn] = useState(todayPlusDays(30));
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);

  const create = useMutation({
    mutationFn: () =>
      endpoints.createInvoice(
        {
          recipientOrgId: partnerOrgId,
          ...(projectId ? { projectId } : {}),
          dueOn,
          taxRate: (Number(taxPercent) / 100).toString(),
          lines: [
            {
              description,
              quantity,
              unit: 'each',
              unitPriceMinor: parseMoneyInput(price) ?? 0,
            },
          ],
        },
        key,
      ),
    onSuccess: (invoice) => {
      toast.show({
        tone: 'success',
        message: `Draft ${invoice.number} created. Send it when it is ready.`,
      });
      setKey(newIdempotencyKey());
      onIssued();
    },
    onError: (error) => toast.show({ tone: 'danger', message: errorHint(error) }),
  });

  if (partners.length === 0) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!partnerOrgId) return setFieldError('Choose the company this invoice is for.');
    if (!description.trim()) return setFieldError('Describe what is being billed.');
    if (parseMoneyInput(price) === null) return setFieldError('Enter an amount like 1250.00.');
    if (!/^\d+(\.\d+)?$/.test(quantity) || Number(quantity) <= 0)
      return setFieldError('Enter a quantity above zero.');
    const tax = Number(taxPercent);
    if (!Number.isFinite(tax) || tax < 0 || tax >= 100)
      return setFieldError('Tax must be between 0 and 99.99%.');
    setFieldError(null);
    create.mutate();
  };

  const projectOptions = projects
    .filter((p) => p.partnerOrgId === partnerOrgId)
    .map((p) => ({ value: p.id, label: `${p.reference} · ${p.name}` }));

  return (
    <form className="web-card" onSubmit={submit} noValidate aria-labelledby="issue-invoice-heading">
      <h3 id="issue-invoice-heading">Issue an invoice</h3>
      <Field
        label="Bill to"
        required
        hint="Only companies with an active invoice connection appear here."
      >
        <Select
          value={partnerOrgId}
          placeholder="Choose a company"
          options={partners.map((c) => ({ value: c.partnerOrgId, label: c.partnerDisplayName }))}
          onChange={(e) => {
            setPartnerOrgId(e.target.value);
            setProjectId('');
          }}
        />
      </Field>
      {projectOptions.length > 0 && (
        <Field
          label="Shared project"
          hint="Optional: links the invoice to a project both companies can see."
        >
          <Select
            value={projectId}
            placeholder="No project"
            options={projectOptions}
            onChange={(e) => setProjectId(e.target.value)}
          />
        </Field>
      )}
      <Field label="Description" required>
        <TextInput
          value={description}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Field label="Quantity" required>
        <TextInput
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
      </Field>
      <Field label="Unit price" required hint="In dollars, e.g. 1250.00">
        <TextInput inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
      </Field>
      <Field label="Tax %" hint="Applied once to the subtotal.">
        <TextInput
          inputMode="decimal"
          value={taxPercent}
          onChange={(e) => setTaxPercent(e.target.value)}
        />
      </Field>
      <Field label="Due date" required>
        <TextInput type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} />
      </Field>
      {fieldError && (
        <p className="web-field-error" role="alert">
          {fieldError}
        </p>
      )}
      {create.error && <ErrorNotice error={create.error} title="The invoice was not created" />}
      <Button type="submit" loading={create.isPending}>
        Create draft invoice
      </Button>
    </form>
  );
}

function SentInvoiceTable({
  invoices,
  loading,
  onChanged,
}: {
  invoices: readonly IssuedInvoice[];
  loading: boolean;
  onChanged: () => void;
}) {
  const { endpoints } = useApi();
  const session = useSession();
  const display = useDisplay();
  const toast = useToast();
  const [sendingId, setSendingId] = useState<string | null>(null);
  const issueCheck = session.check('invoice:issue');

  const send = useMutation({
    mutationFn: (invoice: IssuedInvoice) => endpoints.sendInvoice(invoice.id),
    onSuccess: (invoice) => {
      toast.show({
        tone: 'success',
        message: `${invoice.number} delivered to ${invoice.recipientName ?? 'the company'}.`,
      });
      setSendingId(null);
      onChanged();
    },
    onError: (error) => toast.show({ tone: 'danger', message: errorHint(error) }),
  });

  const columns: DataTableColumn<IssuedInvoice>[] = [
    {
      id: 'number',
      header: 'Number',
      primary: true,
      sortValue: (i) => i.number,
      cell: (i) => i.number,
    },
    {
      id: 'to',
      header: 'Bill to',
      sortValue: (i) => i.recipientName ?? '',
      cell: (i) => i.recipientName ?? '—',
    },
    {
      id: 'total',
      header: 'Total',
      sortValue: (i) => i.totalMinor,
      cell: (i) => formatMoney({ amountMinor: i.totalMinor, currency: i.currency }, display.locale),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (i) => i.deliveryStatus,
      cell: (i) => <StatusPill status={i.deliveryStatus} size="sm" />,
    },
    {
      id: 'due',
      header: 'Due',
      sortValue: (i) => i.dueOn ?? '',
      cell: (i) => (i.dueOn ? formatDate(i.dueOn, display.locale, display.timeZone) : '—'),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (i) =>
        i.deliveryStatus === 'draft' ? (
          <GuardedButton
            size="sm"
            deniedReason={issueCheck.allowed ? undefined : issueCheck.reason}
            loading={send.isPending && sendingId === i.id}
            onClick={() => {
              setSendingId(i.id);
              send.mutate(i);
            }}
          >
            Send invoice
          </GuardedButton>
        ) : (
          <span className="web-muted web-small">Delivered</span>
        ),
    },
  ];

  return (
    <DataTable
      caption="Invoices you sent"
      captionHidden
      columns={columns}
      rows={invoices}
      rowKey={(i) => i.id}
      state={loading ? { status: 'loading', label: 'Loading invoices' } : undefined}
      emptyTitle="No invoices yet. Create a draft above, then send it to the connected company."
    />
  );
}

function BillTable({
  bills,
  loading,
  locale,
  timeZone,
  selectedId,
  onSelect,
}: {
  bills: readonly Bill[];
  loading: boolean;
  locale: string;
  timeZone?: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const columns: DataTableColumn<Bill>[] = [
    {
      id: 'number',
      header: 'Number',
      primary: true,
      sortValue: (b) => b.number,
      cell: (b) => b.number,
    },
    { id: 'from', header: 'From', sortValue: (b) => b.issuerName, cell: (b) => b.issuerName },
    {
      id: 'total',
      header: 'Total',
      sortValue: (b) => b.totalMinor,
      cell: (b) => formatMoney({ amountMinor: b.totalMinor, currency: b.currency }, locale),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (b) => b.status,
      cell: (b) => <StatusPill status={b.status} size="sm" />,
    },
    {
      id: 'due',
      header: 'Due',
      sortValue: (b) => b.dueOn ?? '',
      cell: (b) => (b.dueOn ? formatDate(b.dueOn, locale, timeZone) : '—'),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (b) => (
        <Button
          size="sm"
          variant={b.id === selectedId ? 'secondary' : 'ghost'}
          onClick={() => onSelect(b.id)}
        >
          {b.id === selectedId ? 'Reviewing' : 'Review'}
        </Button>
      ),
    },
  ];
  return (
    <DataTable
      caption="Bills you received"
      captionHidden
      columns={columns}
      rows={bills}
      rowKey={(b) => b.id}
      state={loading ? { status: 'loading', label: 'Loading bills' } : undefined}
      emptyTitle="No bills received. A connected company's invoice appears here for approval or dispute."
    />
  );
}

function BillDetail({
  bill,
  onChanged,
  onClose,
}: {
  bill: Bill;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { endpoints } = useApi();
  const session = useSession();
  const display = useDisplay();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<'bank_transfer' | 'check' | 'cash' | 'card_stand_in'>(
    'bank_transfer',
  );
  const [key] = useState(newIdempotencyKey);
  const approveCheck = session.check('bill:approve');
  const disputeCheck = session.check('bill:dispute');
  const payCheck = session.check('bill:pay');

  const run = (message: string) => {
    toast.show({ tone: 'success', message });
    onChanged();
  };
  const fail = (error: unknown) => toast.show({ tone: 'danger', message: errorHint(error) });

  const approve = useMutation({
    mutationFn: () => endpoints.approveBill(bill.id),
    onSuccess: () => run(`${bill.number} approved. ${bill.issuerName} has been notified.`),
    onError: fail,
  });
  const dispute = useMutation({
    mutationFn: () => endpoints.disputeBill(bill.id, reason),
    onSuccess: () => run(`${bill.number} disputed. ${bill.issuerName} sees your reason.`),
    onError: fail,
  });
  const settle = useMutation({
    mutationFn: () => endpoints.settleBill(bill.id, method, undefined, key),
    onSuccess: () => run(`Payment of ${bill.number} recorded and the ledger updated.`),
    onError: fail,
  });

  return (
    <div className="web-card" aria-label={`Bill ${bill.number} detail`}>
      <h3>
        {bill.number} · {bill.issuerName}
      </h3>
      <p className="web-muted">
        Issued {bill.issuedOn ? formatDate(bill.issuedOn, display.locale, display.timeZone) : '—'}
        {bill.dueOn ? ` · due ${formatDate(bill.dueOn, display.locale, display.timeZone)}` : ''}
        {bill.projectName ? ` · ${bill.projectName}` : ''} ·{' '}
        <StatusPill status={bill.status} size="sm" />
      </p>
      <ul className="web-list" aria-label="Bill lines">
        {bill.lines.map((line, index) => (
          <li key={`${line.description}-${index}`}>
            <span>
              {line.description} · {line.quantity} ×{' '}
              {formatMoney(
                { amountMinor: line.unitPriceMinor, currency: bill.currency },
                display.locale,
              )}{' '}
              ={' '}
              {formatMoney(
                { amountMinor: line.amountMinor, currency: bill.currency },
                display.locale,
              )}
            </span>
          </li>
        ))}
      </ul>
      <p>
        Subtotal{' '}
        {formatMoney({ amountMinor: bill.subtotalMinor, currency: bill.currency }, display.locale)}{' '}
        · tax {formatMoney({ amountMinor: bill.taxMinor, currency: bill.currency }, display.locale)}{' '}
        ·{' '}
        <strong>
          {formatMoney({ amountMinor: bill.totalMinor, currency: bill.currency }, display.locale)}
        </strong>
      </p>
      {bill.disputeReason && <p className="web-denied-reason">Disputed: {bill.disputeReason}</p>}

      <div className="web-inline-form">
        <GuardedButton
          deniedReason={
            bill.status === 'received'
              ? approveCheck.allowed
                ? undefined
                : approveCheck.reason
              : `A ${bill.status} bill cannot be approved.`
          }
          loading={approve.isPending}
          onClick={() => approve.mutate()}
        >
          Approve bill
        </GuardedButton>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>

      <Field label="Dispute reason" hint="At least 10 characters. The issuer sees this text.">
        <TextInput value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <GuardedButton
        variant="danger"
        disabled={reason.trim().length < 10}
        deniedReason={
          bill.status === 'received' || bill.status === 'approved'
            ? disputeCheck.allowed
              ? undefined
              : disputeCheck.reason
            : `A ${bill.status} bill cannot be disputed.`
        }
        loading={dispute.isPending}
        onClick={() => dispute.mutate()}
      >
        Dispute bill
      </GuardedButton>

      <Field
        label="Record payment"
        hint="No card processor is connected. This records a manual or stand-in settlement and posts the ledger."
      >
        <Select
          value={method}
          options={[
            { value: 'bank_transfer', label: 'Bank transfer' },
            { value: 'check', label: 'Check' },
            { value: 'cash', label: 'Cash' },
            { value: 'card_stand_in', label: 'Card (stand-in, no processor)' },
          ]}
          onChange={(e) => setMethod(e.target.value as typeof method)}
        />
      </Field>
      <GuardedButton
        deniedReason={
          bill.status === 'approved'
            ? payCheck.allowed
              ? undefined
              : payCheck.reason
            : 'Approve the bill before recording a payment.'
        }
        loading={settle.isPending}
        onClick={() => settle.mutate()}
      >
        Record payment
      </GuardedButton>

      {bill.status === 'paid' && (
        <EmptyState
          title="Settled"
          description="The issuer's invoice and ledger were updated in the same transaction."
        />
      )}
    </div>
  );
}
