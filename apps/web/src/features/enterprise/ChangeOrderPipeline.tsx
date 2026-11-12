'use client';

import { useState } from 'react';
import type { COStatus, ChangeOrder } from './types';
import { CO_TRANSITIONS } from './types';

interface Props {
  changeOrders: readonly ChangeOrder[];
  busy: boolean;
  canEdit: boolean;
  canApprove: boolean;
  onUpdateStatus: (changeOrder: ChangeOrder, status: COStatus) => Promise<void>;
}

const labels: Record<COStatus, string> = {
  pco_draft: 'PCO draft',
  pricing_requested: 'Pricing requested',
  priced: 'Priced',
  submitted_to_owner: 'Owner review',
  approved: 'Approved',
  rejected: 'Rejected',
};
const steps: COStatus[] = ['pco_draft','pricing_requested','priced','submitted_to_owner','approved'];
const money = (minor: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD',
}).format(minor / 100);

export function ChangeOrderPipeline({ changeOrders, busy, canEdit, canApprove, onUpdateStatus }: Props) {
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function update(order: ChangeOrder, status: COStatus) {
    if (busy || workingId) return;
    setWorkingId(order.id); setError('');
    try {
      await onUpdateStatus(order, status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Change order update failed.');
    } finally {
      setWorkingId(null);
    }
  }
  const approvedMinor = changeOrders.filter((c) => c.status === 'approved')
    .reduce((total, c) => total + c.amountDeltaMinor, 0);
  const proposedMinor = changeOrders.filter((c) => c.status !== 'approved' && c.status !== 'rejected')
    .reduce((total, c) => total + c.amountDeltaMinor, 0);

  return (
    <section className="enterprise-panel enterprise-control-card">
      <header className="enterprise-control-head">
        <div><h2>Change order &amp; PCO pipeline</h2><p>Track pricing and owner approvals by stage.</p></div>
        <div className="enterprise-control-totals">
          <span>Approved changes: <strong>{money(approvedMinor)}</strong></span>
          <span>Proposed changes: <strong>{money(proposedMinor)}</strong></span>
        </div>
      </header>
      <div className="enterprise-pipeline-legend" aria-label="Change order stages">
        {steps.map((step, index) => <span key={step}>{index + 1}. {labels[step]}</span>)}
      </div>
      {error && <p role="alert" className="enterprise-error">{error}</p>}
      <div className="enterprise-records">
        {changeOrders.map((order) => <article key={order.id} className="enterprise-co-record">
          <div>
            <div className="enterprise-control-title">
              <strong className="enterprise-mono">{order.number}</strong><strong>{order.title}</strong>
            </div>
            <p>{order.description}</p>
            <div className="enterprise-control-meta">
              <span>Cost: {money(order.amountDeltaMinor)}</span>
              <span>Schedule: {order.scheduleImpactDays >= 0 ? '+' : ''}{order.scheduleImpactDays} days</span>
              <span className={'enterprise-status enterprise-status--' + order.status}>{labels[order.status]}</span>
            </div>
          </div>
          <div className="enterprise-actions">
            {CO_TRANSITIONS[order.status].map((next) => <button key={next} type="button"
              disabled={!canEdit || busy || !!workingId || (next === 'approved' && !canApprove)}
              onClick={() => void update(order, next)}>
              {workingId === order.id ? 'Saving…' : next === 'approved' ? 'Approve CO' : next === 'rejected' ? 'Reject' : 'Move to ' + labels[next]}
            </button>)}
          </div>
        </article>)}
        {!changeOrders.length && <p className="enterprise-empty">No PCOs yet. Create one using the form above.</p>}
      </div>
    </section>
  );
}
