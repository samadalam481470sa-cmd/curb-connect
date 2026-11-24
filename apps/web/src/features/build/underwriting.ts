// Financial underwriting for a land deal: itemized costs (land, sitework, vertical
// build, selling, HOA, financing) into profit, return on cost, equity multiple and an
// annualized return. Every output is an estimate from the builder's own inputs — no
// comps, no prices invented here. Blank or zero inputs yield nulls for the ratios that
// need them, never Infinity or a made-up percent.

export interface UnderwritingInputs {
  land: number;
  sitework: number;
  verticalBuild: number;
  selling: number;
  /** HOA dues per lot per month, as entered by the builder (0 when none). */
  hoaMonthlyPerLot: number;
  lotCount: number;
  /** Months the HOA dues are carried (approval + site work + build + sell-through). */
  carryMonths: number;
  /** Interest carry on cash out. */
  financing: number;
  revenue: number;
  /** Deepest cash-out point from the monthly cash flow (peak equity needed). */
  peakEquity: number;
  /** Whole deal length in months, for the annualized return. */
  durationMonths: number;
}

export interface UnderwritingItem {
  id: 'land' | 'sitework' | 'verticalBuild' | 'selling' | 'hoa' | 'financing';
  label: string;
  total: number;
}

export interface UnderwritingResult {
  items: UnderwritingItem[];
  hoaTotal: number;
  totalCost: number;
  profit: number;
  /** Profit as a percent of all-in cost; null when there is no cost yet. */
  returnOnCostPct: number | null;
  /** (Peak equity + profit) / peak equity; null when no equity is needed yet. */
  equityMultiple: number | null;
  /** Annualized return implied by the equity multiple over the deal length; null when it cannot be computed. */
  annualizedReturnPct: number | null;
  peakCash: number;
  /** False until a sale price (revenue) has been entered. */
  complete: boolean;
}

const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function underwrite(u: UnderwritingInputs): UnderwritingResult {
  const land = nonNeg(u.land);
  const sitework = nonNeg(u.sitework);
  const verticalBuild = nonNeg(u.verticalBuild);
  const selling = nonNeg(u.selling);
  const financing = nonNeg(u.financing);
  const revenue = nonNeg(u.revenue);
  const peakEquity = nonNeg(u.peakEquity);
  const hoaTotal =
    nonNeg(u.hoaMonthlyPerLot) * Math.max(0, Math.floor(u.lotCount)) * nonNeg(u.carryMonths);
  const totalCost = land + sitework + verticalBuild + selling + hoaTotal + financing;
  const profit = revenue - totalCost;
  const returnOnCostPct = totalCost > 0 ? (profit / totalCost) * 100 : null;
  const equityMultiple = peakEquity > 0 ? (peakEquity + profit) / peakEquity : null;
  const durationMonths = nonNeg(u.durationMonths);
  const annualizedReturnPct =
    equityMultiple !== null && equityMultiple > 0 && durationMonths > 0
      ? (Math.pow(equityMultiple, 12 / durationMonths) - 1) * 100
      : null;
  return {
    items: [
      { id: 'land', label: 'Land purchase', total: land },
      { id: 'sitework', label: 'Sitework (roads, utilities, earthwork, fees)', total: sitework },
      { id: 'verticalBuild', label: 'Vertical build (homes)', total: verticalBuild },
      { id: 'selling', label: 'Selling costs', total: selling },
      { id: 'hoa', label: 'HOA dues carried', total: hoaTotal },
      { id: 'financing', label: 'Financing (interest carry)', total: financing },
    ],
    hoaTotal,
    totalCost,
    profit,
    returnOnCostPct,
    equityMultiple,
    annualizedReturnPct,
    peakCash: peakEquity,
    complete: revenue > 0 && totalCost > 0,
  };
}
