/** Supplier ordering gate (Phase D, item 17).
 *
 * The feature stays switched OFF by default (`ops.supplier_orders`, defaultEnabled: false).
 * Even when a company turns the flag on, orders are draft-only: no supplier integration
 * exists in this repo, so submitting to a supplier is blocked with a plain reason instead
 * of pretending an order was sent.
 */
export const SUPPLIER_ORDERS_FLAG = 'ops.supplier_orders' as const;

export type SupplierGateDecision =
  | { allowed: true }
  | { allowed: false; code: 'feature_unavailable'; message: string };

export function supplierOrdersGate(flagEnabled: boolean): SupplierGateDecision {
  if (!flagEnabled) {
    return {
      allowed: false,
      code: 'feature_unavailable',
      message: 'Supplier ordering is switched off for this company.',
    };
  }
  return { allowed: true };
}

/** Submission is never allowed until a real supplier integration is connected. */
export function supplierSubmitGate(): SupplierGateDecision {
  return {
    allowed: false,
    code: 'feature_unavailable',
    message:
      'No supplier integration is connected, so orders stay as drafts. Send the draft to your supplier outside Field Pro.',
  };
}

export interface SupplierOrderLineInput {
  label: string;
  quantity: number;
  unit: string;
  /** Contractor-entered unit price in minor units; null = not priced yet. */
  unitPriceMinor: number | null;
}

export function supplierOrderTotalMinor(lines: readonly SupplierOrderLineInput[]): number | null {
  let total = 0;
  let priced = false;
  for (const line of lines) {
    if (line.unitPriceMinor === null) continue;
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) continue;
    if (!Number.isInteger(line.unitPriceMinor) || line.unitPriceMinor < 0) continue;
    total += Math.round(line.quantity * line.unitPriceMinor);
    priced = true;
  }
  return priced ? total : null;
}
