import type { RfiRecord, ChangeOrderRecord } from './schemas';

export type RFIStatus = 'draft' | 'open' | 'answered' | 'closed';
export type COStatus = 'pco_draft' | 'pricing_requested' | 'priced' | 'submitted_to_owner' | 'approved' | 'rejected';

// Use the actual Field Pro API fields: camelCase, integer cents and revision-based concurrency.
// These aliases prevent accidental adoption of incompatible snake_case / decimal-money contracts.
export type RFI = Omit<RfiRecord, 'status'> & { status: RFIStatus };
export type ChangeOrder = Omit<ChangeOrderRecord, 'status'> & { status: COStatus };

export const RFI_TRANSITIONS: Record<RFIStatus, readonly RFIStatus[]> = {
  draft: ['open'], open: ['answered', 'closed'], answered: ['closed'], closed: [],
};
export const CO_TRANSITIONS: Record<COStatus, readonly COStatus[]> = {
  pco_draft: ['pricing_requested', 'rejected'],
  pricing_requested: ['priced', 'rejected'],
  priced: ['submitted_to_owner', 'rejected'],
  submitted_to_owner: ['approved', 'rejected'],
  approved: [], rejected: [],
};

export function isRfiStatus(status: string): status is RFIStatus {
  return Object.hasOwn(RFI_TRANSITIONS, status);
}
export function isCoStatus(status: string): status is COStatus {
  return Object.hasOwn(CO_TRANSITIONS, status);
}
