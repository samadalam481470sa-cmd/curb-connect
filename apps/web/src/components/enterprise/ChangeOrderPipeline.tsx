'use client';

import {
  CO_TRANSITIONS,
  formatImpact,
  type ChangeOrder,
  type COStatus,
} from '../../types/enterprise';

interface ChangeOrderPipelineProps {
  changeOrders: ChangeOrder[];
  canAdvance: boolean;
  canApprove: boolean;
  pendingId: string | null;
  onUpdateCOStatus: (id: string, status: COStatus) => Promise<unknown>;
}

const STATUS_LABELS: Record<COStatus, string> = {
  pco_draft: 'PCO draft',
  pricing_requested: 'Pricing requested',
  priced: 'Priced',
  submitted_to_owner: 'Submitted to owner',
  approved: 'Approved',
  rejected: 'Rejected',
};
const ACTION_LABELS: Partial<Record<COStatus, string>> = {
  pricing_requested: 'Request pricing',
  priced: 'Mark priced',
  submitted_to_owner: 'Submit to owner',
  approved: 'Approve CO',
  rejected: 'Reject CO',
};

export function ChangeOrderPipeline({
  changeOrders,
  canAdvance,
  canApprove,
  pendingId,
  onUpdateCOStatus,
}: ChangeOrderPipelineProps) {
  // Draft/quoted amounts are NOT booked revenue. Rejections do not count toward potential impact.
  const pendingValue = changeOrders
    .filter((co) => co.status !== 'rejected' && co.status !== 'approved')
    .reduce((sum, co) => sum + co.cost_impact_amount, 0);
  const approvedValue = changeOrders
    .filter((co) => co.status === 'approved')
    .reduce((sum, co) => sum + co.cost_impact_amount, 0);

  return (
    <section className="ec-panel" aria-labelledby="ec-co-heading">
      <header className="ec-panel__heading">
        <div>
          <h2 id="ec-co-heading">Change orders &amp; PCO pipeline</h2>
          <p>Pricing, submission, authorization and outcomes.</p>
        </div>
        <div className="ec-totals" aria-label="Change order value summary">
          <span>Potential (unapproved): <strong>{formatImpact(pendingValue)}</strong></span>
          <span>Approved: <strong>{formatImpact(approvedValue)}</strong></span>
        </div>
      </header>
      {changeOrders.length === 0 ? (
        <p className="ec-empty">No change orders have been recorded for this project.</p>
      ) : (
        <ul className="ec-co-list">
          {changeOrders.map((co) => {
            const next = CO_TRANSITIONS[co.status];
            const actions = next.filter((status) =>
              status === 'approved' || status === 'rejected' ? canApprove : canAdvance,
            );
            return (
              <li className="ec-co-item" key={co.id}>
                <div className="ec-co-body">
                  <div className="ec-co-title">
                    <span className="ec-mono">{co.co_number}</span>
                    <h3>{co.title}</h3>
                  </div>
                  <p>{co.description}</p>
                  <div className="ec-impacts">
                    <span className="ec-impact ec-impact--cost">
                      Cost impact: {formatImpact(co.cost_impact_amount)}
                    </span>
                    <span className="ec-impact ec-impact--schedule">
                      Schedule: {co.schedule_impact_days > 0 ? '+' : ''}
                      {co.schedule_impact_days} days
                    </span>
                  </div>
                </div>
                <div className="ec-co-actions">
                  <span className={`ec-status ec-status--${co.status}`}>
                    {STATUS_LABELS[co.status]}
                  </span>
                  {actions.map((status) => (
                    <button
                      type="button"
                      key={status}
                      className={`ec-button ${status === 'approved'
                        ? 'ec-button--positive'
                        : status === 'rejected'
                          ? 'ec-button--danger'
                          : 'ec-button--secondary'}`}
                      disabled={Boolean(pendingId)}
                      onClick={() => void onUpdateCOStatus(co.id, status).catch(() => undefined)}
                    >
                      {pendingId === co.id ? 'Saving…' : ACTION_LABELS[status]}
                    </button>
                  ))}
                  {!canApprove && co.status === 'submitted_to_owner' && (
                    <span className="ec-hint">Owner approval permission required.</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
