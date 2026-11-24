// Plan-to-Bid review logic (pure): maps the existing takeoff engine's lines into trades,
// totals the review, and drives the build-sequence view. No prices are invented here — a line
// with no unit price stays null ("Price missing") and is excluded from every total.
import { PLAN_TO_BID_TRADES, type PlanToBidTrade } from '@fieldline/contracts';
import type { DetailedGroup } from '../build/detailedCatalog';
import { PRICE_BOOK } from '../build/prices';
import type { PricedLine } from '../build/takeoff';

export { PLAN_TO_BID_TRADES };

/** Existing takeoff groups (House Builder) -> Plan-to-Bid trades. */
export function tradeForDetailedGroup(group: DetailedGroup): PlanToBidTrade {
  switch (group) {
    case 'Sitework':
      return 'sitework';
    case 'Foundation':
      return 'foundations';
    case 'Framing':
      return 'framing';
    case 'Roof':
      return 'roofing';
    case 'Envelope':
      return 'envelope';
    case 'Interior':
    case 'Finishes':
    case 'Hardware':
      return 'interior_finishes';
    case 'Openings':
      return 'envelope';
    case 'Electrical':
      return 'electrical';
    case 'Plumbing':
      return 'plumbing';
    case 'HVAC':
      return 'hvac';
    case 'Exterior':
      return 'exterior_finishes';
  }
}

export interface BidReviewLine {
  id: string;
  trade: PlanToBidTrade;
  label: string;
  unit: string;
  quantity: number | null;
  unitPrice: number | null;
  /** Where the price came from, e.g. "Dated price book" or a live listing seller. */
  priceSource: string | null;
  priceCheckedAt: string | null;
  /** 'takeoff' = from the existing takeoff engine; 'plan_text' | 'geometry' | 'ai' = from the plan reader. */
  source: 'takeoff' | 'plan_text' | 'geometry' | 'ai' | 'manual';
  approved: boolean;
}

export interface TradeCost {
  trade: PlanToBidTrade;
  laborHours: number | null;
  laborRate: number | null;
  subcontractorAmount: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Turns priced takeoff lines into review lines, grouped by trade in build sequence. */
export function takeoffToBidLines(priced: readonly PricedLine[]): BidReviewLine[] {
  return priced.map((line) => {
    const book = PRICE_BOOK[line.material];
    return {
      id: line.key,
      trade: tradeForDetailedGroup(line.group),
      label: book?.label ?? line.material,
      unit: book?.unit ?? 'ea',
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      priceSource: line.basis === 'live' ? line.seller : line.basis === 'typical' ? 'Dated price book (typical)' : line.seller,
      priceCheckedAt: null,
      source: 'takeoff',
      approved: false,
    };
  });
}

export interface BidTotals {
  /** Sum of priced approved material lines only. */
  materialTotal: number | null;
  /** Priced approved material lines, even when other approved lines are unpriced. */
  pricedMaterialTotal: number;
  laborTotal: number;
  subcontractorTotal: number;
  /** Null when any approved line is unpriced — the total would be partial. */
  grandTotal: number | null;
  approvedCount: number;
  unpricedCount: number;
  totalCount: number;
}

export function computeBidTotals(lines: readonly BidReviewLine[], costs: readonly TradeCost[]): BidTotals {
  let material = 0;
  let unpriced = 0;
  let approved = 0;
  for (const line of lines) {
    if (!line.approved) continue;
    approved += 1;
    if (line.quantity === null || line.unitPrice === null) {
      unpriced += 1;
      continue;
    }
    material += line.quantity * line.unitPrice;
  }
  let labor = 0;
  let subs = 0;
  for (const cost of costs) {
    if (cost.laborHours !== null && cost.laborRate !== null) labor += cost.laborHours * cost.laborRate;
    if (cost.subcontractorAmount !== null) subs += cost.subcontractorAmount;
  }
  const materialTotal = unpriced === 0 ? r2(material) : null;
  return {
    materialTotal,
    pricedMaterialTotal: r2(material),
    laborTotal: r2(labor),
    subcontractorTotal: r2(subs),
    grandTotal: unpriced === 0 ? r2(material + labor + subs) : null,
    approvedCount: approved,
    unpricedCount: unpriced,
    totalCount: lines.length,
  };
}

/** Per-trade review state for the build-sequence view. */
export interface TradeSequenceRow {
  trade: PlanToBidTrade;
  lines: number;
  approved: number;
  unpriced: number;
  total: number | null;
  status: 'empty' | 'in_review' | 'approved' | 'blocked';
}

export function buildSequence(lines: readonly BidReviewLine[]): TradeSequenceRow[] {
  return PLAN_TO_BID_TRADES.map((trade) => {
    const tradeLines = lines.filter((l) => l.trade === trade);
    const approved = tradeLines.filter((l) => l.approved);
    const unpriced = approved.filter((l) => l.quantity === null || l.unitPrice === null).length;
    const total = approved.reduce<number | null>((sum, l) => {
      if (l.quantity === null || l.unitPrice === null || sum === null) return sum;
      return r2(sum + l.quantity * l.unitPrice);
    }, 0);
    const status: TradeSequenceRow['status'] =
      tradeLines.length === 0
        ? 'empty'
        : unpriced > 0
          ? 'blocked'
          : approved.length === tradeLines.length
            ? 'approved'
            : 'in_review';
    return {
      trade,
      lines: tradeLines.length,
      approved: approved.length,
      unpriced,
      total: unpriced > 0 ? null : total,
      status,
    };
  });
}
