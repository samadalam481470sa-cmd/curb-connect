'use client';

// CP-059 / CP-060 / ADD-052 approval panel: shows exactly which gate blocks firm approval and
// which blocks dispatch (from GET /curb/projects/{id}/readiness), each with what clears it and a
// link to the tab where it is fixed. Sign-off goes through POST /v1/estimates/{id}/approve; the
// server enforces every gate again, so a blocked approve button is a convenience, not the check.
import type { Estimate } from '@fieldline/contracts';
import { Button, StatusPill } from '@fieldline/ui';
import { useState } from 'react';
import { useSession } from '../../lib/session';
import { ErrorNotice } from '../common';
import { Panel } from './CurbCommon';
import { gateTarget, type Gate } from './model';
import { useCurbProject } from './useCurbProject';

export function ApprovalPanel({ estimate, onTab, onApproved }: { estimate?: Estimate; onTab?: (tab: string) => void; onApproved?: () => void }) {
  const { readiness, curb } = useCurbProject();
  const session = useSession();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const rev = estimate?.currentRevision ?? null;
  const warnings = rev?.gating.warnings.map((w) => w.code) ?? [];
  const blockers: Gate[] = rev?.gating.blockers ?? [];
  const approveCheck = session.check('estimate:signoff');

  let reason: string | null = null;
  if (!estimate || !rev) reason = 'Create and price an estimate first.';
  else if (estimate.stale) reason = 'Inputs changed since pricing. Reprice before approval.';
  else if (rev.scenarios === null) reason = 'Pricing is pending review.';
  else if (blockers.length) reason = `${blockers.length} blocker(s) on this estimate must be cleared.`;
  else if (!approveCheck.allowed) reason = approveCheck.reason ?? 'You cannot sign off estimates.';

  const approve = async () => {
    if (!estimate || !rev) return;
    setBusy(true);
    setError(null);
    try {
      await curb.approve(estimate.id, { revisionId: rev.id, signoffRole: 'estimator', acknowledgedWarnings: warnings });
      onApproved?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Approval and dispatch" id="approval">
      {!readiness ? (
        <p className="web-muted">Checking gates…</p>
      ) : (
        <>
          <div className="curb-gates__summary">
            <p>
              Firm approval: <StatusPill status={readiness.canApproveFirm ? 'ready' : 'blocked'} tone={readiness.canApproveFirm ? 'success' : 'danger'} label={readiness.canApproveFirm ? 'Possible' : 'Blocked'} />
            </p>
            <p>
              Dispatch: <StatusPill status={readiness.canDispatch ? 'ready' : 'blocked'} machine="dispatch" label={readiness.canDispatch ? 'Ready' : 'Blocked'} />
            </p>
            <p className="web-muted">Quote kind if priced now: {readiness.quoteKind.replace(/_/g, ' ')}. Rules {readiness.rulesVersion}.</p>
          </div>
          {readiness.gates.length > 0 && (
            <ol className="curb-gates" aria-label="Open gates">
              {readiness.gates.map((g) => (
                <GateRow key={g.code} gate={g} onTab={onTab} />
              ))}
            </ol>
          )}
        </>
      )}
      {blockers.length > 0 && (
        <>
          <h3>Estimate blockers</h3>
          <ol className="curb-gates">
            {blockers.map((g) => (
              <GateRow key={g.code} gate={g} onTab={onTab} />
            ))}
          </ol>
        </>
      )}
      {rev && rev.gating.requiredSignoffs.length > 0 && <p className="web-muted">Sign-offs required: {rev.gating.requiredSignoffs.join(', ').replace(/_/g, ' ')}.</p>}
      {warnings.length > 0 && <p className="curb-warn">Approving acknowledges {warnings.length} warning(s) shown on the estimate.</p>}
      <Button disabled={reason !== null} deniedReason={reason ?? undefined} loading={busy} onClick={() => void approve()}>
        Sign off estimate
      </Button>
      {reason && <p className="curb-hint" data-testid="approve-blocked">{reason}</p>}
      {error !== null && <ErrorNotice error={error} title="Approval refused" />}
    </Panel>
  );
}

function GateRow({ gate, onTab }: { gate: Gate; onTab?: (tab: string) => void }) {
  const target = gateTarget(gate.code);
  return (
    <li data-gate={gate.code}>
      <strong>{gate.message}</strong>
      {gate.resolution && <span> Clears when: {gate.resolution}</span>}
      {onTab && (
        <button type="button" className="curb-link" onClick={() => onTab(target)}>
          Go to {target}
        </button>
      )}
    </li>
  );
}
