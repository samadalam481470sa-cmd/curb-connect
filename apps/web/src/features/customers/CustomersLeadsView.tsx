'use client';

import { CreateCustomerRequestSchema, CreateLeadRequestSchema } from '@fieldline/contracts';
import { Button, EmptyState, Field, StatusPill, TextInput } from '@fieldline/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { isApiError, newIdempotencyKey } from '../../lib/api';
import { useDisplay } from '../../lib/display';
import { formatDateTime } from '../../lib/format';
import { orgKey, useApi, useSession } from '../../lib/session';

interface CrmRow {
  readonly id: string;
  readonly createdAt: string;
  readonly status: string;
  readonly displayName?: string;
  readonly kind?: string;
  readonly source?: string;
  readonly summary?: string | null;
}

function isNotAvailable(error: unknown): boolean {
  return (
    isApiError(error) &&
    (error.is('not_found') ||
      error.is('feature_unavailable') ||
      error.is('method_not_allowed') ||
      error.status === 404 ||
      error.status === 501)
  );
}

export function CustomersLeadsView() {
  return (
    <RouteGate routeId="leads">
      <CustomersLeadsContent />
    </RouteGate>
  );
}

function CustomersLeadsContent() {
  const { endpoints } = useApi();
  const session = useSession();
  const display = useDisplay();
  const locale = display.locale;
  const timeZone = display.timeZone ?? 'UTC';
  const qc = useQueryClient();
  const [tab, setTab] = useState<'leads' | 'customers'>('leads');

  const customers = useQuery({
    queryKey: orgKey(session.orgId, 'customers'),
    queryFn: () => endpoints.customers(),
    retry: false,
  });
  const leads = useQuery({
    queryKey: orgKey(session.orgId, 'leads'),
    queryFn: () => endpoints.leads(),
    retry: false,
  });

  const [customerName, setCustomerName] = useState('');
  const [customerKind, setCustomerKind] = useState<'person' | 'business'>('person');
  const [leadSummary, setLeadSummary] = useState('');
  const [leadSource, setLeadSource] = useState<'manual' | 'phone' | 'web_form' | 'referral'>('manual');
  const [formError, setFormError] = useState<string | null>(null);

  const createCustomer = useMutation({
    mutationFn: async () => {
      const parsed = CreateCustomerRequestSchema.safeParse({
        kind: customerKind,
        displayName: customerName.trim(),
        tags: [],
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid customer');
      return endpoints.createCustomer(parsed.data, newIdempotencyKey());
    },
    onSuccess: async () => {
      setCustomerName('');
      setFormError(null);
      await qc.invalidateQueries({ queryKey: orgKey(session.orgId, 'customers') });
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : 'Could not create customer'),
  });

  const createLead = useMutation({
    mutationFn: async () => {
      const parsed = CreateLeadRequestSchema.safeParse({
        source: leadSource,
        summary: leadSummary.trim() || undefined,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Invalid lead');
      return endpoints.createLead(parsed.data, newIdempotencyKey());
    },
    onSuccess: async () => {
      setLeadSummary('');
      setFormError(null);
      await qc.invalidateQueries({ queryKey: orgKey(session.orgId, 'leads') });
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : 'Could not create lead'),
  });

  const customersUnavailable = customers.error && isNotAvailable(customers.error);
  const leadsUnavailable = leads.error && isNotAvailable(leads.error);

  return (
    <>
      <PageHeader
        title="Customers & leads"
        description="Searchable customers and leads shared across Roof Measurement and Curb Cutting."
      />

      <div className="web-subnav" role="tablist" aria-label="CRM sections">
        <button
          type="button"
          className={tab === 'leads' ? 'fl-btn fl-btn--primary fl-btn--sm' : 'fl-btn fl-btn--ghost fl-btn--sm'}
          role="tab"
          aria-selected={tab === 'leads'}
          onClick={() => setTab('leads')}
        >
          Leads
        </button>
        <button
          type="button"
          className={
            tab === 'customers' ? 'fl-btn fl-btn--primary fl-btn--sm' : 'fl-btn fl-btn--ghost fl-btn--sm'
          }
          role="tab"
          aria-selected={tab === 'customers'}
          onClick={() => setTab('customers')}
        >
          Customers
        </button>
      </div>

      {formError && (
        <div className="web-error" role="alert">
          <p>{formError}</p>
        </div>
      )}

      {tab === 'leads' && (
        <section className="web-section" aria-labelledby="leads-heading">
          <h2 id="leads-heading">Leads</h2>
          <div className="web-card">
            <h3>New lead</h3>
            <div className="web-calc-row">
              <Field label="Source">
                <select
                  className="fl-input"
                  value={leadSource}
                  onChange={(e) =>
                    setLeadSource(e.target.value as typeof leadSource)
                  }
                >
                  <option value="manual">Manual</option>
                  <option value="phone">Phone</option>
                  <option value="web_form">Web form</option>
                  <option value="referral">Referral</option>
                </select>
              </Field>
              <Field label="Summary">
                <TextInput
                  value={leadSummary}
                  onChange={(e) => setLeadSummary(e.target.value)}
                  placeholder="Short description"
                />
              </Field>
              <Button
                size="sm"
                loading={createLead.isPending}
                onClick={() => createLead.mutate()}
                disabled={leadsUnavailable === true}
              >
                Create lead
              </Button>
            </div>
            {leadsUnavailable && (
              <p className="web-muted">
                Leads API is not available yet. You can still prepare entries once the endpoint ships.
              </p>
            )}
          </div>

          {leads.isPending ? (
            <p className="web-muted">Loading leads…</p>
          ) : leads.error && !leadsUnavailable ? (
            <ErrorNotice
              error={leads.error}
              title="Leads could not be loaded"
              onRetry={() => void leads.refetch()}
            />
          ) : leadsUnavailable || !leads.data?.items.length ? (
            <EmptyState
              title="No leads yet"
              description={
                leadsUnavailable
                  ? 'The leads API returned unavailable. Nothing to show until the CRM module is live.'
                  : 'Create a lead above, or wait for inbound web/phone enquiries.'
              }
            />
          ) : (
            <CrmTable
              kind="leads"
              items={leads.data.items as CrmRow[]}
              locale={locale}
              timeZone={timeZone}
            />
          )}
        </section>
      )}

      {tab === 'customers' && (
        <section className="web-section" aria-labelledby="customers-heading">
          <h2 id="customers-heading">Customers</h2>
          <div className="web-card">
            <h3>New customer</h3>
            <div className="web-calc-row">
              <Field label="Kind">
                <select
                  className="fl-input"
                  value={customerKind}
                  onChange={(e) => setCustomerKind(e.target.value as 'person' | 'business')}
                >
                  <option value="person">Person</option>
                  <option value="business">Business</option>
                </select>
              </Field>
              <Field label="Display name" required>
                <TextInput
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Name"
                />
              </Field>
              <Button
                size="sm"
                loading={createCustomer.isPending}
                onClick={() => createCustomer.mutate()}
                disabled={!customerName.trim() || customersUnavailable === true}
              >
                Create customer
              </Button>
            </div>
            {customersUnavailable && (
              <p className="web-muted">
                Customers API is unreachable. Check that the API is running and you are signed in.
              </p>
            )}
          </div>

          {customers.isPending ? (
            <p className="web-muted">Loading customers…</p>
          ) : customers.error && !customersUnavailable ? (
            <ErrorNotice
              error={customers.error}
              title="Customers could not be loaded"
              onRetry={() => void customers.refetch()}
            />
          ) : customersUnavailable || !customers.data?.items.length ? (
            <EmptyState
              title="No customers yet"
              description={
                customersUnavailable
                  ? 'The customers API returned unavailable.'
                  : 'Create a customer above to start the job pipeline.'
              }
            />
          ) : (
            <CrmTable
              kind="customers"
              items={customers.data.items as CrmRow[]}
              locale={locale}
              timeZone={timeZone}
            />
          )}
        </section>
      )}
    </>
  );
}

function CrmTable({
  kind,
  items,
  locale,
  timeZone,
}: {
  kind: 'leads' | 'customers';
  items: readonly CrmRow[];
  locale: string;
  timeZone?: string;
}) {
  return (
    <div className="web-table-scroll">
      <table className="web-matrix web-calc-table">
        <thead>
          <tr>
            {kind === 'customers' ? (
              <>
                <th>Name</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Created</th>
              </>
            ) : (
              <>
                <th>Status</th>
                <th>Source</th>
                <th>Summary</th>
                <th>Created</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((row) =>
            kind === 'customers' ? (
              <tr key={row.id}>
                <td>{row.displayName}</td>
                <td>{row.kind}</td>
                <td>
                  <StatusPill status={row.status} size="sm" />
                </td>
                <td>{formatDateTime(row.createdAt, locale, timeZone)}</td>
              </tr>
            ) : (
              <tr key={row.id}>
                <td>
                  <StatusPill status={row.status} size="sm" />
                </td>
                <td>{row.source}</td>
                <td>{row.summary ?? '—'}</td>
                <td>{formatDateTime(row.createdAt, locale, timeZone)}</td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}
