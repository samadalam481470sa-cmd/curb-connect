'use client';

// Portal Capture (Renditions-style external-order gathering): builder-portal
// connections with write-only encrypted secrets, capture runs, and captured
// external orders normalized through SKU mappings. No live portal adapter
// ships yet — the empty states say so plainly. Adapters are added per
// builder portal and use plain authorized login only (no anti-bot evasion).
// Captured orders never auto-commit money: conversion to a draft PO is a
// human-confirmed, idempotent action.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { money, prettyStatus } from '../builderOps/shared';

const Status = z.object({
  vaultConfigured: z.boolean(),
  adapters: z.array(z.object({ portalKey: z.string(), portalName: z.string() })),
  note: z.string(),
});
const Connection = z.object({
  id: z.string(),
  portalKey: z.string(),
  portalName: z.string(),
  loginIdentifier: z.string(),
  hasSecret: z.boolean(),
  status: z.string(),
  lastCheckedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  revision: z.number(),
  createdAt: z.string(),
});
type ConnectionT = z.infer<typeof Connection>;
const Run = z.object({
  id: z.string(),
  connectionId: z.string(),
  portalKey: z.string(),
  portalName: z.string(),
  trigger: z.string(),
  status: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  ordersFound: z.number(),
  ordersNew: z.number(),
  ordersRevised: z.number(),
  errors: z.array(z.object({ orderRef: z.string().nullable().optional(), message: z.string() })),
  note: z.string().nullable(),
  createdAt: z.string(),
});
const Line = z.object({
  label: z.string(),
  quantity: z.number(),
  unit: z.string(),
  unitPriceMinor: z.number().nullable(),
  supplierSku: z.string().nullable(),
  mappingStatus: z.string(),
});
const ExternalOrder = z.object({
  id: z.string(),
  connectionId: z.string(),
  portalKey: z.string(),
  builderName: z.string(),
  builderPoNumber: z.string(),
  orderedOn: z.string().nullable(),
  lines: z.array(Line),
  totalMinor: z.number().nullable(),
  mappedLineCount: z.number(),
  unmappedLineCount: z.number(),
  revisionCount: z.number(),
  lastCapturedAt: z.string(),
  status: z.string(),
  convertedOrderId: z.string().nullable(),
  note: z.string().nullable(),
  revision: z.number(),
  createdAt: z.string(),
});
type ExternalOrderT = z.infer<typeof ExternalOrder>;
const Job = z.object({ id: z.string(), number: z.string(), title: z.string() });

export function PortalCaptureView() {
  return (
    <RouteGate routeId="portalCapture">
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
  const canWrite = session.check('portal_capture:write').allowed;
  const canManage = session.check('portal_capture:manage').allowed;

  const status = useQuery({
    queryKey: orgKey(session.orgId, 'portalCapture', 'status'),
    queryFn: () => api.get('/v1/portal-capture/status', { schema: Status }),
  });
  const connections = useQuery({
    queryKey: orgKey(session.orgId, 'portalCapture', 'connections'),
    queryFn: () => api.get('/v1/portal-capture/connections', { schema: z.object({ items: z.array(Connection) }) }),
  });
  const runs = useQuery({
    queryKey: orgKey(session.orgId, 'portalCapture', 'runs'),
    queryFn: () => api.get('/v1/portal-capture/runs', { schema: z.object({ items: z.array(Run) }) }),
  });
  const orders = useQuery({
    queryKey: orgKey(session.orgId, 'portalCapture', 'orders'),
    queryFn: () => api.get('/v1/portal-capture/external-orders', { schema: z.object({ items: z.array(ExternalOrder) }) }),
  });
  const jobs = useQuery({
    queryKey: orgKey(session.orgId, 'portalCapture', 'jobs'),
    queryFn: () => api.get('/v1/jobs', { schema: z.object({ items: z.array(Job) }) }),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'portalCapture') });
  const onError = (cause: unknown) => setError(errorHint(cause));

  const [portalKey, setPortalKey] = useState('');
  const [portalName, setPortalName] = useState('');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [secret, setSecret] = useState('');
  const create = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/portal-capture/connections',
        { portalKey: portalKey.trim(), portalName: portalName.trim(), loginIdentifier: loginIdentifier.trim(), secret },
        { schema: Connection },
      ),
    onSuccess: () => {
      setPortalKey('');
      setPortalName('');
      setLoginIdentifier('');
      setSecret('');
      setError('');
      setNote('Connection saved. The secret is stored encrypted and is never shown again.');
      refresh();
    },
    onError,
  });

  const remove = useMutation({
    mutationFn: (c: ConnectionT) => api.delete(`/v1/portal-capture/connections/${c.id}`, { schema: z.object({ ok: z.boolean() }) }),
    onSuccess: () => { setError(''); refresh(); },
    onError,
  });

  const runNow = useMutation({
    mutationFn: (c: ConnectionT) => api.post(`/v1/portal-capture/connections/${c.id}/run`, {}, { schema: Run }),
    onSuccess: (run) => {
      setError('');
      setNote(
        run.status === 'no_adapters'
          ? `Run recorded: ${run.note ?? 'No portal adapter is registered for this portal yet.'}`
          : `Capture ${prettyStatus(run.status)}: found ${run.ordersFound}, new ${run.ordersNew}, revised ${run.ordersRevised}.`,
      );
      refresh();
    },
    onError,
  });

  const [convertJobIds, setConvertJobIds] = useState<Record<string, string>>({});
  const convert = useMutation({
    mutationFn: (v: { order: ExternalOrderT; jobId: string }) =>
      api.post(`/v1/portal-capture/external-orders/${v.order.id}/convert`, { jobId: v.jobId }, { schema: ExternalOrder }),
    onSuccess: (order) => {
      setError('');
      setNote(`Converted to draft purchase order ${order.convertedOrderId ?? ''}. Converting again returns the same draft — no duplicates.`);
      refresh();
    },
    onError,
  });

  const vaultConfigured = status.data?.vaultConfigured ?? true;

  return (
    <div>
      <PageHeader
        title="Portal Capture"
        description="Orders from builders who are not on Field Pro, gathered from their portals into one format."
      />
      {error ? <ErrorNotice error={error} /> : null}
      {note ? <p role="status">{note}</p> : null}

      <section className="cc-panel">
        <h3>Capture status</h3>
        {status.data ? (
          <>
            <p>{status.data.note}</p>
            {!status.data.vaultConfigured ? (
              <p className="web-small">
                The credential vault is not configured on the server (STORAGE_ENCRYPTION_KEY), so portal
                secrets cannot be stored yet.
              </p>
            ) : null}
            <p className="web-small">
              Capture uses your own portal login, provided by you and stored encrypted. If a portal
              blocks automated login, the connection is marked blocked — Field Pro never tries to evade
              portal protections.
            </p>
          </>
        ) : <p>Loading…</p>}
      </section>

      <section className="cc-panel">
        <h3>Portal connections</h3>
        <ul>
          {(connections.data?.items ?? []).map((c) => (
            <li key={c.id}>
              <strong>{c.portalName}</strong> ({c.portalKey}) · login {c.loginIdentifier} ·{' '}
              {prettyStatus(c.status)}
              {c.hasSecret ? ' · secret stored (encrypted)' : ' · no secret stored'}
              {c.lastCheckedAt ? ` · last checked ${new Date(c.lastCheckedAt).toLocaleString()}` : ' · never checked'}
              {c.lastError ? <div className="web-small">Last error: {c.lastError}</div> : null}
              {canWrite ? (
                <button type="button" className="cc-btn cc-btn--sm" onClick={() => runNow.mutate(c)}>
                  Run capture now
                </button>
              ) : null}
              {canManage ? (
                <button type="button" className="cc-btn cc-btn--sm" onClick={() => remove.mutate(c)}>
                  Delete
                </button>
              ) : null}
            </li>
          ))}
          {(connections.data?.items ?? []).length === 0 ? (
            <li>No portal connections yet. Add one below with your own builder-portal login.</li>
          ) : null}
        </ul>
        {canManage ? (
          <div>
            <h4>Add a portal connection</h4>
            <div className="cc-grid">
              <input
                aria-label="Portal key"
                placeholder="Portal key (e.g. acme-builder-portal)"
                value={portalKey}
                onChange={(e) => setPortalKey(e.target.value)}
              />
              <input
                aria-label="Portal name"
                placeholder="Portal name (e.g. Acme Builder Portal)"
                value={portalName}
                onChange={(e) => setPortalName(e.target.value)}
              />
              <input
                aria-label="Login identifier"
                placeholder="Your login on that portal (username or email)"
                value={loginIdentifier}
                onChange={(e) => setLoginIdentifier(e.target.value)}
                autoComplete="off"
              />
              <input
                type="password"
                aria-label="Portal secret"
                placeholder="Your portal password (stored encrypted, never shown again)"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <button
              type="button"
              className="cc-btn"
              disabled={!vaultConfigured || !portalKey.trim() || !portalName.trim() || !loginIdentifier.trim() || !secret}
              onClick={() => create.mutate()}
            >
              Save connection
            </button>
          </div>
        ) : null}
      </section>

      <section className="cc-panel">
        <h3>Capture runs</h3>
        <ul>
          {(runs.data?.items ?? []).map((r) => (
            <li key={r.id}>
              <strong>{r.portalName || r.portalKey}</strong> · {prettyStatus(r.trigger)} ·{' '}
              {prettyStatus(r.status)} · {new Date(r.startedAt).toLocaleString()} · found {r.ordersFound} ·
              new {r.ordersNew} · revised {r.ordersRevised}
              {r.note ? <div className="web-small">{r.note}</div> : null}
              {r.errors.map((e, idx) => (
                <div key={idx} className="web-small">
                  {e.orderRef ? `${e.orderRef}: ` : ''}{e.message}
                </div>
              ))}
            </li>
          ))}
          {(runs.data?.items ?? []).length === 0 ? <li>No capture runs yet.</li> : null}
        </ul>
      </section>

      <section className="cc-panel">
        <h3>External orders</h3>
        <ul>
          {(orders.data?.items ?? []).map((o) => (
            <li key={o.id}>
              <strong>{o.builderName} — {o.builderPoNumber}</strong>
              {o.orderedOn ? ` · ordered ${o.orderedOn}` : ''}
              {o.totalMinor !== null ? ` · ${money(o.totalMinor)}` : ' · unpriced'}
              {` · ${o.mappedLineCount} mapped / ${o.unmappedLineCount} unmapped`}
              {o.revisionCount > 0 ? ` · revised ×${o.revisionCount}` : ''}
              {' · '}{prettyStatus(o.status)}
              <div className="web-small">
                {o.lines.map((l, idx) => (
                  <span key={idx}>
                    {l.label} ×{l.quantity} {l.unit}
                    {l.mappingStatus === 'mapped' ? ` → ${l.supplierSku}` : ' → unmapped'}
                    {idx < o.lines.length - 1 ? '; ' : ''}
                  </span>
                ))}
              </div>
              {canWrite && o.status === 'captured' ? (
                <span>
                  <select
                    aria-label={`Job for ${o.builderPoNumber}`}
                    value={convertJobIds[o.id] ?? ''}
                    onChange={(e) => setConvertJobIds((p) => ({ ...p, [o.id]: e.target.value }))}
                  >
                    <option value="">Select a job…</option>
                    {(jobs.data?.items ?? []).map((j) => (
                      <option key={j.id} value={j.id}>{j.number} — {j.title}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="cc-btn cc-btn--sm"
                    disabled={!convertJobIds[o.id]}
                    onClick={() => convert.mutate({ order: o, jobId: convertJobIds[o.id]! })}
                  >
                    Convert to draft PO
                  </button>
                </span>
              ) : null}
              {o.status === 'converted' ? <span className="web-small"> Draft PO: {o.convertedOrderId}</span> : null}
            </li>
          ))}
          {(orders.data?.items ?? []).length === 0 ? (
            <li>
              No external orders captured yet. Orders appear here once a portal adapter is connected and a
              capture run finds them.
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
