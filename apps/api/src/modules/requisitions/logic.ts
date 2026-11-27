// Requisition + backorder logic (blueprint gap 7). Pure logic, no I/O.

export type RequisitionStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'converted';

const FLOW: Record<RequisitionStatus, RequisitionStatus[]> = {
  draft: ['submitted'],
  submitted: ['approved', 'rejected'],
  approved: ['converted'],
  rejected: ['draft'],
  converted: [],
};

export function canTransitionRequisition(from: RequisitionStatus, to: RequisitionStatus): boolean {
  return FLOW[from].includes(to);
}

export interface RequisitionItem {
  label: string;
  quantity: number;
  unit: string;
  unitPriceMinor: number | null;
}

/** Total of priced items; null when nothing is priced (never invented). */
export function requisitionTotalMinor(items: readonly RequisitionItem[]): number | null {
  let total = 0;
  let priced = false;
  for (const item of items) {
    if (item.unitPriceMinor === null) continue;
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) continue;
    total += Math.round(item.quantity * item.unitPriceMinor);
    priced = true;
  }
  return priced ? total : null;
}

export interface PoLineForBackorder {
  lineIndex: number;
  label: string;
  orderedQty: number;
}

export interface BackorderLine {
  lineIndex: number;
  label: string;
  orderedQty: number;
  receivedQty: number;
  backorderedQty: number;
  fullyReceived: boolean;
}

/** Backordered = ordered − received (never negative). */
export function computeBackorders(
  poLines: readonly PoLineForBackorder[],
  receivedByLine: ReadonlyMap<number, number>,
): BackorderLine[] {
  return poLines.map((l) => {
    const receivedQty = receivedByLine.get(l.lineIndex) ?? 0;
    const backorderedQty = Math.max(0, l.orderedQty - receivedQty);
    return {
      lineIndex: l.lineIndex,
      label: l.label,
      orderedQty: l.orderedQty,
      receivedQty,
      backorderedQty,
      fullyReceived: backorderedQty === 0,
    };
  });
}

/** Days a backorder has been open (order date -> today), floored at 0. */
export function backorderAgeDays(orderCreatedIso: string, todayIso: string): number {
  const start = Date.parse(orderCreatedIso);
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(today)) return 0;
  return Math.max(0, Math.floor((today - start) / 86_400_000));
}
