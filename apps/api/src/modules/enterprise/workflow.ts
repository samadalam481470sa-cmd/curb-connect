// Server-authoritative transitions. Frontend steps are not authorization.
export const RFI_NEXT = {
  draft: ['open'],
  open: ['answered', 'closed'],
  answered: ['closed'],
  closed: [],
} as const;
export const CO_NEXT = {
  pco_draft: ['pricing_requested', 'rejected'],
  pricing_requested: ['priced', 'rejected'],
  priced: ['submitted_to_owner', 'rejected'],
  submitted_to_owner: ['approved', 'rejected'],
  approved: [],
  rejected: [],
} as const;
export const SUBMITTAL_NEXT = {
  required: ['submitted'],
  submitted: ['under_review'],
  under_review: ['approved', 'approved_as_noted', 'revise_and_resubmit', 'rejected'],
  revise_and_resubmit: ['submitted'],
  approved: [],
  approved_as_noted: [],
  rejected: [],
} as const;

export type RfiStatus = keyof typeof RFI_NEXT;
export type CoStatus = keyof typeof CO_NEXT;
export type SubmittalStatus = keyof typeof SUBMITTAL_NEXT;

export function nextStatuses<K extends string>(
  graph: Record<K, readonly string[]>,
  current: K,
): readonly string[] {
  return graph[current] ?? [];
}

export function canTransition<K extends string>(
  graph: Record<K, readonly string[]>,
  current: K,
  next: string,
): boolean {
  return nextStatuses(graph, current).includes(next);
}

export interface SovMathLine {
  scheduledMinor: number;
  previousMinor: number;
  currentMinor: number;
  storedMinor: number;
  retainageBps: number;
}

/**
 * Exact integer minor-unit math for preliminary SOV.
 * Does not create an AIA-licensed form or a certified payment application.
 */
export function calculateSov(
  lines: readonly SovMathLine[],
  originalContractMinor: number,
  approvedChangeMinor: number,
  previousCertificatesMinor = 0,
) {
  const scheduledMinor = lines.reduce((sum, line) => sum + line.scheduledMinor, 0);
  let completedMinor = 0;
  let currentMinor = 0;
  let retainageMinor = 0;
  for (const line of lines) {
    const done = line.previousMinor + line.currentMinor + line.storedMinor;
    if (!Number.isSafeInteger(done) || done < 0 || done > line.scheduledMinor ||
      line.retainageBps < 0 || line.retainageBps > 10000) {
      throw new Error('SOV line exceeds its scheduled value or has invalid retainage.');
    }
    completedMinor += done;
    currentMinor += line.currentMinor;
    retainageMinor += Math.round(done * line.retainageBps / 10000);
  }
  const revisedContractMinor = originalContractMinor + approvedChangeMinor;
  const earnedLessRetainageMinor = completedMinor - retainageMinor;
  return {
    originalContractMinor,
    approvedChangeMinor,
    revisedContractMinor,
    scheduledMinor,
    completedMinor,
    currentMinor,
    retainageMinor,
    earnedLessRetainageMinor,
    previousCertificatesMinor,
    currentPaymentDueMinor: earnedLessRetainageMinor - previousCertificatesMinor,
    unbilledMinor: revisedContractMinor - completedMinor,
  };
}
