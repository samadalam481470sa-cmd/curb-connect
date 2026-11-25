// Roof claims (web): response schemas, status labels/stepper and hours formatting.
// Pure logic only (no React, no network) so it can be unit-tested.
// Schemas mirror the API module (apps/api/src/modules/roofClaims/) for client validation.
import { z } from 'zod';

export const CLAIM_STATUSES = [
  'filed',
  'adjuster_assigned',
  'inspection_scheduled',
  'estimate_submitted',
  'approved',
  'denied',
  'settled',
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  filed: 'Filed',
  adjuster_assigned: 'Adjuster assigned',
  inspection_scheduled: 'Inspection scheduled',
  estimate_submitted: 'Estimate submitted',
  approved: 'Approved',
  denied: 'Denied',
  settled: 'Settled',
};

export function claimStatusLabel(status: ClaimStatus): string {
  return CLAIM_STATUS_LABELS[status];
}

/**
 * The happy-path stepper. Denied is a terminal branch, not a step: a denied claim shows
 * the steps it reached, then "Denied".
 */
export const CLAIM_STEPPER: readonly ClaimStatus[] = [
  'filed',
  'adjuster_assigned',
  'inspection_scheduled',
  'estimate_submitted',
  'approved',
  'settled',
];

/** Next status on the happy path, or null when the claim is denied, settled, or unknown. */
export function nextClaimStatus(status: ClaimStatus): ClaimStatus | null {
  const i = CLAIM_STEPPER.indexOf(status);
  return i >= 0 && i < CLAIM_STEPPER.length - 1 ? CLAIM_STEPPER[i + 1]! : null;
}

export const ClaimDocumentSchema = z.object({
  id: z.uuid(),
  claimId: z.uuid(),
  mediaAssetId: z.string().nullable(),
  inspectionReportId: z.string().nullable(),
  kind: z.enum(['inspection_report', 'photo', 'estimate', 'correspondence', 'other']),
  label: z.string().nullable(),
  createdAt: z.string(),
});
export type ClaimDocument = z.infer<typeof ClaimDocumentSchema>;

export const RoofClaimSchema = z.object({
  id: z.uuid(),
  roofOrderId: z.uuid(),
  carrier: z.string(),
  adjusterName: z.string().nullable(),
  adjusterContact: z.string().nullable(),
  claimNumber: z.string().nullable(),
  status: z.enum(CLAIM_STATUSES),
  note: z.string().nullable(),
  documents: z.array(ClaimDocumentSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RoofClaim = z.infer<typeof RoofClaimSchema>;

export const RoofClaimListSchema = z.object({ items: z.array(RoofClaimSchema) });

export const AgentHoursSchema = z.object({
  agent: z.enum(['storms', 'estimator', 'claims', 'scheduler', 'follow-ups', 'front_desk']),
  label: z.string(),
  actions: z.number().int(),
  measuredActions: z.number().int(),
  minutesSaved: z.number().int().nullable(),
  hoursSaved: z.number().nullable(),
  measured: z.boolean(),
});
export type AgentHours = z.infer<typeof AgentHoursSchema>;

export const AgentActivityTotalsSchema = z.object({
  agents: z.array(AgentHoursSchema),
  totalHoursSaved: z.number().nullable(),
  measured: z.boolean(),
  note: z.string(),
});
export type AgentActivityTotals = z.infer<typeof AgentActivityTotalsSchema>;

/** "1.5 hrs (estimate)" for measured agents; "Not measured yet" for the rest. */
export function agentHoursLabel(agent: AgentHours): string {
  if (!agent.measured || agent.hoursSaved === null) return 'Not measured yet';
  return `${agent.hoursSaved} hrs (estimate)`;
}

/** The inspection report page. Inspection drafts live in the browser (no server record
 *  and no id deep-link), so evidence links go to the inspection page and show the stored
 *  report id next to the link for matching the draft. */
export const INSPECTION_PAGE_PATH = '/roof/inspection';
