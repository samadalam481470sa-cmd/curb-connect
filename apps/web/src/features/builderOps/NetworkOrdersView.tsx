'use client';

// Network orders (builder operations): send purchase orders to other Field Pro companies,
// receive theirs, accept or decline, track status history, map your package items to their
// SKUs, plan dispatch routes, and read supplier field reports. Orders only move between
// companies connected in the Network — the other side must also be on Field Pro. Email
// notices go out when email is connected; until then the screen says so and the in-app
// notification is what the other company sees.
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { dateOnly, emailStateLabel, money, parseDollarsToMinor, prettyStatus } from './shared';

const OrderLine = z.object({
  description: z.string(),
  quantity: z.number(),
  unit: z.string().nullable().optional(),
  unitPriceMinor: z.number().nullable().optional(),
  packageName: z.string().nullable().optional(),
});
const HistoryEvent = z.object({
  status: z.string(),
  at: z.string(),
  bySide: z.string(),
  note: z.string().nullable(),
});
const Order = z.object({
  id: z.string(),
  orderKey: z.string(),
  side: z.enum(['buyer', 'supplier']),
  partnerOrgId: z.string(),
  partnerDisplayName: z.string(),
  reference: z.string(),
  status: z.string(),
  lines: z.array(OrderLine),
  totalMinor: z.number().nullable(),
  currency: z.string(),
  requestedDeliveryOn: z.string().nullable(),
  deliveryAddress: z.string().nullable(),
  note: z.string().nullable(),
  history: z.array(HistoryEvent),
  sentAt: z.string(),
  respondedAt: z.string().nullable(),
  emailState: z.string(),
  emailSentAt: z.string().nullable(),
  emailNote: z.string().nullable(),
  revision: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const OrderList = z.object({ items: z.array(Order) });
const EmailStatus = z.object({ emailConnected: z.boolean(), message: z.string() });
const Connection = z.object({
  partnerOrgId: z.string(),
  partnerDisplayName: z.string(),
  status: z.string(),
});
const ConnectionList = z.object({ items: z.array(Connection) }).passthrough();
const SkuMapping = z.object({
  id: z.string(),
  partnerOrgId: z.string().nullable(),
  packageName: z.string(),
  supplierSku: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const SkuList = z.object({ items: z.array(SkuMapping) });
const DispatchRoute = z.object({
  id: z.string(),
  routeDate: z.string(),
  driverName: z.string().nullable(),
  status: z.string(),
  stops: z.array(
    z.object({
      orderId: z.string().nullable().optional(),
      address: z.string(),
      note: z.string().nullable().optional(),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});
const RouteList = z.object({ items: z.array(DispatchRoute) });
const FieldReport = z.object({
  id: z.string(),
  orderId: z.string().nullable(),
  reportKind: z.string(),
  note: z.string(),
  photoMediaIds: z.array(z.string()),
  createdByUserId: z.string().nullable(),
  createdAt: z.string(),
});
const FieldReportList = z.object({ items: z.array(FieldReport) });

export function NetworkOrdersView() {
  return (
    <RouteGate routeId="networkOrders">
      <NetworkOrdersContent />
    </RouteGate>
  );
}

function NetworkOrdersContent() {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const canWrite = session.check('network_order:write');
  const [side, setSide] = useState<'all' | 'buyer' | 'supplier'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const emailStatus = useQuery({
    queryKey: orgKey(session.orgId, 'network-orders', 'email-status'),
    queryFn: () => api.get('/v1/assignments/email-status', { schema: EmailStatus }),
  });
  const orders = useQuery({
    queryKey: orgKey(session.orgId, 'network-orders', 'list', side),
    queryFn: () =>
      api.get(`/v1/supplier-flow/orders${side === 'all' ? '' : `?side=${side}`}`, { schema: OrderList }),
  });
  const connections = useQuery({
    queryKey: orgKey(session.orgId, 'network-orders', 'connections'),
    queryFn: () => api.get('/v1/network/connections', { schema: ConnectionList }),
  });
  const skus = useQuery({
    queryKey: orgKey(session.orgId, 'network-orders', 'skus'),
    queryFn: () => api.get('/v1/supplier-flow/sku-mappings', { schema: SkuList }),
  });
  const routes = useQuery({
    queryKey: orgKey(session.orgId, 'network-orders', 'routes'),
    queryFn: () => api.get('/v1/supplier-flow/dispatch-routes', { schema: RouteList }),
  });
  const reports = useQuery({
    queryKey: orgKey(session.orgId, 'network-orders', 'reports'),
    queryFn: () => api.get('/v1/supplier-flow/field-reports', { schema: FieldReportList }),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'network-orders') });

  const [partnerOrgId, setPartnerOrgId] = useState('');
  const [reference, setReference] = useState('');
  const [deliveryOn, setDeliveryOn] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([{ description: '', quantity: '1', unit: '', price: '', packageName: '' }]);
  const createOrder = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/supplier-flow/orders',
        {
          partnerOrgId,
          reference: reference.trim(),
          requestedDeliveryOn: deliveryOn || null,
          deliveryAddress: deliveryAddress.trim() || null,
          note: note.trim() || null,
          lines: lines
            .filter((l) => l.description.trim())
            .map((l) => ({
              description: l.description.trim(),
              quantity: Number(l.quantity) || 0,
              unit: l.unit.trim() || null,
              unitPriceMinor: parseDollarsToMinor(l.price),
              packageName: l.packageName.trim() || null,
            })),
        },
        { schema: Order },
      ),
    onSuccess: () => {
      setReference('');
      setDeliveryAddress('');
      setNote('');
      setLines([{ description: '', quantity: '1', unit: '', price: '', packageName: '' }]);
      setError('');
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const decideOrder = useMutation({
    mutationFn: (input: { id: string; decision: string }) =>
      api.post(`/v1/supplier-flow/orders/${input.id}/decide`, { decision: input.decision }, { schema: Order }),
    onSuccess: invalidate,
    onError: (cause) => setError(errorHint(cause)),
  });

  const resendEmail = useMutation({
    mutationFn: (id: string) => api.post(`/v1/supplier-flow/orders/${id}/resend-email`, {}, { schema: Order }),
    onSuccess: invalidate,
    onError: (cause) => setError(errorHint(cause)),
  });

  const [skuPartner, setSkuPartner] = useState('');
  const [skuPackage, setSkuPackage] = useState('');
  const [skuValue, setSkuValue] = useState('');
  const createSku = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/supplier-flow/sku-mappings',
        { packageName: skuPackage.trim(), supplierSku: skuValue.trim(), partnerOrgId: skuPartner || null },
        { schema: SkuMapping },
      ),
    onSuccess: () => {
      setSkuPackage('');
      setSkuValue('');
      setError('');
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const [routeDriver, setRouteDriver] = useState('');
  const [routeDate, setRouteDate] = useState('');
  const [routeStops, setRouteStops] = useState('');
  const createRoute = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/supplier-flow/dispatch-routes',
        {
          routeDate,
          driverName: routeDriver.trim() || null,
          stops: routeStops
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((address) => ({ address })),
        },
        { schema: DispatchRoute },
      ),
    onSuccess: () => {
      setRouteDriver('');
      setRouteStops('');
      setError('');
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const [reportKind, setReportKind] = useState('delivery');
  const [reportNote, setReportNote] = useState('');
  const createReport = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/supplier-flow/field-reports',
        { reportKind, note: reportNote.trim() },
        { schema: FieldReport },
      ),
    onSuccess: () => {
      setReportNote('');
      setError('');
      invalidate();
    },
    onError: (cause) => setError(errorHint(cause)),
  });

  const submitOrder = (event: FormEvent) => {
    event.preventDefault();
    if (!partnerOrgId || !reference.trim() || lines.every((l) => !l.description.trim())) {
      setError('Pick a connected company, add a reference, and add at least one order line.');
      return;
    }
    setError('');
    createOrder.mutate();
  };

  const activeConnections = (connections.data?.items ?? []).filter((c) => c.status === 'active');
  const decisionsFor = (o: z.infer<typeof Order>): { value: string; label: string }[] => {
    if (o.side === 'supplier' && o.status === 'sent') {
      return [
        { value: 'accept', label: 'Accept' },
        { value: 'decline', label: 'Decline' },
      ];
    }
    if (o.side === 'supplier' && o.status === 'accepted') {
      return [
        { value: 'start_production', label: 'Start production' },
        { value: 'ship', label: 'Ship' },
        { value: 'deliver', label: 'Mark delivered' },
      ];
    }
    if (o.side === 'supplier' && o.status === 'in_production') {
      return [
        { value: 'ship', label: 'Ship' },
        { value: 'deliver', label: 'Mark delivered' },
      ];
    }
    if (o.side === 'supplier' && o.status === 'shipped') {
      return [{ value: 'deliver', label: 'Mark delivered' }];
    }
    if (o.side === 'buyer' && (o.status === 'sent' || o.status === 'accepted')) {
      return [{ value: 'cancel', label: 'Cancel' }];
    }
    return [];
  };

  const openOrder = orders.data?.items.find((o) => o.id === openId);

  return (
    <main className="cc-work-board">
      <PageHeader
        title="Network Orders"
        description="Send purchase orders to other Field Pro companies and receive theirs. Orders only move between companies connected in the Network — the other side must also be on Field Pro."
      />
      {emailStatus.data && !emailStatus.data.emailConnected && (
        <p className="web-card" role="status">
          Email is not connected yet, so order emails can't go out. The other company still sees
          the order in Field Pro (in-app notification). {emailStatus.data.message}
        </p>
      )}
      {error && <p className="web-error" role="alert">{error}</p>}

      {canWrite && (
        <section className="web-card" aria-labelledby="order-create-title">
          <h2 id="order-create-title">Send an order</h2>
          <form className="cc-work-board__form" onSubmit={submitOrder}>
            <label>
              Company
              <select value={partnerOrgId} onChange={(e) => setPartnerOrgId(e.target.value)}>
                <option value="">Choose a connected company…</option>
                {activeConnections.map((c) => (
                  <option key={c.partnerOrgId} value={c.partnerOrgId}>{c.partnerDisplayName}</option>
                ))}
              </select>
            </label>
            {activeConnections.length === 0 && (
              <p className="web-muted">No connected companies yet — connect in the Network first.</p>
            )}
            <label>Reference<input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. PO-1042" /></label>
            <label>Requested delivery<input type="date" value={deliveryOn} onChange={(e) => setDeliveryOn(e.target.value)} /></label>
            <label>Delivery address<input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} /></label>
            <label>Note<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
            {lines.map((line, i) => (
              <fieldset key={i} className="cc-order-line">
                <legend>Line {i + 1}</legend>
                <label>Item<input value={line.description} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, description: e.target.value } : l)))} /></label>
                <label>Qty<input inputMode="decimal" value={line.quantity} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)))} /></label>
                <label>Unit<input value={line.unit} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, unit: e.target.value } : l)))} /></label>
                <label>Unit price ($, optional)<input inputMode="decimal" value={line.price} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, price: e.target.value } : l)))} /></label>
                <label>Your package name<input value={line.packageName} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, packageName: e.target.value } : l)))} /></label>
              </fieldset>
            ))}
            <button
              type="button"
              className="cc-btn"
              onClick={() => setLines([...lines, { description: '', quantity: '1', unit: '', price: '', packageName: '' }])}
            >
              Add a line
            </button>
            <button type="submit" className="cc-btn cc-btn--primary" disabled={createOrder.isPending}>Send order</button>
          </form>
        </section>
      )}

      <section className="web-card" aria-labelledby="order-list-title">
        <h2 id="order-list-title">Orders</h2>
        <div role="group" aria-label="Direction">
          <button type="button" className="cc-btn" aria-pressed={side === 'all'} onClick={() => setSide('all')}>All</button>
          <button type="button" className="cc-btn" aria-pressed={side === 'buyer'} onClick={() => setSide('buyer')}>Sent by us</button>
          <button type="button" className="cc-btn" aria-pressed={side === 'supplier'} onClick={() => setSide('supplier')}>Received</button>
        </div>
        {orders.isError && <ErrorNotice error={orders.error} title="Could not load orders" />}
        {orders.data && orders.data.items.length === 0 && <p className="web-muted">No orders yet.</p>}
        {orders.data && orders.data.items.length > 0 && (
          <div className="cc-table-wrap">
            <table>
              <thead><tr><th>Company</th><th>Direction</th><th>Reference</th><th>Status</th><th>Total</th><th>Email</th><th></th></tr></thead>
              <tbody>
                {orders.data.items.map((o) => (
                  <tr key={o.id}>
                    <td>{o.partnerDisplayName}</td>
                    <td>{o.side === 'buyer' ? 'Sent' : 'Received'}</td>
                    <td>{o.reference}</td>
                    <td>{prettyStatus(o.status)}</td>
                    <td>{money(o.totalMinor, o.currency)}</td>
                    <td>{emailStateLabel(o.emailState)}</td>
                    <td>
                      <button type="button" className="cc-btn" onClick={() => setOpenId(openId === o.id ? null : o.id)}>
                        {openId === o.id ? 'Close' : 'Open'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {openOrder && (
        <section className="web-card" aria-labelledby="order-detail-title">
          <h2 id="order-detail-title">
            Order {openOrder.reference} — {openOrder.partnerDisplayName}
          </h2>
          <p className="web-muted">
            {openOrder.side === 'buyer' ? 'Sent by us' : 'Received'} · {prettyStatus(openOrder.status)} · Total{' '}
            {money(openOrder.totalMinor, openOrder.currency)}
            {openOrder.requestedDeliveryOn ? ` · Delivery requested ${openOrder.requestedDeliveryOn}` : ''}
            {openOrder.deliveryAddress ? ` · Deliver to: ${openOrder.deliveryAddress}` : ''}
          </p>
          {openOrder.note && <p>{openOrder.note}</p>}
          <div className="cc-table-wrap">
            <table>
              <thead><tr><th>Item</th><th>Qty</th><th>Unit</th><th>Unit price</th><th>Package</th></tr></thead>
              <tbody>
                {openOrder.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.description}</td>
                    <td>{l.quantity}</td>
                    <td>{l.unit ?? '—'}</td>
                    <td>{l.unitPriceMinor === null || l.unitPriceMinor === undefined ? 'To be quoted' : money(l.unitPriceMinor, openOrder.currency)}</td>
                    <td>{l.packageName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Status history</h3>
          {openOrder.history.map((h, i) => (
            <p key={i}>
              {prettyStatus(h.status)} — {dateOnly(h.at)} ({h.bySide}){h.note ? `: ${h.note}` : ''}
            </p>
          ))}
          <p className="web-muted">
            {emailStateLabel(openOrder.emailState)}{openOrder.emailNote ? ` — ${openOrder.emailNote}` : ''}
          </p>
          {canWrite && (
            <div>
              {decisionsFor(openOrder).map((d) => (
                <button key={d.value} type="button" className="cc-btn cc-btn--primary" onClick={() => decideOrder.mutate({ id: openOrder.id, decision: d.value })}>
                  {d.label}
                </button>
              ))}
              {openOrder.side === 'buyer' && (
                <button type="button" className="cc-btn" onClick={() => resendEmail.mutate(openOrder.id)}>
                  Resend email
                </button>
              )}
            </div>
          )}
        </section>
      )}

      <section className="web-card" aria-labelledby="sku-title">
        <h2 id="sku-title">SKU mappings</h2>
        <p className="web-muted">Map your package items to each supplier's SKUs so orders arrive in their language.</p>
        {canWrite && (
          <form
            className="cc-work-board__form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!skuPackage.trim() || !skuValue.trim()) {
                setError('Enter your package name and their SKU.');
                return;
              }
              setError('');
              createSku.mutate();
            }}
          >
            <label>
              Company (optional)
              <select value={skuPartner} onChange={(e) => setSkuPartner(e.target.value)}>
                <option value="">Any supplier</option>
                {activeConnections.map((c) => (
                  <option key={c.partnerOrgId} value={c.partnerOrgId}>{c.partnerDisplayName}</option>
                ))}
              </select>
            </label>
            <label>Your package name<input value={skuPackage} onChange={(e) => setSkuPackage(e.target.value)} /></label>
            <label>Their SKU<input value={skuValue} onChange={(e) => setSkuValue(e.target.value)} /></label>
            <button type="submit" className="cc-btn cc-btn--primary" disabled={createSku.isPending}>Save mapping</button>
          </form>
        )}
        {skus.data && skus.data.items.length === 0 && <p className="web-muted">No SKU mappings yet.</p>}
        {skus.data && skus.data.items.length > 0 && (
          <div className="cc-table-wrap">
            <table>
              <thead><tr><th>Your package</th><th>Supplier SKU</th></tr></thead>
              <tbody>
                {skus.data.items.map((s) => (
                  <tr key={s.id}>
                    <td>{s.packageName}</td>
                    <td>{s.supplierSku}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="web-card" aria-labelledby="routes-title">
        <h2 id="routes-title">Dispatch routes</h2>
        {canWrite && (
          <form
            className="cc-work-board__form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!routeDate || !routeStops.trim()) {
                setError('Pick a date and add at least one stop address.');
                return;
              }
              setError('');
              createRoute.mutate();
            }}
          >
            <label>Date<input type="date" value={routeDate} onChange={(e) => setRouteDate(e.target.value)} /></label>
            <label>Driver<input value={routeDriver} onChange={(e) => setRouteDriver(e.target.value)} /></label>
            <label>Stop addresses (one per line)<textarea value={routeStops} onChange={(e) => setRouteStops(e.target.value)} rows={3} /></label>
            <button type="submit" className="cc-btn cc-btn--primary" disabled={createRoute.isPending}>Create route</button>
          </form>
        )}
        {routes.data && routes.data.items.length === 0 && <p className="web-muted">No routes yet.</p>}
        {routes.data?.items.map((r) => (
          <div key={r.id} className="cc-detail-row">
            <div>
              <strong>{r.routeDate}</strong>
              {r.driverName ? ` · Driver: ${r.driverName}` : ''} · {prettyStatus(r.status)}
              <p className="web-muted">{r.stops.map((s) => s.address).join(' → ') || 'No stops'}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="web-card" aria-labelledby="field-reports-title">
        <h2 id="field-reports-title">Field reports</h2>
        {canWrite && (
          <form
            className="cc-work-board__form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!reportNote.trim()) {
                setError('Write the report note.');
                return;
              }
              setError('');
              createReport.mutate();
            }}
          >
            <label>
              Kind
              <select value={reportKind} onChange={(e) => setReportKind(e.target.value)}>
                <option value="delivery">Delivery</option>
                <option value="site_condition">Site condition</option>
                <option value="damage">Damage</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>Note<textarea value={reportNote} onChange={(e) => setReportNote(e.target.value)} rows={2} /></label>
            <button type="submit" className="cc-btn cc-btn--primary" disabled={createReport.isPending}>File report</button>
          </form>
        )}
        {reports.data && reports.data.items.length === 0 && <p className="web-muted">No field reports yet.</p>}
        {reports.data?.items.map((r) => (
          <p key={r.id}>
            <strong>{prettyStatus(r.reportKind)}</strong> <span className="web-muted">{dateOnly(r.createdAt)}</span>
            <br />
            {r.note}
            {r.photoMediaIds.length > 0 ? ` (${r.photoMediaIds.length} photos attached)` : ''}
          </p>
        ))}
      </section>
    </main>
  );
}
