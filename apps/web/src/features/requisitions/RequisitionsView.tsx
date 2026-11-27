'use client';

// Requisitions + Backorders (blueprint gap 7): field/office material
// requests with submit/approve, converting into ONE draft purchase order
// (converting twice returns the same PO), and an open-backorder aging view
// (ordered − received, with entered expected dates).
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { money, prettyStatus } from '../builderOps/shared';

const Item = z.object({
  label: z.string(),
  quantity: z.number(),
  unit: z.string(),
  unitPriceMinor: z.number().nullable().optional(),
});
const Requisition = z.object({
  id: z.string(),
  jobId: z.string(),
  jobNumber: z.string(),
  jobTitle: z.string(),
  costCode: z.string().nullable(),
  supplierName: z.string().nullable(),
  items: z.array(Item),
  totalMinor: z.number().nullable(),
  neededBy: z.string().nullable(),
  status: z.string(),
  convertedOrderId: z.string().nullable(),
  note: z.string().nullable(),
  revision: z.number(),
  createdAt: z.string(),
});
type RequisitionT = z.infer<typeof Requisition>;
const Backorder = z.object({
  supplierOrderId: z.string(),
  supplierName: z.string(),
  orderStatus: z.string(),
  lineIndex: z.number(),
  label: z.string(),
  orderedQty: z.number(),
  receivedQty: z.number(),
  backorderedQty: z.number(),
  expectedOn: z.string().nullable(),
  note: z.string().nullable(),
  ageDays: z.number(),
  overdue: z.boolean(),
});
const Aging = z.object({
  asOf: z.string(),
  items: z.array(Backorder),
  openCount: z.number(),
  overdueCount: z.number(),
});
const Job = z.object({ id: z.string(), number: z.string(), title: z.string() });

const toMinor = (dollars: string) => {
  const n = Number(dollars);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export function RequisitionsView() {
  return (
    <RouteGate routeId="requisitions">
      <Content />
    </RouteGate>
  );
}

function Content() {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const canWrite = session.check('requisition:write').allowed;
  const canApprove = session.check('requisition:approve').allowed;

  const requisitions = useQuery({
    queryKey: orgKey(session.orgId, 'requisitions', 'list'),
    queryFn: () => api.get('/v1/requisitions', { schema: z.object({ items: z.array(Requisition) }) }),
  });
  const aging = useQuery({
    queryKey: orgKey(session.orgId, 'requisitions', 'backorders'),
    queryFn: () => api.get('/v1/requisitions/backorders', { schema: Aging }),
  });
  const jobs = useQuery({
    queryKey: orgKey(session.orgId, 'requisitions', 'jobs'),
    queryFn: () => api.get('/v1/jobs', { schema: z.object({ items: z.array(Job) }) }),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'requisitions') });
  const onError = (cause: unknown) => setError(errorHint(cause));

  const [jobId, setJobId] = useState('');
  const [costCode, setCostCode] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [neededBy, setNeededBy] = useState('');
  const [itemsText, setItemsText] = useState('');
  const create = useMutation({
    mutationFn: () => {
      const items = itemsText
        .split('\n')
        .map((row) => row.trim())
        .filter(Boolean)
        .map((row) => {
          const [label, quantity, unit, price] = row.split('|').map((p) => p.trim());
          return {
            label: label ?? '',
            quantity: Number(quantity) || 0,
            unit: unit || 'each',
            unitPriceMinor: price ? toMinor(price) : null,
          };
        });
      return api.post(
        '/v1/requisitions',
        {
          jobId,
          costCode: costCode.trim() || null,
          supplierName: supplierName.trim() || null,
          items,
          neededBy: neededBy || null,
        },
        { schema: Requisition },
      );
    },
    onSuccess: () => { setItemsText(''); setError(''); refresh(); },
    onError,
  });

  const transition = useMutation({
    mutationFn: (v: { req: RequisitionT; action: 'submit' | 'approve' | 'reject' | 'convert' }) =>
      api.post(`/v1/requisitions/${v.req.id}/${v.action}`, {}, { schema: Requisition }),
    onSuccess: (req, v) => {
      setError('');
      if (v.action === 'convert') {
        setNote(`Converted to draft purchase order ${req.convertedOrderId ?? ''}. Converting again returns the same PO — no duplicates.`);
      }
      refresh();
    },
    onError,
  });

  const [expectedInputs, setExpectedInputs] = useState<Record<string, string>>({});
  const setExpected = useMutation({
    mutationFn: (v: { orderId: string; lineIndex: number; expectedOn: string }) =>
      api.put(`/v1/requisitions/backorders/${v.orderId}/${v.lineIndex}`, { expectedOn: v.expectedOn || null }, { schema: z.object({ ok: z.boolean() }) }),
    onSuccess: () => { setError(''); refresh(); },
    onError,
  });

  return (
    <div>
      <PageHeader title="Requisitions" description="Material requests that convert to purchase orders, plus open backorders." />
      {error ? <ErrorNotice error={error} /> : null}
      {note ? <p role="status">{note}</p> : null}

      <section className="cc-panel">
        <h3>Purchase requisitions</h3>
        <ul>
          {(requisitions.data?.items ?? []).map((r) => (
            <li key={r.id}>
              <strong>{r.jobNumber} — {r.jobTitle}</strong>
              {r.costCode ? ` · ${r.costCode}` : ''} · {prettyStatus(r.status)}
              {r.supplierName ? ` · supplier ${r.supplierName}` : ''}
              {r.neededBy ? ` · needed by ${r.neededBy}` : ''}
              {r.totalMinor !== null ? ` · ${money(r.totalMinor)}` : ' · unpriced'}
              <div className="web-small">
                {r.items.map((i, idx) => (
                  <span key={idx}>{i.label} ×{i.quantity} {i.unit}{idx < r.items.length - 1 ? '; ' : ''}</span>
                ))}
              </div>
              {canWrite && r.status === 'draft' ? (
                <button type="button" className="cc-btn cc-btn--sm" onClick={() => transition.mutate({ req: r, action: 'submit' })}>Submit</button>
              ) : null}
              {canApprove && r.status === 'submitted' ? (
                <>
                  <button type="button" className="cc-btn cc-btn--sm" onClick={() => transition.mutate({ req: r, action: 'approve' })}>Approve</button>
                  <button type="button" className="cc-btn cc-btn--sm" onClick={() => transition.mutate({ req: r, action: 'reject' })}>Reject</button>
                </>
              ) : null}
              {canWrite && r.status === 'approved' ? (
                <button type="button" className="cc-btn cc-btn--sm" onClick={() => transition.mutate({ req: r, action: 'convert' })}>Convert to draft PO</button>
              ) : null}
              {r.status === 'converted' ? <span className="web-small"> PO: {r.convertedOrderId}</span> : null}
            </li>
          ))}
          {(requisitions.data?.items ?? []).length === 0 ? <li>No requisitions yet.</li> : null}
        </ul>
        {canWrite ? (
          <div>
            <h4>New requisition</h4>
            <div className="cc-grid">
              <select aria-label="Job" value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">Select a job…</option>
                {(jobs.data?.items ?? []).map((j) => <option key={j.id} value={j.id}>{j.number} — {j.title}</option>)}
              </select>
              <input aria-label="Cost code" placeholder="Cost code" value={costCode} onChange={(e) => setCostCode(e.target.value)} />
              <input aria-label="Supplier" placeholder="Supplier (intended)" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
              <input type="date" aria-label="Needed by" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
              <textarea
                aria-label="Items, one per row: label | quantity | unit | unit price dollars"
                placeholder={'One item per row: label | quantity | unit | unit price ($, optional)\nStuds 2x4 | 100 | pc | 4.75\nOSB sheets | 20 | sheet'}
                value={itemsText}
                onChange={(e) => setItemsText(e.target.value)}
                rows={4}
              />
            </div>
            <button type="button" className="cc-btn" disabled={!jobId || !itemsText.trim()} onClick={() => create.mutate()}>
              Create requisition
            </button>
          </div>
        ) : null}
      </section>

      <section className="cc-panel">
        <h3>Open backorders (as of {aging.data?.asOf ?? '—'})</h3>
        {aging.data ? (
          <>
            <p className="web-small">{aging.data.openCount} open line(s) · {aging.data.overdueCount} past their entered expected date. Quantities are ordered − received from recorded receipts.</p>
            <ul>
              {aging.data.items.map((b) => {
                const key = `${b.supplierOrderId}-${b.lineIndex}`;
                return (
                  <li key={key}>
                    <strong>{b.label}</strong> — {b.supplierName} ({prettyStatus(b.orderStatus)}): ordered {b.orderedQty} ·
                    received {b.receivedQty} · <strong>backordered {b.backorderedQty}</strong> · open {b.ageDays}d
                    {b.expectedOn ? ` · expected ${b.expectedOn}` : ' · no expected date entered'}
                    {b.overdue ? ' · OVERDUE' : ''}
                    {canWrite ? (
                      <span>
                        {' '}
                        <input
                          type="date"
                          aria-label={`Expected date for ${b.label}`}
                          value={expectedInputs[key] ?? ''}
                          onChange={(e) => setExpectedInputs((p) => ({ ...p, [key]: e.target.value }))}
                        />
                        <button
                          type="button"
                          className="cc-btn cc-btn--sm"
                          onClick={() => setExpected.mutate({ orderId: b.supplierOrderId, lineIndex: b.lineIndex, expectedOn: expectedInputs[key] ?? '' })}
                        >
                          Set expected
                        </button>
                      </span>
                    ) : null}
                  </li>
                );
              })}
              {aging.data.items.length === 0 ? <li>No open backorders — everything ordered has been received.</li> : null}
            </ul>
          </>
        ) : <p>Loading…</p>}
      </section>
    </div>
  );
}
