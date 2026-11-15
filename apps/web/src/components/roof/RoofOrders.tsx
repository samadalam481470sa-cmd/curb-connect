'use client';

// Roof order list + order detail (RF-021, RF-022, RR-039, COS-201..COS-203, ADD-020, ADD-022):
// status from the server state machine, honest SLA (target, never guaranteed unless stated),
// immutable event log, imagery with per-use rights decisions, and the allowed manual transitions.
import type { RoofOrderDto } from '@fieldline/contracts';
import { Button, EmptyState, Skeleton, StatusPill } from '@fieldline/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { useApi } from '../../lib/session';
import { ButtonLink, ErrorNotice, PageHeader } from '../common';
import { ORDER_STATUS_LABEL } from './model';
import { roofEndpoints, type ImageryAssetDto } from './roofApi';
import styles from './roof.module.css';

export function RoofOrderList() {
  const { api } = useApi();
  const roof = roofEndpoints(api);
  const q = useQuery({ queryKey: ['roof', 'orders'], queryFn: () => roof.listOrders() });
  return (
    <>
      <PageHeader title="Roof Measurements" description="Order a roof measurement or trace one yourself, review it, and turn it into a quote." />
      <div className={styles.row}>
        <ButtonLink href="/roof/new">New roof order</ButtonLink>
      </div>
      {q.isPending && <Skeleton lines={4} />}
      {q.isError && <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && q.data.items.length === 0 && <EmptyState title="No roof orders yet" description="Start with an address to order a measurement." />}
      {q.data && q.data.items.length > 0 && (
        <table className={styles.table}>
          <caption className={styles.muted}>Roof orders</caption>
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Status</th>
              <th scope="col">Type</th>
              <th scope="col">Target</th>
            </tr>
          </thead>
          <tbody>
            {q.data.items.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link href={`/roof/orders/${o.id}`}>{o.number}</Link>
                </td>
                <td>
                  <StatusPill status={o.status} label={ORDER_STATUS_LABEL[o.status]} size="sm" />
                </td>
                <td>{o.mode === 'diy' ? 'DIY trace' : `Assisted (${o.deliverySpeed})`}</td>
                <td>{o.dueAt ? new Date(o.dueAt).toLocaleString() : 'No target'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

const MANUAL: Partial<Record<RoofOrderDto['status'], string>> = { cancelled: 'Cancel order', clarification_needed: 'Ask for clarification', measuring: 'Resume measuring' };

export function RoofOrderDetail({ orderId }: { orderId: string }) {
  const { api } = useApi();
  const roof = roofEndpoints(api);
  const qc = useQueryClient();
  const order = useQuery({ queryKey: ['roof', 'order', orderId], queryFn: () => roof.order(orderId) });
  const events = useQuery({ queryKey: ['roof', 'order', orderId, 'events'], queryFn: () => roof.orderEvents(orderId) });
  const [error, setError] = useState<unknown>(null);
  const [imagery, setImagery] = useState<{ items: ImageryAssetDto[]; unavailable: string[] } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['roof', 'order', orderId] });

  if (order.isPending) return <Skeleton lines={6} />;
  if (order.isError) return <ErrorNotice error={order.error} onRetry={() => void order.refetch()} />;
  const o = order.data;
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <>
      <PageHeader title={`Roof order ${o.number}`} description={o.mode === 'diy' ? 'DIY trace' : `Assisted measurement (${o.deliverySpeed})`} />
      <div className={styles.row}>
        <StatusPill status={o.status} label={ORDER_STATUS_LABEL[o.status]} />
        {o.reportId && <ButtonLink href={`/roof/reports/${o.reportId}/edit`}>Open workbench</ButtonLink>}
        {o.reportId && (
          <ButtonLink href={`/roof/reports/${o.reportId}`} variant="secondary">
            Report
          </ButtonLink>
        )}
      </div>
      {error !== null && <ErrorNotice error={error} />}
      <section className={styles.panel} aria-labelledby="sla-h">
        <h2 id="sla-h">Delivery</h2>
        {o.sla ? (
          <dl className={styles.kv}>
            <dt>Class</dt>
            <dd>{o.sla.slaClass.replace(/_/g, ' ')}</dd>
            <dt>Target</dt>
            <dd>
              {o.sla.targetBusinessHours === null ? 'None' : `${o.sla.targetBusinessHours} business hours`} {o.sla.guaranteed ? '(guaranteed)' : '(target, not guaranteed)'}
            </dd>
            <dt>Due</dt>
            <dd>{o.sla.dueAt ? `${new Date(o.sla.dueAt).toLocaleString()} (${o.sla.timeZone})` : 'No due time'}</dd>
            <dt>Pauses</dt>
            <dd>{o.sla.pausesOn.length ? o.sla.pausesOn.join(', ') : 'None'}</dd>
            <dt>Disclosure</dt>
            <dd>{o.sla.disclosure}</dd>
          </dl>
        ) : (
          <p className={styles.muted}>No delivery target recorded yet.</p>
        )}
        {o.failureReason && <p className={styles.issue}>Failure: {o.failureReason}</p>}
      </section>

      {(o.status === 'imagery_pending' || o.status === 'measuring' || o.status === 'ordered') && (
        <section className={styles.panel} aria-labelledby="img-h">
          <h2 id="img-h">Imagery</h2>
          <p className={styles.muted}>Each use (view, measure, cache, embed in PDF, redistribute) is decided from the license. Map imagery that is view-only can never be measured from.</p>
          <Button variant="secondary" onClick={() => void run(async () => setImagery(await roof.searchImagery(o.propertyId)))}>
            Find imagery
          </Button>
          {imagery && <ImageryChoices items={imagery.items} unavailable={imagery.unavailable} current={o.imageryAssetId} onAttach={(id) => void run(() => roof.attachImagery(o.id, id, o.revision))} />}
        </section>
      )}

      {o.nextStates.some((s) => MANUAL[s]) && (
        <div className={styles.row}>
          {o.nextStates
            .filter((s) => MANUAL[s])
            .map((s) => (
              <Button key={s} variant={s === 'cancelled' ? 'danger' : 'secondary'} onClick={() => void run(() => roof.transition(o.id, s, o.revision, MANUAL[s]))}>
                {MANUAL[s]}
              </Button>
            ))}
        </div>
      )}

      <section aria-labelledby="ev-h">
        <h2 id="ev-h">History</h2>
        {events.data && (
          <ol>
            {events.data.items.map((e) => (
              <li key={e.id}>
                {new Date(e.occurredAt).toLocaleString()}: {e.fromStatus ? `${ORDER_STATUS_LABEL[e.fromStatus]} → ` : ''}
                {ORDER_STATUS_LABEL[e.toStatus]}
                {e.reason ? ` (${e.reason})` : ''}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

export function ImageryChoices({ items, unavailable, current, onAttach }: { items: ImageryAssetDto[]; unavailable: string[]; current: string | null; onAttach: (id: string) => void }) {
  return (
    <div className={styles.stack}>
      {unavailable.length > 0 && <p className={styles.muted}>Not available: {unavailable.join(', ')}</p>}
      {items.length === 0 && <p>No imagery found for this property.</p>}
      {items.map((a) => {
        const analyze = a.decisions.find((d) => d.use === 'analyze');
        return (
          <div key={a.id} className={styles.panel}>
            <strong>
              {a.provider} {a.kind.replace(/_/g, ' ')}
            </strong>
            {a.isSynthetic && <span> (synthetic test imagery, not a real capture)</span>}
            <p className={styles.muted}>{a.attribution}</p>
            <ul aria-label="Rights decisions">
              {a.decisions.map((d) => (
                <li key={d.use}>
                  {d.use.replace(/_/g, ' ')}: {d.allowed ? 'allowed' : `not allowed (${d.reason.replace(/_/g, ' ')})`}
                </li>
              ))}
            </ul>
            {!a.calibrated && <p>No georeference: cannot back measurements.</p>}
            <Button size="sm" disabled={!analyze?.allowed || !a.calibrated || a.id === current} onClick={() => onAttach(a.id)}>
              {a.id === current ? 'Attached' : 'Use for measurement'}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
