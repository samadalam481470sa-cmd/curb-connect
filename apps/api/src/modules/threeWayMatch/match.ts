// Three-way match logic (blueprint gap 4): supplier invoice ↔ purchase order
// ↔ receipt. Pure logic, no I/O. All money is integer minor units; quantities
// are numbers (units vary by material).
//
// Inputs: the PO lines (ordered qty + unit price as entered on the order),
// receipts against those lines (qty actually received), and the invoice-side
// figures entered from the supplier's invoice (billed qty + billed unit price
// per line, tax, freight, vendor, cost code). Output: per-line checks and one
// overall status — matched / price_variance / quantity_variance / unmatched.
// 'matched' requires every verifiable check to pass; anything that cannot be
// verified (e.g. the PO line has no price) is 'unmatched', never assumed.

export interface PoLineForMatch {
  lineIndex: number;
  label: string;
  orderedQty: number;
  unitPriceMinor: number | null;
}

export interface ReceiptQtyForMatch {
  lineIndex: number;
  receivedQty: number;
}

export interface BilledLineForMatch {
  lineIndex: number;
  billedQty: number;
  billedUnitPriceMinor: number;
}

export interface MatchInput {
  poLines: readonly PoLineForMatch[];
  receipts: readonly ReceiptQtyForMatch[];
  billedLines: readonly BilledLineForMatch[];
  billedTaxMinor: number;
  billedFreightMinor: number;
  /** Amount on the AP invoice record (the total being approved for payment). */
  invoiceAmountMinor: number;
  poSupplierName: string;
  billedVendorName: string;
  apCostCode: string | null;
  billedCostCode: string | null;
}

export type MatchStatus = 'matched' | 'price_variance' | 'quantity_variance' | 'unmatched';

export interface MatchLineResult {
  lineIndex: number;
  label: string;
  orderedQty: number;
  receivedQty: number;
  billedQty: number;
  poUnitPriceMinor: number | null;
  billedUnitPriceMinor: number;
  quantityOk: boolean;
  priceOk: boolean | null; // null = cannot verify (PO price missing)
}

export interface MatchResult {
  status: MatchStatus;
  lines: MatchLineResult[];
  computedBilledTotalMinor: number;
  amountMatchesInvoice: boolean;
  vendorMatches: boolean;
  costCodeMatches: boolean;
  reasons: string[];
}

const normalizeName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function evaluateMatch(input: MatchInput): MatchResult {
  const reasons: string[] = [];
  const receivedByLine = new Map<number, number>();
  for (const r of input.receipts) {
    receivedByLine.set(r.lineIndex, (receivedByLine.get(r.lineIndex) ?? 0) + r.receivedQty);
  }
  const billedByLine = new Map(input.billedLines.map((b) => [b.lineIndex, b]));

  let hasQuantityVariance = false;
  let hasPriceVariance = false;
  let hasUnverifiable = false;

  const lines: MatchLineResult[] = input.poLines.map((po) => {
    const receivedQty = receivedByLine.get(po.lineIndex) ?? 0;
    const billed = billedByLine.get(po.lineIndex);
    const billedQty = billed?.billedQty ?? 0;
    const billedUnitPriceMinor = billed?.billedUnitPriceMinor ?? 0;
    const quantityOk = billedQty <= receivedQty;
    if (!quantityOk) hasQuantityVariance = true;
    let priceOk: boolean | null;
    if (po.unitPriceMinor === null) {
      priceOk = billedQty === 0 ? true : null;
      if (priceOk === null) hasUnverifiable = true;
    } else {
      priceOk = billedQty === 0 || billedUnitPriceMinor === po.unitPriceMinor;
      if (!priceOk) hasPriceVariance = true;
    }
    return {
      lineIndex: po.lineIndex,
      label: po.label,
      orderedQty: po.orderedQty,
      receivedQty,
      billedQty,
      poUnitPriceMinor: po.unitPriceMinor,
      billedUnitPriceMinor,
      quantityOk,
      priceOk,
    };
  });

  // Billed lines that reference PO lines which don't exist can't be verified.
  const poIndexes = new Set(input.poLines.map((l) => l.lineIndex));
  for (const b of input.billedLines) {
    if (!poIndexes.has(b.lineIndex)) {
      hasUnverifiable = true;
      reasons.push(`Billed line ${b.lineIndex} does not exist on the purchase order.`);
    }
  }

  const computedBilledTotalMinor =
    input.billedLines.reduce((s, b) => s + Math.round(b.billedQty * b.billedUnitPriceMinor), 0) +
    input.billedTaxMinor +
    input.billedFreightMinor;
  const amountMatchesInvoice = computedBilledTotalMinor === input.invoiceAmountMinor;
  if (!amountMatchesInvoice) {
    reasons.push(
      `Entered billed lines + tax + freight total ${computedBilledTotalMinor} but the AP invoice amount is ${input.invoiceAmountMinor} (minor units).`,
    );
  }

  const vendorMatches = normalizeName(input.poSupplierName) === normalizeName(input.billedVendorName);
  if (!vendorMatches) {
    reasons.push(`Invoice vendor "${input.billedVendorName}" does not match the PO supplier "${input.poSupplierName}".`);
  }

  const costCodeMatches =
    (input.apCostCode ?? '') === (input.billedCostCode ?? '') ||
    input.billedCostCode === null ||
    input.billedCostCode === '';
  if (!costCodeMatches) {
    reasons.push(`Invoice cost code "${input.billedCostCode}" does not match the AP cost code "${input.apCostCode}".`);
  }

  if (hasQuantityVariance) reasons.push('Billed quantity exceeds received quantity on at least one line.');
  if (hasPriceVariance) reasons.push('Billed unit price differs from the PO unit price on at least one line.');
  if (hasUnverifiable) reasons.push('At least one billed line cannot be verified against the PO (missing PO price or unknown line).');

  let status: MatchStatus;
  if (!vendorMatches || !costCodeMatches || hasUnverifiable) status = 'unmatched';
  else if (hasQuantityVariance) status = 'quantity_variance';
  else if (hasPriceVariance || !amountMatchesInvoice) status = 'price_variance';
  else status = 'matched';

  return { status, lines, computedBilledTotalMinor, amountMatchesInvoice, vendorMatches, costCodeMatches, reasons };
}

/** Duplicate-invoice detection: same vendor + invoice number + amount. */
export function findDuplicates<T extends { id: string; vendorName: string; invoiceNumber: string | null; amountMinor: number }>(
  invoices: readonly T[],
  candidate: { id: string; vendorName: string; invoiceNumber: string | null; amountMinor: number },
): T[] {
  if (!candidate.invoiceNumber) return [];
  const num = candidate.invoiceNumber.trim().toLowerCase();
  const vendor = normalizeName(candidate.vendorName);
  return invoices.filter(
    (i) =>
      i.id !== candidate.id &&
      i.invoiceNumber !== null &&
      i.invoiceNumber.trim().toLowerCase() === num &&
      normalizeName(i.vendorName) === vendor &&
      i.amountMinor === candidate.amountMinor,
  );
}
