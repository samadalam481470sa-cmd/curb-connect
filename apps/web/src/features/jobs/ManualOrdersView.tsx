'use client';

// Manual supplier orders (SupplyPro GM core). Same draft as the flag-gated supplier
// orders, but created for a manually created customer/job without needing the
// `ops.supplier_orders` flag. Drafts only — no supplier integration exists, so nothing
// here sends an order to a supplier; send the draft to your supplier yourself.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

const OrderLine = z.object({
  label: z.string(), quantity: z.number(), unit: z.string(),
  unitPriceMinor: z.number().nullable().optional(),
});
const Order = z.object({
  id: z.string(), jobId: z.string(), supplierName: z.string(), status: z.string(),
  origin: z.string().nullable(),
  reference: z.string().nullable(), lines: z.array(OrderLine),
  totalMinor: z.number().nullable(), currency: z.string(),
  requestedDeliveryOn: z.string().nullable(), createdAt: z.string(),
});
const OrderList = z.object({ items: z.array(Order) });
const Job = z.object({
  id: z.string(), number: z.string(), title: z.string(),
  productLine: z.string(), origin: z.string().nullable(),
});
const JobsList = z.object({ items: z.array(Job) });

const dollarValue = (minor: number | null, currency = 'USD') => minor === null
  ? 'Not priced'
  : new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);

export function ManualOrdersView() {
  return (
    <RouteGate routeId="manualOrders">
      <ManualOrdersContent />
    </RouteGate>
  );
}

function ManualOrdersContent() {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const key = orgKey(session.orgId, 'manual-orders', 'list');
  const list = useQuery({ queryKey: key, queryFn: () => api.get('/v1/supplier-orders/manual', { schema: OrderList }) });
  const jobs = useQuery({
    queryKey: orgKey(session.orgId, 'manual-orders', 'jobs'),
    queryFn: () => api.get('/v1/jobs', { schema: JobsList }),
  });
  const [jobId, setJobId] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [lineLabel, setLineLabel] = useState('');
  const [lineQty, setLineQty] = useState('1');
  const [lineUnit, setLineUnit] = useState('pc');
  const [error, setError] = useState('');
  const canWrite = session.check('supplier_order:write');

  const create = useMutation({
    mutationFn: () => api.post('/v1/supplier-orders/manual', {
      jobId,
      supplierName: supplierName.trim(),
      lines: [{
        label: lineLabel.trim(),
        quantity: Number(lineQty) || 0,
        unit: lineUnit.trim() || 'pc',
        unitPriceMinor: null,
      }],
    }, { schema: Order }),
    onSuccess: () => {
      setSupplierName(''); setLineLabel(''); setLineQty('1'); setError('');
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const submit = useMutation({
    mutationFn: (id: string) => api.post(
      `/v1/supplier-orders/${encodeURIComponent(id)}/submit`, {},
      { schema: z.object({ ok: z.boolean() }) }),
    onError: (cause) => setError(errorHint(cause)),
  });

  const jobName = (id: string) => {
    const job = (jobs.data?.items ?? []).find((j) => j.id === id);
    return job ? `${job.number} — ${job.title}` : id;
  };

  return (
    <div className="cc-stack" style={{ gap: '1rem' }}>
      <PageHeader title="Manual Orders" />
      <p className="web-muted web-small">
        Order drafts for work you created by hand — remodels, service calls, retail and
        commercial jobs that never came through a builder flow. No flag needed to create
        one. Drafts only: no supplier integration is connected, so Field Pro never sends
        these orders — send the draft to your supplier yourself.
      </p>
      {error && <ErrorNotice error={error} />}
      {list.error && <ErrorNotice error={errorHint(list.error)} />}

      {canWrite.allowed && (
        <form
          className="cc-stack"
          onSubmit={(e) => { e.preventDefault(); if (jobId && supplierName.trim() && lineLabel.trim()) create.mutate(); }}
        >
          <label className="cc-field">
            <span>Job</span>
            <select className="cc-input" value={jobId} onChange={(e) => setJobId(e.currentTarget.value)} required>
              <option value="">Select a job…</option>
              {(jobs.data?.items ?? []).map((j) => (
                <option key={j.id} value={j.id}>{j.number} — {j.title}</option>
              ))}
            </select>
          </label>
          <label className="cc-field">
            <span>Supplier name</span>
            <input className="cc-input" value={supplierName} maxLength={200}
              onChange={(e) => setSupplierName(e.currentTarget.value)} required />
          </label>
          <label className="cc-field">
            <span>First line — material</span>
            <input className="cc-input" value={lineLabel} maxLength={200}
              onChange={(e) => setLineLabel(e.currentTarget.value)} required />
          </label>
          <label className="cc-field">
            <span>Quantity</span>
            <input className="cc-input" type="number" min="0" step="any" value={lineQty}
              onChange={(e) => setLineQty(e.currentTarget.value)} required />
          </label>
          <label className="cc-field">
            <span>Unit</span>
            <input className="cc-input" value={lineUnit} maxLength={40}
              onChange={(e) => setLineUnit(e.currentTarget.value)} required />
          </label>
          <button type="submit" className="cc-btn cc-btn--primary" disabled={create.isPending}>
            {create.isPending ? 'Saving…' : 'Save draft'}
          </button>
        </form>
      )}

      <div className="cc-stack">
        {(list.data?.items ?? []).map((o) => (
          <div key={o.id} className="cc-panel">
            <strong>{o.supplierName}</strong> · {o.status} · {dollarValue(o.totalMinor, o.currency)}
            <p className="web-muted web-small">{jobName(o.jobId)}</p>
            <ul>
              {o.lines.map((l, i) => (
                <li key={i}>{l.label} — {l.quantity} {l.unit}</li>
              ))}
            </ul>
            <button type="button" className="cc-btn" disabled={submit.isPending}
              onClick={() => submit.mutate(o.id)}>
              Submit to supplier
            </button>
          </div>
        ))}
        {list.data && list.data.items.length === 0 && (
          <p className="web-muted">No manual order drafts yet. Create one above for any job.</p>
        )}
      </div>
    </div>
  );
}
