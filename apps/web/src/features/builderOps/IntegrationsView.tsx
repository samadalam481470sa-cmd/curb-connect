'use client';

// Integrations (builder operations): QuickBooks Online sync and the payments rail, both
// gated until the owner connects them. The status cards say exactly what is missing — no
// fake "connected" state, no pretend sync, no pretend payouts. CSV/TSV import already
// exists elsewhere in Field Pro for bringing books in by file.
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { dateTime, money, prettyStatus } from './shared';

const QbStatus = z.object({
  state: z.enum(['connected', 'not_connected', 'misconfigured']),
  missing: z.array(z.string()),
  message: z.string(),
  lastSyncedAt: z.string().nullable(),
});
const QbSyncResult = z.object({
  state: z.enum(['ok', 'not_connected']),
  message: z.string(),
  pushed: z.number(),
  pulled: z.number(),
});
const PaymentsStatus = z.object({
  provider: z.string().nullable(),
  state: z.enum(['connected', 'not_connected', 'unsupported_provider']),
  missing: z.array(z.string()),
  message: z.string(),
  lienWaiverGating: z.boolean(),
  earlyPayEnabled: z.boolean(),
});
const PayoutResult = z.object({
  state: z.enum(['queued', 'not_connected', 'blocked']),
  message: z.string(),
});
const ApInvoice = z.object({
  id: z.string(),
  vendorName: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  status: z.string(),
  lienReleaseId: z.string().nullable(),
});
const ApList = z.object({ items: z.array(ApInvoice) });

export function IntegrationsView() {
  return (
    <RouteGate routeId="integrations">
      <IntegrationsContent />
    </RouteGate>
  );
}

function IntegrationsContent() {
  const session = useSession();
  const { api } = useApi();
  const [error, setError] = useState('');

  const qb = useQuery({
    queryKey: orgKey(session.orgId, 'integrations', 'qb-status'),
    queryFn: () => api.get('/v1/integrations/quickbooks/status', { schema: QbStatus }),
  });
  const payments = useQuery({
    queryKey: orgKey(session.orgId, 'integrations', 'payments-status'),
    queryFn: () => api.get('/v1/integrations/payments-rail/status', { schema: PaymentsStatus }),
  });
  const ap = useQuery({
    queryKey: orgKey(session.orgId, 'integrations', 'ap-approved'),
    queryFn: () => api.get('/v1/job-cost/ap-invoices?status=approved', { schema: ApList }),
  });

  const sync = useMutation({
    mutationFn: () => api.post('/v1/integrations/quickbooks/sync', {}, { schema: QbSyncResult }),
    onError: (cause) => setError(errorHint(cause)),
  });

  const payout = useMutation({
    mutationFn: (apInvoiceId: string) =>
      api.post('/v1/integrations/payments-rail/payout', { apInvoiceId, method: 'ach' }, { schema: PayoutResult }),
    onError: (cause) => setError(errorHint(cause)),
  });

  return (
    <main className="cc-work-board">
      <PageHeader
        title="Integrations"
        description="QuickBooks Online sync and contractor payouts. Both stay off until you connect them — this page shows exactly what each one needs."
      />
      {error && <p className="web-error" role="alert">{error}</p>}

      <section className="web-card" aria-labelledby="qb-title">
        <h2 id="qb-title">QuickBooks Online</h2>
        {qb.isError && <ErrorNotice error={qb.error} title="Could not load QuickBooks status" />}
        {qb.data && (
          <>
            <p>
              Status:{' '}
              <strong>
                {qb.data.state === 'connected'
                  ? 'Connected'
                  : qb.data.state === 'misconfigured'
                    ? 'Misconfigured'
                    : 'Not connected'}
              </strong>
            </p>
            <p className="web-muted">{qb.data.message}</p>
            {qb.data.missing.length > 0 && (
              <p className="web-muted">Still needed: {qb.data.missing.join(', ')}.</p>
            )}
            {qb.data.lastSyncedAt && <p className="web-muted">Last synced {dateTime(qb.data.lastSyncedAt)}.</p>}
            <p className="web-muted">
              To connect, create an Intuit developer app and set its client id and secret on the
              API service. Until then, use the CSV/TSV import in Billing to bring records in by
              file. Field Pro keeps job cost and AP in-app; QuickBooks stays your general ledger.
            </p>
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              disabled={sync.isPending}
              onClick={() => sync.mutate()}
            >
              Sync with QuickBooks
            </button>
            {sync.data && (
              <p>
                {prettyStatus(sync.data.state)} — {sync.data.message} (pushed {sync.data.pushed}, pulled{' '}
                {sync.data.pulled})
              </p>
            )}
          </>
        )}
      </section>

      <section className="web-card" aria-labelledby="payments-title">
        <h2 id="payments-title">Payments rail</h2>
        {payments.isError && <ErrorNotice error={payments.error} title="Could not load payments status" />}
        {payments.data && (
          <>
            <p>
              Status:{' '}
              <strong>
                {payments.data.state === 'connected'
                  ? `Connected (${payments.data.provider})`
                  : payments.data.state === 'unsupported_provider'
                    ? 'Provider not supported'
                    : 'Not connected'}
              </strong>
            </p>
            <p className="web-muted">{payments.data.message}</p>
            {payments.data.missing.length > 0 && (
              <p className="web-muted">Still needed: {payments.data.missing.join(', ')}.</p>
            )}
            <p className="web-muted">
              Lien-waiver gating: {payments.data.lienWaiverGating ? 'on' : 'off'} · Early pay:{' '}
              {payments.data.earlyPayEnabled ? 'on' : 'off'}. Moving money needs a regulated
              provider (Stripe Connect or Dwolla) and your compliance decisions — payouts stay
              off until you connect one. Until then, record payments in Payables.
            </p>
          </>
        )}
        <h3>Approved AP invoices</h3>
        {ap.data && ap.data.items.length === 0 && <p className="web-muted">No approved AP invoices waiting.</p>}
        {ap.data?.items.map((a) => (
          <div key={a.id} className="cc-detail-row">
            <div>
              {a.vendorName} — {money(a.amountMinor, a.currency)}
              {a.lienReleaseId ? ' · lien waiver linked' : ' · no lien waiver linked'}
            </div>
            <button
              type="button"
              className="cc-btn"
              disabled={payout.isPending}
              onClick={() => payout.mutate(a.id)}
            >
              Pay via rail
            </button>
          </div>
        ))}
        {payout.data && (
          <p>
            {prettyStatus(payout.data.state)} — {payout.data.message}
          </p>
        )}
      </section>
    </main>
  );
}
