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
  /**
   * Cumulative cash balance by month (month 0 first), when the caller has a monthly
   * cash flow. Used only for the payback figure; omit for no payback.
   */
  cumulativeByMonth?: readonly number[];
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
  /** Revenue at which profit is exactly zero (the all-in cost). */
  breakEvenRevenue: number;
  /** Break-even revenue spread over the lots; null when there are no lots. */
  breakEvenPerLot: number | null;
  /**
   * Years until the cumulative cash balance first returns to zero or above, from the
   * monthly cash flow when one was supplied. Null when no series was given, or when
   * the balance never gets back to zero inside it — never a made-up year.
   */
  paybackYears: number | null;
  /** False until a sale price (revenue) has been entered. */
  complete: boolean;
}

const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/**
 * First month the cumulative cash balance is back at or above zero, in years.
 * Month 0 (the land purchase) is never a payback month. Null when the series is
 * missing, never dips below zero (nothing to pay back), or never recovers.
 */
export function paybackYearsFromCumulative(cumulativeByMonth: readonly number[] | undefined): number | null {
  if (!cumulativeByMonth || cumulativeByMonth.length < 2) return null;
  let wasNegative = false;
  for (let m = 1; m < cumulativeByMonth.length; m++) {
    const v = cumulativeByMonth[m]!;
    if (!Number.isFinite(v)) continue;
    if (v < 0) wasNegative = true;
    else if (wasNegative) return m / 12;
  }
  return null;
}

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
    breakEvenRevenue: totalCost,
    breakEvenPerLot: Math.max(0, Math.floor(u.lotCount)) > 0 ? totalCost / Math.floor(u.lotCount) : null,
    paybackYears: paybackYearsFromCumulative(u.cumulativeByMonth),
    complete: revenue > 0 && totalCost > 0,
  };
}
