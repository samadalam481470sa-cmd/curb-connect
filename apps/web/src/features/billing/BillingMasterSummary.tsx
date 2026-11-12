'use client';

import { useQuery } from '@tanstack/react-query';
import { ErrorNotice } from '../../components/common';
import { orgKey, useApi, useSession } from '../../lib/session';
import { billingMetrics, moneyMinor } from './billingMetrics';

/** Real tenant data only; read-only and hidden when both billing permissions are missing. */
export function BillingMasterSummary() {
  const { endpoints } = useApi();
  const session = useSession();
  const canSent = session.can('invoice:read');
  const canReceived = session.can('bill:read');
  const invoice = useQuery({
    queryKey: orgKey(session.orgId, 'billing', 'invoices'),
    queryFn: () => endpoints.invoices(),
    enabled: canSent,
  });
  const bills = useQuery({
    queryKey: orgKey(session.orgId, 'billing', 'bills'),
    queryFn: () => endpoints.bills(),
    enabled: canReceived,
  });
  if (!canSent && !canReceived) return null;
  const incomplete = (canSent && !invoice.data) || (canReceived && !bills.data);
  const buckets = billingMetrics(invoice.data?.items ?? [], bills.data?.items ?? []);
  const busy = (canSent && invoice.isPending) || (canReceived && bills.isPending);
  return (
    <section className="web-card" aria-labelledby="billing-master-heading"
      style={{ marginTop: 24 }}>
      <div className="web-section__head">
        <h2 id="billing-master-heading">Master invoice dashboard</h2>
        <a href="/billing">Open billing →</a>
      </div>
      <p className="web-muted web-small">
        Live company records, grouped by currency. Draft value is not booked revenue or a complete
        list of uninvoiced work. Partner invoices received are payables, not sales.
      </p>
      {busy ? (
        <p role="status">Loading invoice totals…</p>
      ) : invoice.error || bills.error ? (
        <ErrorNotice error={invoice.error ?? bills.error} title="Invoice totals unavailable"
          onRetry={() => { void invoice.refetch(); void bills.refetch(); }} />
      ) : incomplete ? (
        <p role="status">Invoice and bill totals are unavailable; nothing is estimated.</p>
      ) : buckets.length === 0 ? (
        <p className="web-muted">No invoice records in this workspace yet.</p>
      ) : (
        <div className="web-table-scroll">
          <table className="web-matrix" style={{ width: '100%', fontVariantNumeric: 'tabular-nums' }}>
            <thead><tr>
              <th scope="col">Currency</th>
              <th scope="col">Draft / to send</th>
              <th scope="col">Sent</th>
              <th scope="col">Received</th>
              <th scope="col">To collect</th>
              <th scope="col">To pay</th>
              <th scope="col">Collected</th>
              <th scope="col">Paid bills</th>
            </tr></thead>
            <tbody>{buckets.map((row) => (
              <tr key={row.currency}>
                <th scope="row">{row.currency}</th>
                <td>{canSent ? moneyMinor(row.draftMinor, row.currency) : '—'}</td>
                <td>{canSent ? <>{moneyMinor(row.sentMinor, row.currency)} ({row.sentCount})</> : '—'}</td>
                <td>{canReceived ? <>{moneyMinor(row.receivedMinor, row.currency)} ({row.receivedCount})</> : '—'}</td>
                <td>{canSent ? moneyMinor(row.receivableMinor, row.currency) : '—'}</td>
                <td>{canReceived ? moneyMinor(row.payableMinor, row.currency) : '—'}</td>
                <td>{canSent ? moneyMinor(row.paidReceivableMinor, row.currency) : '—'}</td>
                <td>{canReceived ? moneyMinor(row.paidPayableMinor, row.currency) : '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
