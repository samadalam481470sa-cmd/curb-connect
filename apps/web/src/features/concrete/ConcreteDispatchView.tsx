'use client';

// Concrete Dispatch (blueprint gap 5): mix designs, orders with a dispatch
// board by day, per-load tickets with manual status flow, and the
// delivered-yards draft-invoice handoff. No GPS provider is connected —
// status and ETA are entered manually, never faked live tracking.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { money, prettyStatus } from '../builderOps/shared';

const Mix = z.object({
  id: z.string(),
  name: z.string(),
  strength: z.string().nullable(),
  slump: z.string().nullable(),
  aggregate: z.string().nullable(),
  admixtures: z.string().nullable(),
  pricePerYardMinor: z.number().nullable(),
  active: z.boolean(),
  revision: z.number(),
});
const Truck = z.object({ id: z.string(), name: z.string(), kind: z.string(), identifier: z.string().nullable(), status: z.string() });
const Job = z.object({ id: z.string(), number: z.string(), title: z.string() });
const Load = z.object({
  id: z.string(),
  orderId: z.string(),
  truckAssetId: z.string().nullable(),
  truckName: z.string().nullable(),
  driverName: z.string().nullable(),
  batchTime: z.string().nullable(),
  yardsLoaded: z.number().nullable(),
  yardsDelivered: z.number().nullable(),
  yardsReturned: z.number().nullable(),
  ticketNumber: z.string().nullable(),
  status: z.string(),
  photoRefs: z.array(z.object({ label: z.string(), reference: z.string() })),
  signatureName: z.string().nullable(),
  signedAt: z.string().nullable(),
  note: z.string().nullable(),
  revision: z.number(),
});
type LoadT = z.infer<typeof Load>;
const Order = z.object({
  id: z.string(),
  jobId: z.string(),
  jobNumber: z.string(),
  jobTitle: z.string(),
  mixDesignId: z.string(),
  mixName: z.string(),
  pourLocation: z.string(),
  volumeYards: z.number(),
  requestedOn: z.string(),
  windowStart: z.string().nullable(),
  windowEnd: z.string().nullable(),
  pumpNeeded: z.boolean(),
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  status: z.string(),
  plantName: z.string().nullable(),
  truckAssetId: z.string().nullable(),
  truckName: z.string().nullable(),
  driverName: z.string().nullable(),
  enteredEta: z.string().nullable(),
  invoiceId: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  note: z.string().nullable(),
  loads: z.array(Load),
  totals: z.object({
    loadCount: z.number(),
    completedLoads: z.number(),
    yardsLoaded: z.number(),
    yardsDelivered: z.number(),
    yardsReturned: z.number(),
    billableYards: z.number(),
    billableAmountMinor: z.number().nullable(),
  }),
  revision: z.number(),
});
type OrderT = z.infer<typeof Order>;
const Board = z.object({
  from: z.string(),
  to: z.string(),
  days: z.array(z.object({ date: z.string(), orders: z.array(Order) })),
});

const NEXT: Record<string, string[]> = {
  scheduled: ['batched', 'cancelled'],
  batched: ['en_route', 'cancelled'],
  en_route: ['on_site'],
  on_site: ['pouring'],
  pouring: ['complete'],
  complete: [],
  cancelled: [],
};

const toMinor = (dollars: string) => {
  const n = Number(dollars);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export function ConcreteDispatchView() {
  return (
    <RouteGate routeId="concreteDispatch">
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
  const canWrite = session.check('concrete:write').allowed;
  const canInvoice = session.check('invoice:write').allowed;

  const today = new Date().toISOString().slice(0, 10);
  const [boardFrom, setBoardFrom] = useState(today);
  const [boardTo, setBoardTo] = useState(today);

  const mixes = useQuery({
    queryKey: orgKey(session.orgId, 'concrete', 'mixes'),
    queryFn: () => api.get('/v1/concrete/mix-designs', { schema: z.object({ items: z.array(Mix) }) }),
  });
  const trucks = useQuery({
    queryKey: orgKey(session.orgId, 'concrete', 'trucks'),
    queryFn: () => api.get('/v1/concrete/trucks', { schema: z.object({ items: z.array(Truck) }) }),
  });
  const jobs = useQuery({
    queryKey: orgKey(session.orgId, 'concrete', 'jobs'),
    queryFn: () => api.get('/v1/jobs', { schema: z.object({ items: z.array(Job) }) }),
  });
  const board = useQuery({
    queryKey: orgKey(session.orgId, 'concrete', 'board', boardFrom, boardTo),
    queryFn: () => api.get(`/v1/concrete/dispatch-board?from=${boardFrom}&to=${boardTo}`, { schema: Board }),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'concrete') });
  const onError = (cause: unknown) => setError(errorHint(cause));

  // --- mix form
  const [mixName, setMixName] = useState('');
  const [mixStrength, setMixStrength] = useState('');
  const [mixSlump, setMixSlump] = useState('');
  const [mixAggregate, setMixAggregate] = useState('');
  const [mixAdmixtures, setMixAdmixtures] = useState('');
  const [mixPrice, setMixPrice] = useState('');
  const createMix = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/concrete/mix-designs',
        {
          name: mixName.trim(),
          strength: mixStrength.trim() || null,
          slump: mixSlump.trim() || null,
          aggregate: mixAggregate.trim() || null,
          admixtures: mixAdmixtures.trim() || null,
          pricePerYardMinor: mixPrice.trim() ? toMinor(mixPrice) : null,
        },
        { schema: Mix },
      ),
    onSuccess: () => { setMixName(''); setMixStrength(''); setMixSlump(''); setMixAggregate(''); setMixAdmixtures(''); setMixPrice(''); setError(''); refresh(); },
    onError,
  });

  // --- order form
  const [jobId, setJobId] = useState('');
  const [mixId, setMixId] = useState('');
  const [pourLocation, setPourLocation] = useState('');
  const [volume, setVolume] = useState('');
  const [requestedOn, setRequestedOn] = useState(today);
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [pump, setPump] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [plantName, setPlantName] = useState('');
  const [truckId, setTruckId] = useState('');
  const [driverName, setDriverName] = useState('');
  const createOrder = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/concrete/orders',
        {
          jobId,
          mixDesignId: mixId,
          pourLocation: pourLocation.trim(),
          volumeYards: Number(volume) || 0,
          requestedOn,
          windowStart: windowStart.trim() || null,
          windowEnd: windowEnd.trim() || null,
          pumpNeeded: pump,
          contactName: contactName.trim() || null,
          contactPhone: contactPhone.trim() || null,
          plantName: plantName.trim() || null,
          truckAssetId: truckId || null,
          driverName: driverName.trim() || null,
        },
        { schema: Order },
      ),
    onSuccess: () => { setPourLocation(''); setVolume(''); setError(''); refresh(); },
    onError,
  });

  const orderStatus = useMutation({
    mutationFn: (v: { order: OrderT; status: string }) =>
      api.post(`/v1/concrete/orders/${v.order.id}/status`, { status: v.status }, { schema: Order }),
    onSuccess: () => { setError(''); refresh(); },
    onError,
  });
  const loadStatus = useMutation({
    mutationFn: (v: { load: LoadT; status: string }) =>
      api.post(`/v1/concrete/loads/${v.load.id}/status`, { status: v.status }, { schema: Load }),
    onSuccess: () => { setError(''); refresh(); },
    onError,
  });

  // --- load ticket form (per order, keyed inputs)
  const [loadInputs, setLoadInputs] = useState<Record<string, { ticket: string; loaded: string; delivered: string; returned: string; signature: string }>>({});
  const addLoad = useMutation({
    mutationFn: (order: OrderT) => {
      const input = loadInputs[order.id] ?? { ticket: '', loaded: '', delivered: '', returned: '', signature: '' };
      return api.post(
        `/v1/concrete/orders/${order.id}/loads`,
        {
          ticketNumber: input.ticket.trim() || null,
          yardsLoaded: input.loaded.trim() ? Number(input.loaded) : null,
        },
        { schema: Load },
      );
    },
    onSuccess: () => { setError(''); refresh(); },
    onError,
  });
  const updateLoad = useMutation({
    mutationFn: (load: LoadT) => {
      const input = loadInputs[load.id] ?? { ticket: '', loaded: '', delivered: '', returned: '', signature: '' };
      return api.patch(
        `/v1/concrete/loads/${load.id}`,
        {
          ...(input.delivered.trim() ? { yardsDelivered: Number(input.delivered) } : {}),
          ...(input.returned.trim() ? { yardsReturned: Number(input.returned) } : {}),
          ...(input.signature.trim() ? { signatureName: input.signature.trim() } : {}),
        },
        { schema: Load },
      );
    },
    onSuccess: () => { setError(''); refresh(); },
    onError,
  });

  const generateInvoice = useMutation({
    mutationFn: (order: OrderT) => api.post(`/v1/concrete/orders/${order.id}/invoice`, {}, { schema: Order }),
    onSuccess: (order) => {
      setError('');
      setNote(`Draft invoice ${order.invoiceNumber ?? ''} created for ${order.totals.billableYards} yd delivered. Issue it from Invoices — nothing was sent.`);
      refresh();
    },
    onError,
  });

  const setLoadInput = (key: string, field: 'ticket' | 'loaded' | 'delivered' | 'returned' | 'signature', value: string) =>
    setLoadInputs((prev) => ({
      ...prev,
      [key]: { ticket: '', loaded: '', delivered: '', returned: '', signature: '', ...prev[key], [field]: value },
    }));

  return (
    <div>
      <PageHeader title="Concrete Dispatch" description="Mix designs, pour orders, load tickets, and the dispatch board." />
      {error ? <ErrorNotice error={error} /> : null}
      {note ? <p role="status">{note}</p> : null}
      <p className="web-small">
        Status is advanced manually — no GPS or plant system is connected, so ETAs are entered values,
        not live tracking. Load-ticket signature is a typed-name attestation.
      </p>

      <section className="cc-panel">
        <h3>Mix designs</h3>
        <ul>
          {(mixes.data?.items ?? []).map((m) => (
            <li key={m.id}>
              <strong>{m.name}</strong>
              {m.strength ? ` · ${m.strength}` : ''}{m.slump ? ` · slump ${m.slump}` : ''}{m.aggregate ? ` · ${m.aggregate}` : ''}
              {m.admixtures ? ` · ${m.admixtures}` : ''}
              {m.pricePerYardMinor !== null ? ` · ${money(m.pricePerYardMinor)}/yd` : ' · price not entered'}
              {m.active ? '' : ' · inactive'}
            </li>
          ))}
          {(mixes.data?.items ?? []).length === 0 ? <li>No mix designs yet.</li> : null}
        </ul>
        {canWrite ? (
          <div className="cc-grid">
            <input aria-label="Mix name" placeholder="Name (e.g. 4000 psi slab mix)" value={mixName} onChange={(e) => setMixName(e.target.value)} />
            <input aria-label="Strength" placeholder="Strength (e.g. 4000 psi)" value={mixStrength} onChange={(e) => setMixStrength(e.target.value)} />
            <input aria-label="Slump" placeholder="Slump (e.g. 4 in)" value={mixSlump} onChange={(e) => setMixSlump(e.target.value)} />
            <input aria-label="Aggregate" placeholder="Aggregate" value={mixAggregate} onChange={(e) => setMixAggregate(e.target.value)} />
            <input aria-label="Admixtures" placeholder="Admixtures" value={mixAdmixtures} onChange={(e) => setMixAdmixtures(e.target.value)} />
            <input aria-label="Price per yard dollars" placeholder="Price per yard ($)" inputMode="decimal" value={mixPrice} onChange={(e) => setMixPrice(e.target.value)} />
            <button type="button" className="cc-btn cc-btn--sm" disabled={!mixName.trim()} onClick={() => createMix.mutate()}>Add mix design</button>
          </div>
        ) : null}
      </section>

      {canWrite ? (
        <section className="cc-panel">
          <h3>New concrete order</h3>
          <div className="cc-grid">
            <select aria-label="Job" value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">Select a job…</option>
              {(jobs.data?.items ?? []).map((j) => <option key={j.id} value={j.id}>{j.number} — {j.title}</option>)}
            </select>
            <select aria-label="Mix design" value={mixId} onChange={(e) => setMixId(e.target.value)}>
              <option value="">Select a mix…</option>
              {(mixes.data?.items ?? []).filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input aria-label="Pour location" placeholder="Pour location" value={pourLocation} onChange={(e) => setPourLocation(e.target.value)} />
            <input aria-label="Volume yards" placeholder="Volume (yd³)" inputMode="decimal" value={volume} onChange={(e) => setVolume(e.target.value)} />
            <input type="date" aria-label="Requested date" value={requestedOn} onChange={(e) => setRequestedOn(e.target.value)} />
            <input aria-label="Window start" placeholder="Window start (07:00)" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} />
            <input aria-label="Window end" placeholder="Window end (09:00)" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} />
            <label>
              <input type="checkbox" checked={pump} onChange={(e) => setPump(e.target.checked)} /> Pump needed
            </label>
            <input aria-label="Contact name" placeholder="Site contact" value={contactName} onChange={(e) => setContactName(e.target.value)} />
            <input aria-label="Contact phone" placeholder="Contact phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            <input aria-label="Plant" placeholder="Plant (entered)" value={plantName} onChange={(e) => setPlantName(e.target.value)} />
            <select aria-label="Truck" value={truckId} onChange={(e) => setTruckId(e.target.value)}>
              <option value="">Truck (fleet registry)…</option>
              {(trucks.data?.items ?? []).map((t) => <option key={t.id} value={t.id}>{t.name} ({t.kind})</option>)}
            </select>
            <input aria-label="Driver" placeholder="Driver (entered)" value={driverName} onChange={(e) => setDriverName(e.target.value)} />
          </div>
          <button type="button" className="cc-btn" disabled={!jobId || !mixId || !pourLocation.trim() || !volume} onClick={() => createOrder.mutate()}>
            Create order
          </button>
        </section>
      ) : null}

      <section className="cc-panel">
        <h3>Dispatch board</h3>
        <div className="cc-grid">
          <input type="date" aria-label="Board from" value={boardFrom} onChange={(e) => setBoardFrom(e.target.value)} />
          <input type="date" aria-label="Board to" value={boardTo} onChange={(e) => setBoardTo(e.target.value)} />
        </div>
        {(board.data?.days ?? []).map((day) => (
          <div key={day.date}>
            <h4>{day.date}</h4>
            {day.orders.map((o) => (
              <div key={o.id} className="cc-panel">
                <p>
                  <strong>{o.jobNumber} — {o.jobTitle}</strong> · {o.mixName} · {o.volumeYards} yd³ @ {o.pourLocation}
                  {o.windowStart ? ` · window ${o.windowStart}${o.windowEnd ? `–${o.windowEnd}` : ''}` : ''}
                  {o.pumpNeeded ? ' · PUMP' : ''} · {prettyStatus(o.status)}
                  {o.plantName ? ` · plant ${o.plantName}` : ''}
                  {o.truckName ? ` · truck ${o.truckName}` : ''}
                  {o.driverName ? ` · driver ${o.driverName}` : ''}
                  {o.enteredEta ? ` · ETA (entered) ${o.enteredEta}` : ''}
                </p>
                <p className="web-small">
                  Loads: {o.totals.completedLoads}/{o.totals.loadCount} complete · delivered {o.totals.yardsDelivered} yd ·
                  billable {o.totals.billableYards} yd
                  {o.totals.billableAmountMinor !== null ? ` = ${money(o.totals.billableAmountMinor)}` : ' (mix price not entered)'}
                  {o.invoiceNumber ? ` · invoice ${o.invoiceNumber}` : ''}
                </p>
                {canWrite ? (NEXT[o.status] ?? []).map((s) => (
                  <button key={s} type="button" className="cc-btn cc-btn--sm" onClick={() => orderStatus.mutate({ order: o, status: s })}>
                    → {prettyStatus(s)}
                  </button>
                )) : null}
                {canInvoice && !o.invoiceId && o.totals.billableYards > 0 ? (
                  <button type="button" className="cc-btn cc-btn--sm" onClick={() => generateInvoice.mutate(o)}>Generate draft invoice</button>
                ) : null}

                <ul>
                  {o.loads.map((l) => (
                    <li key={l.id}>
                      Ticket {l.ticketNumber ?? '—'} · {prettyStatus(l.status)}
                      {l.truckName ? ` · ${l.truckName}` : ''}{l.driverName ? ` · ${l.driverName}` : ''}
                      {l.batchTime ? ` · batched ${new Date(l.batchTime).toLocaleString()}` : ''}
                      {' · '}loaded {l.yardsLoaded ?? '—'} · delivered {l.yardsDelivered ?? '—'} · returned {l.yardsReturned ?? '—'}
                      {l.signatureName ? ` · signed: ${l.signatureName}` : ''}
                      {canWrite ? (NEXT[l.status] ?? []).map((s) => (
                        <button key={s} type="button" className="cc-btn cc-btn--sm" onClick={() => loadStatus.mutate({ load: l, status: s })}>
                          → {prettyStatus(s)}
                        </button>
                      )) : null}
                      {canWrite && !['complete', 'cancelled'].includes(l.status) ? (
                        <span>
                          <input aria-label="Yards delivered" placeholder="Delivered yd" inputMode="decimal" value={loadInputs[l.id]?.delivered ?? ''} onChange={(e) => setLoadInput(l.id, 'delivered', e.target.value)} />
                          <input aria-label="Yards returned" placeholder="Returned yd" inputMode="decimal" value={loadInputs[l.id]?.returned ?? ''} onChange={(e) => setLoadInput(l.id, 'returned', e.target.value)} />
                          <input aria-label="Signature name" placeholder="Signature (typed name)" value={loadInputs[l.id]?.signature ?? ''} onChange={(e) => setLoadInput(l.id, 'signature', e.target.value)} />
                          <button type="button" className="cc-btn cc-btn--sm" onClick={() => updateLoad.mutate(l)}>Save ticket</button>
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {canWrite && !['complete', 'cancelled'].includes(o.status) ? (
                  <div className="cc-grid">
                    <input aria-label="New ticket number" placeholder="Ticket #" value={loadInputs[o.id]?.ticket ?? ''} onChange={(e) => setLoadInput(o.id, 'ticket', e.target.value)} />
                    <input aria-label="Yards loaded" placeholder="Yards loaded" inputMode="decimal" value={loadInputs[o.id]?.loaded ?? ''} onChange={(e) => setLoadInput(o.id, 'loaded', e.target.value)} />
                    <button type="button" className="cc-btn cc-btn--sm" onClick={() => addLoad.mutate(o)}>Add load ticket</button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
        {(board.data?.days ?? []).length === 0 ? <p>No orders in this range.</p> : null}
      </section>
    </div>
  );
}
