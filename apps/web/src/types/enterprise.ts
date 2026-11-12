import { z } from 'zod';

/**
 * Proposed project-controls API DTOs. The API must remain authoritative for tenant access,
 * workflow transitions, signatures and approval permissions.
 */
export const RFIStatusSchema = z.enum(['draft', 'open', 'answered', 'closed']);
export const COStatusSchema = z.enum([
  'pco_draft',
  'pricing_requested',
  'priced',
  'submitted_to_owner',
  'approved',
  'rejected',
]);
export type RFIStatus = z.infer<typeof RFIStatusSchema>;
export type COStatus = z.infer<typeof COStatusSchema>;

export const RFISchema = z.object({
  id: z.string().min(1),
  project_id: z.string().min(1),
  rfi_number: z.number().int().nonnegative(),
  subject: z.string(),
  question: z.string(),
  suggested_solution: z.string().nullish(),
  status: RFIStatusSchema,
  ball_in_court_user_id: z.string(),
  cost_impact: z.boolean(),
  schedule_impact_days: z.number().int(),
  official_response: z.string().nullish(),
  answered_at: z.string().nullish(),
  created_at: z.string(),
});
export const ChangeOrderSchema = z.object({
  id: z.string().min(1),
  project_id: z.string().min(1),
  co_number: z.string(),
  title: z.string(),
  description: z.string(),
  status: COStatusSchema,
  /** Decimal dollars, NOT the minor-unit integer stored by the existing API schema. */
  cost_impact_amount: z.number().finite(),
  schedule_impact_days: z.number().int(),
  owner_approved_at: z.string().nullish(),
  created_at: z.string(),
});
export const RFIListSchema = z.array(RFISchema);
export const ChangeOrderListSchema = z.array(ChangeOrderSchema);

export type RFI = z.infer<typeof RFISchema>;
export type ChangeOrder = z.infer<typeof ChangeOrderSchema>;

export const RFI_TRANSITIONS: Record<RFIStatus, readonly RFIStatus[]> = {
  draft: ['open'],
  open: ['answered'],
  answered: ['closed'],
  closed: [],
};
export const CO_TRANSITIONS: Record<COStatus, readonly COStatus[]> = {
  pco_draft: ['pricing_requested'],
  pricing_requested: ['priced'],
  priced: ['submitted_to_owner'],
  submitted_to_owner: ['approved', 'rejected'],
  approved: [],
  rejected: [],
};

export function mayTransitionRFI(from: RFIStatus, to: RFIStatus): boolean {
  return RFI_TRANSITIONS[from].includes(to);
}

export function mayTransitionCO(from: COStatus, to: COStatus): boolean {
  return CO_TRANSITIONS[from].includes(to);
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function formatImpact(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
