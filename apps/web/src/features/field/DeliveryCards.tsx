'use client';

// Deliveries on the phone: network orders this company supplies, with the next step as
// one big button (accept → start production → ship → deliver). Decisions go through
// the offline outbox. Buyer-side orders are shown read-only with their status so a
// crew can see what is coming.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { ErrorNotice } from '../../components/common';
import { errorHint } from '../../lib/api';
import { submitOrQueue } from '../../lib/offline/fieldWrites';
import { orgKey, useApi, useSession } from '../../lib/session';
import { FIELD_LABELS, prettyStatus, type UiLang } from '../builderOps/shared';

const OrderLine = z.object({
  description: z.string(),
  quantity: z.number(),
  unit: z.string().nullable().optional(),
});
const Order = z.object({
  id: z.string(),
  side: z.enum(['buyer', 'supplier']),
  partnerDisplayName: z.string(),
  reference: z.string(),
  status: z.string(),
  lines: z.array(OrderLine),
  requestedDeliveryOn: z.string().nullable(),
  deliveryAddress: z.string().nullable(),
});
const OrderList = z.object({ items: z.array(Order) });

const NEXT: Record<
  string,
  { decision: string; labelKey: 'accept' | 'decline' | 'startWork' | 'markShipped' | 'markDelivered' }[]
> = {
  sent: [
    { decision: 'accept', labelKey: 'accept' },
    { decision: 'decline', labelKey: 'decline' },
  ],
  accepted: [{ decision: 'start_production', labelKey: 'startWork' }],
  in_production: [{ decision: 'ship', labelKey: 'markShipped' }],
  shipped: [{ decision: 'deliver', labelKey: 'markDelivered' }],
};

export function DeliveryCards({ lang }: { lang: UiLang }) {
  const session = useSession();
  const { api } = useApi();
  const queryClient = useQueryClient();
  const L = FIELD_LABELS[lang];
  const scope = { userId: session.me.user.id, orgId: session.orgId };
  const canWrite = session.can('network_order:write');
  const [queuedNote, setQueuedNote] = useState('');

  const list = useQuery({
    queryKey: orgKey(session.orgId, 'field', 'deliveries'),
    queryFn: () => api.get('/v1/supplier-flow/orders', { schema: OrderList }),
  });

  const decide = useMutation({
    mutationFn: (input: { id: string; decision: string }) => {
      const path = `/v1/supplier-flow/orders/${input.id}/decide`;
      const body = { decision: input.decision };
      return submitOrQueue({
        scope,
        kind: 'network_order_decide',
        label: input.decision,
        method: 'POST',
        path,
        body,
        send: (idempotencyKey) => api.post(path, body, { idempotencyKey }),
      });
    },
    onSuccess: (r) => {
      setQueuedNote(r.queued ? L.queuedNote : '');
      void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'field') });
      void queryClient.invalidateQueries({ queryKey: orgKey(session.orgId, 'network-orders') });
    },
  });

  const active = (list.data?.items ?? []).filter((o) =>
    ['sent', 'accepted', 'in_production', 'shipped'].includes(o.status),
  );

  return (
    <section className="web-card" aria-label={L.deliveries}>
      <h2>{L.deliveries}</h2>
      {list.error ? <ErrorNotice error={list.error} /> : null}
      {active.length === 0 && !list.isLoading ? <p className="web-muted">{L.noDeliveries}</p> : null}
      <div style={{ display: 'grid', gap: 12 }}>
        {active.map((o) => (
          <article key={o.id} className="web-card" style={{ padding: 12 }}>
            <p style={{ margin: '0 0 4px' }}>
              <strong>{o.reference}</strong> — {o.partnerDisplayName}
            </p>
            <p className="web-muted" style={{ margin: '0 0 8px' }}>
              {prettyStatus(o.status)}
              {o.requestedDeliveryOn ? ` · ${o.requestedDeliveryOn}` : ''}
              {o.deliveryAddress ? ` · ${o.deliveryAddress}` : ''}
            </p>
            <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
              {o.lines.map((line, i) => (
                <li key={i}>
                  {line.quantity}
                  {line.unit ? ` ${line.unit}` : ''} — {line.description}
                </li>
              ))}
            </ul>
            {canWrite && o.side === 'supplier' ? (
              <div style={{ display: 'flex', gap: 8 }}>
                {(NEXT[o.status] ?? []).map((step) => (
                  <button
                    key={step.decision}
                    type="button"
                    className={step.decision === 'decline' ? 'cc-btn' : 'cc-btn cc-btn--primary'}
                    style={{ minHeight: 48, flex: 1 }}
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: o.id, decision: step.decision })}
                  >
                    {L[step.labelKey]}
                  </button>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
      {queuedNote ? (
        <p className="web-muted" role="status">
          {queuedNote}
        </p>
      ) : null}
      {decide.error ? (
        <p className="web-error" role="alert">
          {errorHint(decide.error)}
        </p>
      ) : null}
    </section>
  );
}
