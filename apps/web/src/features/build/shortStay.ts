// Short-stay (nightly rental) scenario for a land deal: build the homes and rent them by the
// night instead of selling or holding them on monthly leases. Sits next to the three
// development exit plans in siteFeasibility.ts and the farm scenario in farmScenario.ts.
// Every rate here — nightly price, occupancy, operating costs — is contractor-entered: no
// source Field Pro is connected to publishes nightly rates or occupancy, so blank inputs
// yield nulls and a plain note, never an invented figure. Pure math, same conventions as
// underwriting.ts.

export interface ShortStayInputs {
  /** Homes rented by the night (from the feasibility run, editable by the builder). */
  units: number;
  /** Nightly rate per home, dollars, contractor-entered. */
  nightlyRate: number;
  /** Share of nights booked, percent (0–100), contractor-entered. */
  occupancyPct: number;
  /** Operating costs (cleaning, utilities, platform fees, management, taxes, insurance),
   *  as a percent of gross rental income. */
  expensePct: number;
  /** All-in cost to build (land + sitework + homes), for payback and cash-on-cash. */
  totalInvested: number;
  /** Cap rate for the income value, percent (the same input the hold plan uses). */
  capRatePct: number;
}

export interface ShortStayResult {
  /** Nights booked per home per year at the entered occupancy. */
  nightsPerYear: number;
  annualGross: number;
  annualCosts: number;
  annualNet: number;
  /** Total invested divided by annual net income; null when net income is not positive. */
  paybackYears: number | null;
  /** Annual net as a percent of total invested; null when nothing is invested. */
  cashOnCashPct: number | null;
  /** Income value at the cap rate; null when the cap rate is not positive. */
  valueAtCapRate: number | null;
  /** False until a nightly rate has been entered. */
  complete: boolean;
  note: string;
}

const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function shortStay(u: ShortStayInputs): ShortStayResult {
  const units = Math.max(0, Math.floor(nonNeg(u.units)));
  const nightlyRate = nonNeg(u.nightlyRate);
  const occupancyPct = Math.min(100, nonNeg(u.occupancyPct));
  const expensePct = Math.min(100, nonNeg(u.expensePct));
  const totalInvested = nonNeg(u.totalInvested);
  const capRatePct = nonNeg(u.capRatePct);

  const nightsPerYear = (365 * occupancyPct) / 100;
  const annualGross = units * nightlyRate * nightsPerYear;
  const annualCosts = (annualGross * expensePct) / 100;
  const annualNet = annualGross - annualCosts;
  const paybackYears = totalInvested > 0 && annualNet > 0 ? totalInvested / annualNet : null;
  const cashOnCashPct = totalInvested > 0 ? (annualNet / totalInvested) * 100 : null;
  const valueAtCapRate = capRatePct > 0 ? annualNet / (capRatePct / 100) : null;
  const complete = nightlyRate > 0 && units > 0;

  const note = !complete
    ? 'Enter a nightly rate to run the short-stay case. No source publishes nightly rates or occupancy, so Field Pro invents none.'
    : annualNet <= 0
      ? 'Operating costs meet or beat the rental income at these figures, so there is no payback from nightly rentals. Estimates from your figures.'
      : 'Estimates from your figures: nightly rate, occupancy and operating costs are what you entered, not published rates. Short-term rental rules vary by city — confirm the zoning allows nightly rentals.';

  return {
    nightsPerYear,
    annualGross,
    annualCosts,
    annualNet,
    paybackYears,
    cashOnCashPct,
    valueAtCapRate,
    complete,
    note,
  };
}
