// Lifecycle transition tables (STR-006, RR-039, CV-050, CP-056, OPS-062..069, BE-079).
// The API calls assertTransition() before every status write and records the transition as an
// immutable event; the web app uses nextStates() to decide which actions to show.
import {
  CALIBRATION_STATUSES,
  CHANGE_ORDER_STATUSES,
  CURB_PROJECT_STATUSES,
  DISPATCH_STATUSES,
  ESTIMATE_STATUSES,
  INVITATION_STATUSES,
  INVOICE_STATUSES,
  LEAD_STATUSES,
  MEDIA_STATUSES,
  MEMBERSHIP_STATUSES,
  PAYMENT_STATUSES,
  PERMIT_STATUSES,
  PRICE_BOOK_REVISION_STATUSES,
  PROPOSAL_STATUSES,
  PROPOSAL_VERSION_STATUSES,
  REVIEW_TASK_STATUSES,
  ROOF_ORDER_STATUSES,
  ROOF_REPORT_VERSION_STATUSES,
  SAFETY_REVIEW_STATUSES,
  SIGNATURE_ENVELOPE_STATUSES,
  SUPPLIER_ORDER_STATUSES,
  type JobStageCategory,
  type RoofOrderStatus,
} from './enums';
import { defineStateMachine, type StateMachine } from './state-machine';

/**
 * STR-006 / RF-021 / RR-039 roof order. DIY orders go ordered -> measuring directly; assisted
 * orders wait for licensed imagery. Reissuing an approved report returns to review_required.
 */
export const roofOrderMachine = defineStateMachine({
  name: 'roof_order',
  states: ROOF_ORDER_STATUSES,
  initial: 'draft',
  transitions: {
    draft: ['ordered', 'cancelled'],
    ordered: ['imagery_pending', 'measuring', 'failed', 'cancelled'],
    imagery_pending: ['measuring', 'clarification_needed', 'failed', 'cancelled'],
    measuring: ['review_required', 'clarification_needed', 'failed', 'cancelled'],
    review_required: ['approved', 'measuring', 'clarification_needed', 'failed'],
    clarification_needed: ['imagery_pending', 'measuring', 'review_required', 'failed', 'cancelled'],
    approved: ['quoted', 'review_required'],
    quoted: ['won', 'approved', 'cancelled'],
    won: ['invoiced'],
    invoiced: ['paid'],
    paid: [],
    failed: ['measuring', 'refunded'],
    refunded: [],
    cancelled: [],
  },
});

/** RR-039 customer-facing delivery states (page 039 names). */
export const ROOF_DELIVERY_STATES = [
  'draft',
  'ordered',
  'waiting_for_licensed_image',
  'in_review',
  'clarification_needed',
  'complete',
  'failed',
  'refunded',
  'cancelled',
] as const;
export type RoofDeliveryState = (typeof ROOF_DELIVERY_STATES)[number];

const ROOF_DELIVERY_BY_STATUS: Record<RoofOrderStatus, RoofDeliveryState> = {
  draft: 'draft',
  ordered: 'ordered',
  imagery_pending: 'waiting_for_licensed_image',
  measuring: 'in_review',
  review_required: 'in_review',
  clarification_needed: 'clarification_needed',
  approved: 'complete',
  quoted: 'complete',
  won: 'complete',
  invoiced: 'complete',
  paid: 'complete',
  failed: 'failed',
  refunded: 'refunded',
  cancelled: 'cancelled',
};
export function roofDeliveryState(status: RoofOrderStatus): RoofDeliveryState {
  return ROOF_DELIVERY_BY_STATUS[status];
}

/** RR-037: versions are editable only as draft; every other state is an immutable snapshot. */
export const roofReportVersionMachine = defineStateMachine({
  name: 'roof_report_version',
  states: ROOF_REPORT_VERSION_STATUSES,
  initial: 'draft',
  transitions: {
    draft: ['submitted', 'superseded'],
    submitted: ['approved', 'rejected'],
    approved: ['issued', 'superseded'],
    issued: ['superseded'],
    rejected: [],
    superseded: [],
  },
});

/**
 * CV-050 estimate statuses (roof and curb). `approved` is reachable only from pricing_ready and
 * only when gating has no blockers (enforced by the API); a withdrawn approval or a material
 * measurement change sends it back to review_required (CP-059 S).
 */
export const estimateMachine = defineStateMachine({
  name: 'estimate',
  states: ESTIMATE_STATUSES,
  initial: 'draft_ai',
  transitions: {
    draft_ai: [
      'calibration_required',
      'review_required',
      'field_check_required',
      'pricing_ready',
      'rejected',
    ],
    calibration_required: ['review_required', 'field_check_required', 'rejected'],
    review_required: ['calibration_required', 'field_check_required', 'pricing_ready', 'rejected'],
    field_check_required: ['review_required', 'pricing_ready', 'rejected'],
    pricing_ready: [
      'approved',
      'review_required',
      'field_check_required',
      'calibration_required',
      'rejected',
    ],
    approved: ['review_required'],
    rejected: ['draft_ai'],
  },
});
/** Alias used by curb screens (page 050 names the curb estimate statuses). */
export const curbEstimateMachine = estimateMachine;

export const curbProjectMachine = defineStateMachine({
  name: 'curb_project',
  states: CURB_PROJECT_STATUSES,
  initial: 'intake',
  transitions: {
    intake: ['capture', 'cancelled'],
    capture: ['intake', 'calibration', 'measurement', 'cancelled'],
    calibration: ['capture', 'measurement', 'cancelled'],
    measurement: ['capture', 'calibration', 'estimating', 'cancelled'],
    estimating: ['measurement', 'review', 'cancelled'],
    review: ['capture', 'measurement', 'estimating', 'approved', 'cancelled'],
    approved: ['review', 'scheduled', 'cancelled'],
    scheduled: ['approved', 'completed', 'cancelled'],
    completed: [],
    cancelled: [],
  },
});

/** OPS-063: a budgetary proposal cannot reach accepted (checked by the API, not the table). */
export const proposalMachine = defineStateMachine({
  name: 'proposal',
  states: PROPOSAL_STATUSES,
  initial: 'draft',
  transitions: {
    draft: ['pending_approval', 'ready_to_send', 'voided'],
    pending_approval: ['ready_to_send', 'draft', 'voided'],
    ready_to_send: ['sent', 'draft', 'voided'],
    sent: ['viewed', 'accepted', 'declined', 'expired', 'voided'],
    viewed: ['accepted', 'declined', 'expired', 'voided'],
    accepted: ['voided'],
    declined: ['draft'],
    expired: ['draft'],
    voided: [],
  },
});

export const proposalVersionMachine = defineStateMachine({
  name: 'proposal_version',
  states: PROPOSAL_VERSION_STATUSES,
  initial: 'draft',
  transitions: {
    draft: ['sent', 'superseded'],
    sent: ['accepted', 'declined', 'superseded'],
    accepted: [],
    declined: [],
    superseded: [],
  },
});

/** OPS-068: issued status and settlement are distinct from a provider's pending authorization. */
export const invoiceMachine = defineStateMachine({
  name: 'invoice',
  states: INVOICE_STATUSES,
  initial: 'draft',
  transitions: {
    draft: ['pending_approval', 'issued', 'void'],
    pending_approval: ['issued', 'draft', 'void'],
    issued: ['partially_paid', 'paid', 'void', 'uncollectible'],
    partially_paid: ['paid', 'partially_refunded', 'uncollectible'],
    paid: ['partially_refunded', 'refunded'],
    partially_refunded: ['refunded'],
    uncollectible: ['partially_paid', 'paid'],
    void: [],
    refunded: [],
  },
});

export const paymentMachine = defineStateMachine({
  name: 'payment',
  states: PAYMENT_STATUSES,
  initial: 'pending',
  transitions: {
    pending: ['requires_action', 'processing', 'succeeded', 'failed', 'canceled'],
    requires_action: ['processing', 'succeeded', 'failed', 'canceled'],
    processing: ['succeeded', 'failed'],
    succeeded: ['partially_refunded', 'refunded'],
    partially_refunded: ['refunded'],
    failed: [],
    canceled: [],
    refunded: [],
  },
});

export const signatureEnvelopeMachine = defineStateMachine({
  name: 'signature_envelope',
  states: SIGNATURE_ENVELOPE_STATUSES,
  initial: 'draft',
  transitions: {
    draft: ['sent', 'voided'],
    sent: ['partially_signed', 'completed', 'declined', 'voided', 'expired'],
    partially_signed: ['completed', 'declined', 'voided', 'expired'],
    completed: [],
    declined: [],
    voided: [],
    expired: [],
  },
});

/** OPS-069: a rejected or withdrawn change order leaves the base contract untouched. */
export const changeOrderMachine = defineStateMachine({
  name: 'change_order',
  states: CHANGE_ORDER_STATUSES,
  initial: 'draft',
  transitions: {
    draft: ['pending_internal_approval', 'sent_to_customer', 'withdrawn'],
    pending_internal_approval: ['draft', 'sent_to_customer', 'withdrawn'],
    sent_to_customer: ['accepted', 'rejected', 'withdrawn'],
    accepted: [],
    rejected: [],
    withdrawn: [],
  },
});

/** RR-033 / AIQ-086: leases expire back to open; high-risk work waits for a second review. */
export const reviewTaskMachine = defineStateMachine({
  name: 'review_task',
  states: REVIEW_TASK_STATUSES,
  initial: 'open',
  transitions: {
    open: ['claimed', 'escalated', 'cancelled'],
    claimed: ['open', 'awaiting_second_review', 'completed', 'escalated', 'cancelled'],
    awaiting_second_review: ['open', 'completed', 'escalated', 'cancelled'],
    escalated: ['open', 'claimed', 'cancelled'],
    completed: [],
    cancelled: [],
  },
});

/** CP-056: unknown is the starting state and holds approval; expiry reverts readiness (OPS-067). */
export const permitRequirementMachine = defineStateMachine({
  name: 'permit_requirement',
  states: PERMIT_STATUSES,
  initial: 'unknown',
  transitions: {
    unknown: ['not_required', 'required'],
    not_required: ['required'],
    required: ['application_prepared', 'submitted', 'not_required'],
    application_prepared: ['submitted', 'required'],
    submitted: ['approved', 'rejected'],
    approved: ['expired'],
    rejected: ['application_prepared', 'required'],
    expired: ['required', 'application_prepared'],
  },
});

export const safetyReviewMachine = defineStateMachine({
  name: 'safety_review',
  states: SAFETY_REVIEW_STATUSES,
  initial: 'pending',
  transitions: {
    pending: ['approved', 'rejected', 'not_applicable'],
    approved: ['expired'],
    rejected: ['pending'],
    expired: ['pending'],
    not_applicable: ['pending'],
  },
});

/** CP-057: an approved revision is immutable (DB trigger); a change is a new revision. */
export const priceBookRevisionMachine = defineStateMachine({
  name: 'price_book_revision',
  states: PRICE_BOOK_REVISION_STATUSES,
  initial: 'draft',
  transitions: {
    draft: ['pending_approval'],
    pending_approval: ['approved', 'draft'],
    approved: ['retired'],
    retired: [],
  },
});

/** OPS-066: submission needs explicit acknowledgment; confirmation comes from the supplier. */
export const supplierOrderMachine = defineStateMachine({
  name: 'supplier_order',
  states: SUPPLIER_ORDER_STATUSES,
  initial: 'draft',
  transitions: {
    draft: ['pending_acknowledgment', 'cancelled'],
    pending_acknowledgment: ['submitted', 'draft', 'cancelled'],
    submitted: ['confirmed', 'rejected', 'cancelled'],
    confirmed: ['partially_delivered', 'delivered', 'cancelled'],
    partially_delivered: ['delivered'],
    delivered: [],
    cancelled: [],
    rejected: ['draft'],
  },
});

/** OPS-067: blocked dispatches return to planned only after the blockers clear. */
export const dispatchMachine = defineStateMachine({
  name: 'dispatch',
  states: DISPATCH_STATUSES,
  initial: 'planned',
  transitions: {
    planned: ['blocked', 'released', 'cancelled'],
    blocked: ['planned', 'cancelled'],
    released: ['acknowledged', 'blocked', 'cancelled'],
    acknowledged: ['in_progress', 'blocked', 'cancelled'],
    in_progress: ['completed', 'blocked'],
    completed: [],
    cancelled: [],
  },
});

export const leadMachine = defineStateMachine({
  name: 'lead',
  states: LEAD_STATUSES,
  initial: 'new',
  transitions: {
    new: ['contacted', 'qualified', 'converted', 'disqualified', 'merged'],
    contacted: ['qualified', 'converted', 'disqualified', 'merged'],
    qualified: ['converted', 'disqualified', 'merged'],
    disqualified: ['new'],
    converted: [],
    merged: [],
  },
});

export const invitationMachine = defineStateMachine({
  name: 'invitation',
  states: INVITATION_STATUSES,
  initial: 'pending',
  transitions: { pending: ['accepted', 'revoked', 'expired'], accepted: [], revoked: [], expired: [] },
});

export const membershipMachine = defineStateMachine({
  name: 'membership',
  states: MEMBERSHIP_STATUSES,
  initial: 'active',
  transitions: { active: ['suspended', 'revoked'], suspended: ['active', 'revoked'], revoked: [] },
});

export const calibrationMachine = defineStateMachine({
  name: 'calibration',
  states: CALIBRATION_STATUSES,
  initial: 'pending',
  transitions: { pending: ['accepted', 'failed'], accepted: ['superseded'], failed: [], superseded: [] },
});

export const mediaAssetMachine = defineStateMachine({
  name: 'media_asset',
  states: MEDIA_STATUSES,
  initial: 'pending_upload',
  transitions: {
    pending_upload: ['uploaded', 'rejected'],
    uploaded: ['processing', 'ready', 'rejected', 'deleted'],
    processing: ['ready', 'rejected'],
    ready: ['deleted'],
    rejected: ['deleted'],
    deleted: [],
  },
});

// ---------------------------------------------------------------- job pipeline (configurable)
export interface JobStageDefinitionData {
  key: string;
  label: string;
  category: JobStageCategory;
  position: number;
  allowedNext: readonly string[];
}

/**
 * OPS-062 default pipeline seeded for every organization. Orgs may rename, add or reorder
 * stages (job_stage_definitions); transitions stay explicit. A voided proposal or refunded
 * invoice moves a job back (won -> proposal_sent) so the board reflects business truth.
 */
export const DEFAULT_JOB_STAGES: readonly JobStageDefinitionData[] = [
  {
    key: 'new_lead',
    label: 'New lead',
    category: 'open',
    position: 10,
    allowedNext: ['inspection_needed', 'measuring', 'estimating', 'lost'],
  },
  {
    key: 'inspection_needed',
    label: 'Inspection needed',
    category: 'open',
    position: 20,
    allowedNext: ['measuring', 'estimating', 'lost'],
  },
  {
    key: 'measuring',
    label: 'Measuring',
    category: 'open',
    position: 30,
    allowedNext: ['estimating', 'inspection_needed', 'lost'],
  },
  {
    key: 'estimating',
    label: 'Estimating',
    category: 'open',
    position: 40,
    allowedNext: ['proposal_sent', 'measuring', 'lost'],
  },
  {
    key: 'proposal_sent',
    label: 'Proposal sent',
    category: 'open',
    position: 50,
    allowedNext: ['won', 'estimating', 'lost'],
  },
  {
    key: 'won',
    label: 'Won',
    category: 'won',
    position: 60,
    allowedNext: ['scheduled', 'proposal_sent', 'lost'],
  },
  {
    key: 'scheduled',
    label: 'Scheduled',
    category: 'won',
    position: 70,
    allowedNext: ['in_progress', 'won'],
  },
  {
    key: 'in_progress',
    label: 'In progress',
    category: 'won',
    position: 80,
    allowedNext: ['closed', 'scheduled'],
  },
  { key: 'closed', label: 'Closed', category: 'closed', position: 90, allowedNext: [] },
  { key: 'lost', label: 'Lost', category: 'lost', position: 100, allowedNext: ['new_lead'] },
];

/** Builds a machine from an organization's stage definitions (first by position is initial). */
export function jobStageMachine(
  stages: readonly JobStageDefinitionData[] = DEFAULT_JOB_STAGES,
): StateMachine<string> {
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  const first = ordered[0];
  if (!first) throw new Error('job_stage: at least one stage is required');
  const transitions: Record<string, readonly string[]> = {};
  for (const stage of ordered) transitions[stage.key] = stage.allowedNext;
  return defineStateMachine<string>({
    name: 'job_stage',
    states: ordered.map((s) => s.key),
    initial: first.key,
    transitions,
  });
}

export const defaultJobStageMachine = jobStageMachine();

/** Every fixed machine, for documentation, tests and the web app's action menus. */
export const STATE_MACHINES = {
  roofOrder: roofOrderMachine,
  roofReportVersion: roofReportVersionMachine,
  estimate: estimateMachine,
  curbProject: curbProjectMachine,
  proposal: proposalMachine,
  proposalVersion: proposalVersionMachine,
  invoice: invoiceMachine,
  payment: paymentMachine,
  signatureEnvelope: signatureEnvelopeMachine,
  changeOrder: changeOrderMachine,
  reviewTask: reviewTaskMachine,
  permitRequirement: permitRequirementMachine,
  safetyReview: safetyReviewMachine,
  priceBookRevision: priceBookRevisionMachine,
  supplierOrder: supplierOrderMachine,
  dispatch: dispatchMachine,
  lead: leadMachine,
  invitation: invitationMachine,
  membership: membershipMachine,
  calibration: calibrationMachine,
  mediaAsset: mediaAssetMachine,
  jobStage: defaultJobStageMachine,
} as const;
