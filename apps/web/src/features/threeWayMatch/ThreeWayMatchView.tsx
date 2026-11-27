'use client';

// Three-Way Match (blueprint gap 4): record receipts against supplier
// orders, then match an AP invoice to its PO with the invoice-side figures
// entered from the supplier's invoice (billed qty/unit price per line, tax,
// freight, vendor, cost code). Statuses: matched / price_variance /
// quantity_variance / unmatched. Variances are decided with a reason; when a
// match record exists, AP approval is blocked until matched or approved.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { money, prettyStatus } from '../builderOps/shared';

const OrderItem = z.object({
  id: z.string(),
  supplierName: z.string(),
  status: z.string(),
  reference: z.string().nullable(),
  totalMinor: z.number().nullable(),
  jobId: z.string(),
});
const SummaryLine = z.object({
  lineIndex: z.number(),
  label: z.string(),
  unit: z.string(),
  orderedQty: z.number(),
  receivedQty: z.number(),
  unitPriceMinor: z.number().nullable(),
});
const Summary = z.object({
  supplierOrderId: z.string(),
  supplierName: z.string(),
  status: z.string(),
  lines: z.array(SummaryLine),
});
const ApInvoice = z.object({
  id: z.string(),
  vendorName: z.string(),
  invoiceNumber: z.string().nullable(),
  costCode: z.string().nullable(),
  amountMinor: z.number(),
  status: z.string(),
});
const Match = z.object({
  id: z.string(),
  apInvoiceId: z.string(),
  supplierOrderId: z.string().nullable(),
  status: z.string(),
  billedLines: z.array(z.object({ lineIndex: z.number(), billedQty: z.number(), billedUnitPriceMinor: z.number() })),
  billedTaxMinor: z.number(),
  billedFreightMinor: z.number(),
  billedVendorName: z.string(),
  billedCostCode: z.string().nullable(),
  computedBilledTotalMinor: z.number(),
  invoiceAmountMinor: z.number(),
  amountMatchesInvoice: z.boolean(),
  vendorMatches: z.boolean(),
  costCodeMatches: z.boolean(),
  lines: z.array(
    z.object({
      lineIndex: z.number(),
      label: z.string(),
      orderedQty: z.number(),
      receivedQty: z.number(),
      billedQty: z.number(),
      poUnitPriceMinor: z.number().nullable(),
      billedUnitPriceMinor: z.number(),
      quantityOk: z.boolean(),
      priceOk: z.boolean().nullable(),
    }),
  ),
  reasons: z.array(z.string()),
  varianceReason: z.string().nullable(),
  duplicateInvoiceIds: z.array(z.string()),
  revision: z.number(),
});

const toMinor = (dollars: string) => {
  const n = Number(dollars);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export function ThreeWayMatchView() {
  return (
    <RouteGate routeId="threeWayMatch">
      <Content />
    </RouteGate>
  );
}

function Content() {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [orderId, setOrderId] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const canWrite = session.check('ap:write').allowed;
  const canApprove = session.check('ap:approve').allowed;

  const orders = useQuery({
    queryKey: orgKey(session.orgId, 'three-way-match', 'orders'),
    queryFn: () => api.get('/v1/three-way-match/orders', { schema: z.object({ items: z.array(OrderItem) }) }),
  });
  const summary = useQuery({
    queryKey: orgKey(session.orgId, 'three-way-match', orderId || 'none', 'summary'),
    enabled: orderId.length > 0,
    queryFn: () => api.get(`/v1/three-way-match/orders/${orderId}/receiving-summary`, { schema: Summary }),
  });
  const apInvoices = useQuery({
    queryKey: orgKey(session.orgId, 'three-way-match', 'ap-invoices'),
    queryFn: () => api.get('/v1/job-cost/ap-invoices', { schema: z.object({ items: z.array(ApInvoice) }) }),
  });
  const match = useQuery({
    queryKey: orgKey(session.orgId, 'three-way-match', invoiceId || 'none', 'match'),
    enabled: invoiceId.length > 0,
    retry: false,
    queryFn: () => api.get(`/v1/three-way-match/ap-invoices/${invoiceId}/match`, { schema: Match }),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'three-way-match') });
  const onError = (cause: unknown) => setError(errorHint(cause));

  // --- receipt form
  const [receivedOn, setReceivedOn] = useState('');
  const [receiptQty, setReceiptQty] = useState<Record<number, string>>({});
  const [receiptCondition, setReceiptCondition] = useState<Record<number, string>>({});
  const createReceipt = useMutation({
    mutationFn: () =>
      api.post(
        `/v1/three-way-match/orders/${orderId}/receipts`,
        {
          receivedOn,
          lines: (summary.data?.lines ?? [])
            .filter((l) => (receiptQty[l.lineIndex] ?? '') !== '')
            .map((l) => ({
              lineIndex: l.lineIndex,
              qtyReceived: Number(receiptQty[l.lineIndex]) || 0,
              condition: receiptCondition[l.lineIndex] ?? 'ok',
            })),
        },
        { schema: z.object({ id: z.string() }) },
      ),
    onSuccess: () => { setError(''); setReceiptQty({}); refresh(); },
    onError,
  });

  // --- match form
  const [billedQty, setBilledQty] = useState<Record<number, string>>({});
  const [billedPrice, setBilledPrice] = useState<Record<number, string>>({});
  const [tax, setTax] = useState('');
  const [freight, setFreight] = useState('');
  const [billedVendor, setBilledVendor] = useState('');
  const [billedCostCode, setBilledCostCode] = useState('');
  const selectedInvoice = (apInvoices.data?.items ?? []).find((i) => i.id === invoiceId);
  const runMatch = useMutation({
    mutationFn: () =>
      api.post(
        `/v1/three-way-match/ap-invoices/${invoiceId}/match`,
        {
          supplierOrderId: orderId,
          billedLines: (summary.data?.lines ?? []).map((l) => ({
            lineIndex: l.lineIndex,
            billedQty: Number(billedQty[l.lineIndex] ?? '0') || 0,
            billedUnitPriceMinor: toMinor(billedPrice[l.lineIndex] ?? '0'),
          })),
          billedTaxMinor: toMinor(tax),
          billedFreightMinor: toMinor(freight),
          billedVendorName: billedVendor.trim() || selectedInvoice?.vendorName || '',
          billedCostCode: billedCostCode.trim() || selectedInvoice?.costCode || null,
        },
        { schema: Match },
      ),
    onSuccess: () => { setError(''); refresh(); },
    onError,
  });

  const [varianceReason, setVarianceReason] = useState('');
  const decide = useMutation({
    mutationFn: (decision: 'approve_variance' | 'reject_variance') =>
      api.post(`/v1/three-way-match/ap-invoices/${invoiceId}/decide`, { decision, reason: varianceReason.trim() }, { schema: Match }),
    onSuccess: () => { setError(''); setVarianceReason(''); refresh(); },
    onError,
  });

  const m = match.data;

  return (
    <div>
      <PageHeader title="Three-Way Match" description="Match supplier invoices to purchase orders and receipts before approval." />
      {error ? <ErrorNotice error={error} /> : null}
      <p className="web-small">
        How it works: pick the purchase order, record what actually arrived, then enter the billed
        quantities/prices from the supplier’s invoice. When a match record exists, the invoice cannot be
        approved in Payables until it is <strong>matched</strong> or a variance is approved with a reason.
        Invoices with no match record keep the normal Payables flow.
      </p>

      <section className="cc-panel">
        <h3>1. Purchase order &amp; receiving</h3>
        <select aria-label="Supplier order" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
          <option value="">Select a supplier order…</option>
          {(orders.data?.items ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.supplierName}{o.reference ? ` (${o.reference})` : ''} — {prettyStatus(o.status)}{o.totalMinor !== null ? ` · ${money(o.totalMinor)}` : ''}
            </option>
          ))}
        </select>
        {summary.data ? (
          <div>
            <ul>
              {summary.data.lines.map((l) => (
                <li key={l.lineIndex}>
                  {l.label}: ordered {l.orderedQty} {l.unit} · received {l.receivedQty}
                  {l.unitPriceMinor !== null ? ` · PO price ${money(l.unitPriceMinor)}` : ' · PO price not entered'}
                  {canWrite ? (
                    <>
                      {' '}
                      <input
                        aria-label={`Quantity received now for ${l.label}`}
                        placeholder="Qty received now"
                        inputMode="decimal"
                        value={receiptQty[l.lineIndex] ?? ''}
                        onChange={(e) => setReceiptQty((p) => ({ ...p, [l.lineIndex]: e.target.value }))}
                      />
                      <select
                        aria-label={`Condition for ${l.label}`}
                        value={receiptCondition[l.lineIndex] ?? 'ok'}
                        onChange={(e) => setReceiptCondition((p) => ({ ...p, [l.lineIndex]: e.target.value }))}
                      >
                        <option value="ok">OK</option>
                        <option value="short">Short</option>
                        <option value="damaged">Damaged</option>
                      </select>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
            {canWrite ? (
              <div className="cc-grid">
                <input type="date" aria-label="Received on" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
                <button type="button" className="cc-btn cc-btn--sm" disabled={!receivedOn} onClick={() => createReceipt.mutate()}>
                  Record receipt
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="cc-panel">
        <h3>2. Match an AP invoice</h3>
        <select aria-label="AP invoice" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
          <option value="">Select an AP invoice…</option>
          {(apInvoices.data?.items ?? []).map((i) => (
            <option key={i.id} value={i.id}>
              {i.vendorName}{i.invoiceNumber ? ` #${i.invoiceNumber}` : ''} — {money(i.amountMinor)} · {prettyStatus(i.status)}
            </option>
          ))}
        </select>

        {m ? (
          <div>
            <p>
              Match status: <strong>{prettyStatus(m.status)}</strong> · computed billed total {money(m.computedBilledTotalMinor)} vs
              invoice {money(m.invoiceAmountMinor)} {m.amountMatchesInvoice ? '(agree)' : '(DISAGREE)'} · vendor{' '}
              {m.vendorMatches ? 'matches' : 'MISMATCH'} · cost code {m.costCodeMatches ? 'matches' : 'MISMATCH'}
            </p>
            {m.duplicateInvoiceIds.length > 0 ? (
              <p><strong>Possible duplicate:</strong> {m.duplicateInvoiceIds.length} other invoice(s) with the same vendor, number, and amount.</p>
            ) : null}
            {m.reasons.length > 0 ? (
              <ul>{m.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            ) : null}
            <ul>
              {m.lines.map((l) => (
                <li key={l.lineIndex}>
                  {l.label}: billed {l.billedQty} @ {money(l.billedUnitPriceMinor)} · received {l.receivedQty} ·
                  PO price {l.poUnitPriceMinor !== null ? money(l.poUnitPriceMinor) : 'not entered'} ·
                  qty {l.quantityOk ? 'ok' : 'OVER'} · price {l.priceOk === null ? 'cannot verify' : l.priceOk ? 'ok' : 'DIFFERS'}
                </li>
              ))}
            </ul>
            {m.varianceReason ? <p>Variance decision: {m.varianceReason}</p> : null}
            {canApprove && ['unmatched', 'price_variance', 'quantity_variance'].includes(m.status) ? (
              <div className="cc-grid">
                <input aria-label="Variance reason" placeholder="Reason (required)" value={varianceReason} onChange={(e) => setVarianceReason(e.target.value)} />
                <button type="button" className="cc-btn cc-btn--sm" disabled={!varianceReason.trim()} onClick={() => decide.mutate('approve_variance')}>Approve variance</button>
                <button type="button" className="cc-btn cc-btn--sm" disabled={!varianceReason.trim()} onClick={() => decide.mutate('reject_variance')}>Reject variance</button>
              </div>
            ) : null}
          </div>
        ) : invoiceId ? (
          <p>No match record yet for this invoice.</p>
        ) : null}

        {canWrite && orderId && invoiceId && summary.data ? (
          <div>
            <h4>Enter billed figures from the supplier invoice</h4>
            {summary.data.lines.map((l) => (
              <div key={l.lineIndex} className="cc-grid">
                <span>{l.label}</span>
                <input
                  aria-label={`Billed quantity for ${l.label}`}
                  placeholder="Billed qty"
                  inputMode="decimal"
                  value={billedQty[l.lineIndex] ?? ''}
                  onChange={(e) => setBilledQty((p) => ({ ...p, [l.lineIndex]: e.target.value }))}
                />
                <input
                  aria-label={`Billed unit price dollars for ${l.label}`}
                  placeholder="Billed unit price ($)"
                  inputMode="decimal"
                  value={billedPrice[l.lineIndex] ?? ''}
                  onChange={(e) => setBilledPrice((p) => ({ ...p, [l.lineIndex]: e.target.value }))}
                />
              </div>
            ))}
            <div className="cc-grid">
              <input aria-label="Billed tax dollars" placeholder="Tax ($)" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />
              <input aria-label="Billed freight dollars" placeholder="Freight ($)" inputMode="decimal" value={freight} onChange={(e) => setFreight(e.target.value)} />
              <input aria-label="Billed vendor name" placeholder={`Vendor on invoice (default: ${selectedInvoice?.vendorName ?? ''})`} value={billedVendor} onChange={(e) => setBilledVendor(e.target.value)} />
              <input aria-label="Billed cost code" placeholder={`Cost code on invoice (default: ${selectedInvoice?.costCode ?? 'none'})`} value={billedCostCode} onChange={(e) => setBilledCostCode(e.target.value)} />
            </div>
            <button type="button" className="cc-btn" onClick={() => runMatch.mutate()}>Run match</button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
