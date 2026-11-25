// Agriculture (farm-only) scenario for a land deal: buy the land, farm it (or lease it to a
// farmer) for a hold period, then sell. This is the fourth scenario next to the three
// development exit plans in siteFeasibility.ts (sell pads / build-sell / build-hold) — it
// does not subdivide or build anything. Every farm figure (income per acre, costs per acre,
// appreciation) is contractor-entered: no crop yield, lease rate or land value is published
// by any source Field Pro is connected to, so blank inputs yield nulls and a plain note,
// never an invented number. Pure math, same conventions as underwriting.ts.

export interface FarmScenarioInputs {
  /** Purchase price of the land (the same land price the feasibility run uses). */
  landPrice: number;
  /** Parcel size in acres (from the parcel dimensions). */
  acres: number;
  /** Farm income — crop sales or a farm lease — dollars per acre per year, contractor-entered. */
  incomePerAcreYear: number;
  /** Farm operating costs (taxes, insurance, inputs, labor), dollars per acre per year. */
  costPerAcreYear: number;
  /** Years the land is farmed before it is sold. */
  holdYears: number;
  /** Land appreciation, percent per year, contractor-entered (may be negative). */
  appreciationPctPerYear: number;
  /** Selling costs at exit, percent of the exit value. */
  sellingCostPct: number;
}

export interface FarmValuationPoint {
  /** Whole years after purchase (0 = purchase day). */
  year: number;
  /** Land value at the entered appreciation rate. */
  value: number;
  /** Net farm income collected up to and including this year. */
  cumulativeNetIncome: number;
}

export interface FarmScenarioResult {
  annualGrossIncome: number;
  annualCosts: number;
  annualNetIncome: number;
  /** Land price divided by annual net income; null when net income is not positive. */
  paybackYears: number | null;
  /** Value at each year 0..holdYears. Empty when there is no land price to grow. */
  valuation: FarmValuationPoint[];
  /** Land value at the end of the hold. */
  exitValue: number;
  exitSellingCost: number;
  /** Net farm income summed over the hold period. */
  totalNetIncome: number;
  /** Exit proceeds after selling costs, plus farm income, minus the land price. */
  profit: number;
  /** Profit as a percent of the land price; null when there is no land price. */
  returnOnCostPct: number | null;
  /** False until a farm income figure has been entered. */
  complete: boolean;
  note: string;
}

const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
const MAX_HOLD_YEARS = 60;

export function farmScenario(u: FarmScenarioInputs): FarmScenarioResult {
  const landPrice = nonNeg(u.landPrice);
  const acres = nonNeg(u.acres);
  const incomePerAcreYear = nonNeg(u.incomePerAcreYear);
  const costPerAcreYear = nonNeg(u.costPerAcreYear);
  const holdYears = Math.min(
    MAX_HOLD_YEARS,
    Math.max(0, Math.floor(Number.isFinite(u.holdYears) ? u.holdYears : 0)),
  );
  // Appreciation may be negative (land can lose value) but never below -100%/yr.
  const appreciationPct = Number.isFinite(u.appreciationPctPerYear)
    ? Math.max(-99, u.appreciationPctPerYear)
    : 0;
  const sellingCostPct = Math.min(100, nonNeg(u.sellingCostPct));

  const annualGrossIncome = incomePerAcreYear * acres;
  const annualCosts = costPerAcreYear * acres;
  const annualNetIncome = annualGrossIncome - annualCosts;
  const paybackYears =
    landPrice > 0 && annualNetIncome > 0 ? landPrice / annualNetIncome : null;

  const valuation: FarmValuationPoint[] = [];
  if (landPrice > 0) {
    for (let year = 0; year <= holdYears; year++) {
      valuation.push({
        year,
        value: landPrice * Math.pow(1 + appreciationPct / 100, year),
        cumulativeNetIncome: annualNetIncome * year,
      });
    }
  }
  const exitValue = valuation.length ? valuation[valuation.length - 1]!.value : 0;
  const exitSellingCost = (exitValue * sellingCostPct) / 100;
  const totalNetIncome = annualNetIncome * holdYears;
  const profit = exitValue - exitSellingCost + totalNetIncome - landPrice;
  const returnOnCostPct = landPrice > 0 ? (profit / landPrice) * 100 : null;
  const complete = incomePerAcreYear > 0;

  const note = !complete
    ? 'Enter your farm income per acre (crop sales or a lease rate) to run the farm scenario. No source publishes yields or lease rates, so Field Pro invents none.'
    : annualNetIncome <= 0
      ? 'Farm costs meet or beat farm income at these figures, so there is no payback from farming — the exit sale carries the deal. Estimates from your figures.'
      : 'Estimates from your figures: farm income, costs and appreciation are what you entered, not published rates.';

  return {
    annualGrossIncome,
    annualCosts,
    annualNetIncome,
    paybackYears,
    valuation,
    exitValue,
    exitSellingCost,
    totalNetIncome,
    profit,
    returnOnCostPct,
    complete,
    note,
  };
}
