import { cx } from '../internal/cx';
import type { Tone } from '../types';

/**
 * Status vocabularies of every workflow state machine named in the blueprint. The authoritative
 * transition rules live in @fieldline/contracts and the API; this table only decides how each
 * state looks. A status missing here still renders (neutral tone, humanized label).
 */
export const STATUS_MACHINES = {
  /** STR-006: lead-to-payment job lifecycle. */
  job: [
    'draft',
    'imagery_pending',
    'measuring',
    'review_required',
    'approved',
    'quoted',
    'won',
    'invoiced',
    'paid',
    'lost',
    'cancelled',
  ],
  /** RR-039: roof measurement order delivery. */
  roofOrder: [
    'ordered',
    'waiting_for_licensed_image',
    'in_review',
    'clarification_needed',
    'complete',
    'failed',
    'refunded',
  ],
  /** RR-037: roof report versions. */
  roofReport: ['draft', 'in_review', 'approved', 'superseded'],
  /** CV-050: curb estimate verification. */
  curbEstimate: [
    'draft_ai',
    'calibration_required',
    'review_required',
    'field_check_required',
    'pricing_ready',
    'approved',
    'rejected',
  ],
  /** CP-056: permit requirement records. */
  permit: [
    'unknown',
    'not_required',
    'required',
    'application_submitted',
    'issued',
    'expired',
    'denied',
  ],
  /** CV-049 / OPS-067: utility locate and readiness checks. */
  utilityCheck: ['unknown', 'requested', 'marked', 'conflict_found', 'cleared', 'expired'],
  /** OPS-063: proposals. */
  proposal: ['draft', 'budgetary', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'voided'],
  /** OPS-064: signature envelopes. */
  signature: ['created', 'sent', 'partially_signed', 'completed', 'declined', 'expired', 'voided'],
  /** OPS-068: invoices (ledger state, distinct from a provider's pending authorization). */
  invoice: [
    'draft',
    'approved',
    'issued',
    'payment_pending',
    'partially_paid',
    'paid',
    'overdue',
    'refunded',
    'void',
  ],
  /** OPS-069: change orders. */
  changeOrder: ['draft', 'pending_acceptance', 'accepted', 'rejected', 'withdrawn'],
  /** OPS-067: dispatch readiness. */
  dispatch: ['blocked', 'ready', 'scheduled', 'dispatched', 'in_progress', 'completed'],
} as const satisfies Record<string, readonly string[]>;

export type StatusMachine = keyof typeof STATUS_MACHINES;
export type MachineStatus<M extends StatusMachine> = (typeof STATUS_MACHINES)[M][number];

const STATUS_PRESENTATION: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  imagery_pending: { label: 'Imagery pending', tone: 'info' },
  measuring: { label: 'Measuring', tone: 'info' },
  review_required: { label: 'Review required', tone: 'review' },
  approved: { label: 'Approved', tone: 'success' },
  quoted: { label: 'Quoted', tone: 'info' },
  won: { label: 'Won', tone: 'success' },
  invoiced: { label: 'Invoiced', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
  lost: { label: 'Lost', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  ordered: { label: 'Ordered', tone: 'info' },
  waiting_for_licensed_image: { label: 'Waiting for licensed imagery', tone: 'warning' },
  in_review: { label: 'In review', tone: 'review' },
  clarification_needed: { label: 'Clarification needed', tone: 'warning' },
  complete: { label: 'Complete', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  refunded: { label: 'Refunded', tone: 'neutral' },
  superseded: { label: 'Superseded', tone: 'neutral' },
  draft_ai: { label: 'Machine draft', tone: 'neutral' },
  calibration_required: { label: 'Calibration required', tone: 'warning' },
  field_check_required: { label: 'Field check required', tone: 'warning' },
  pricing_ready: { label: 'Ready for pricing', tone: 'info' },
  rejected: { label: 'Rejected', tone: 'danger' },
  unknown: { label: 'Unknown', tone: 'warning' },
  not_required: { label: 'Not required', tone: 'neutral' },
  required: { label: 'Required', tone: 'warning' },
  application_submitted: { label: 'Application submitted', tone: 'info' },
  issued: { label: 'Issued', tone: 'success' },
  expired: { label: 'Expired', tone: 'danger' },
  denied: { label: 'Denied', tone: 'danger' },
  requested: { label: 'Requested', tone: 'info' },
  marked: { label: 'Marked', tone: 'info' },
  conflict_found: { label: 'Conflict found', tone: 'danger' },
  cleared: { label: 'Cleared', tone: 'success' },
  budgetary: { label: 'Budgetary only', tone: 'warning' },
  sent: { label: 'Sent', tone: 'info' },
  viewed: { label: 'Viewed', tone: 'info' },
  accepted: { label: 'Accepted', tone: 'success' },
  declined: { label: 'Declined', tone: 'danger' },
  voided: { label: 'Voided', tone: 'neutral' },
  created: { label: 'Created', tone: 'neutral' },
  partially_signed: { label: 'Partially signed', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  payment_pending: { label: 'Payment pending', tone: 'info' },
  partially_paid: { label: 'Partially paid', tone: 'info' },
  overdue: { label: 'Overdue', tone: 'danger' },
  void: { label: 'Void', tone: 'neutral' },
  pending_acceptance: { label: 'Pending acceptance', tone: 'info' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
  blocked: { label: 'Blocked', tone: 'danger' },
  ready: { label: 'Ready', tone: 'success' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  dispatched: { label: 'Dispatched', tone: 'info' },
  in_progress: { label: 'In progress', tone: 'info' },
};

/** Per-machine overrides where the same word means something different. */
const MACHINE_OVERRIDES: Partial<
  Record<StatusMachine, Record<string, { label: string; tone: Tone }>>
> = {
  permit: { issued: { label: 'Permit issued', tone: 'success' } },
  roofReport: { approved: { label: 'Final', tone: 'success' } },
};

function humanize(status: string): string {
  const text = status.replace(/[_-]+/g, ' ').trim();
  return text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : 'Unknown status';
}

/** How a status renders: label and tone, with machine-specific overrides and a safe fallback. */
export function statusPresentation(
  status: string,
  machine?: StatusMachine,
): { label: string; tone: Tone; known: boolean } {
  const override = machine ? MACHINE_OVERRIDES[machine]?.[status] : undefined;
  const base = override ?? STATUS_PRESENTATION[status];
  if (base) return { ...base, known: true };
  return { label: humanize(status), tone: 'neutral', known: false };
}

export interface StatusPillProps {
  status: string;
  machine?: StatusMachine;
  /** Override the label (e.g. a translated string). The tone still comes from the status. */
  label?: string;
  tone?: Tone;
  size?: 'sm' | 'md';
  className?: string;
}

/** Compact, read-only status indicator. The text is the meaning; color and glyph reinforce it. */
export function StatusPill({
  status,
  machine,
  label,
  tone,
  size = 'md',
  className,
}: StatusPillProps) {
  const presentation = statusPresentation(status, machine);
  const effectiveTone = tone ?? presentation.tone;
  return (
    <span
      className={cx('fl-pill', `fl-pill--${effectiveTone}`, `fl-pill--${size}`, className)}
      data-status={status}
      data-tone={effectiveTone}
    >
      <span className="fl-pill__glyph" aria-hidden="true" />
      {label ?? presentation.label}
    </span>
  );
}
