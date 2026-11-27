// Commercial-pad parcel mode for a land deal: one commercial pad on the parcel —
// pad dimensions, a building footprint, parking, and open space — run through the
// same underwriting math as the residential plans. Every ratio (building
// coverage, parking spaces per 1,000 sq ft, open-space share) is
// CONTRACTOR-ENTERED from the code that applies to their parcel: Field Pro has
// no zoning or parking-code source and invents none. Every output is an
// estimate; blank inputs yield nulls and a plain note, never a made-up figure.
// Pure math, same conventions as underwriting.ts and farmScenario.ts.
import { underwrite, type UnderwritingResult } from './underwriting';

export interface CommercialPadInputs {
  /** Purchase price of the land (the same land price the feasibility run uses). */
  landPrice: number;
  /** Pad length in feet, contractor-entered (0 = not entered). */
  padLengthFt: number;
  /** Pad width in feet, contractor-entered (0 = not entered). */
  padWidthFt: number;
  /** Planned building size in square feet, contractor-entered. */
  buildingSqFt: number;
  /**
   * Maximum building coverage as a percent of the pad, contractor-entered from
   * the zoning that applies to the parcel. Field Pro does not look this up.
   */
  coveragePct: number;
  /**
   * Parking spaces per 1,000 sq ft of building, contractor-entered from the
   * parking code that applies to the parcel. Field Pro does not look this up.
   */
  parkingPer1000SqFt: number;
  /** Square feet per parking space including its share of drive aisle, contractor-entered. */
  sqFtPerSpace: number;
  /** Landscape / open-space share of the pad in percent, contractor-entered. */
  openSpacePct: number;
  /** Sitework cost per pad acre, contractor-entered. */
  siteworkPerPadAcre: number;
  /** Building cost per square foot, contractor-entered. */
  buildCostPerSqFt: number;
  /** Expected sale value (or capitalized value) of the finished pad, contractor-entered. */
  revenue: number;
  /** Selling costs, percent of revenue. */
  sellingCostPct: number;
  /** Interest carry on cash out, contractor-entered. */
  financing: number;
  /** Whole deal length in months, for the annualized return. */
  durationMonths: number;
}

export interface CommercialPadResult {
  /** Pad area in square feet; null until both dimensions are entered. */
  padSqFt: number | null;
  /** Pad area in acres; null until both dimensions are entered. */
  padAcres: number | null;
  /** Largest building the entered coverage allows; null when pad or coverage is missing. */
  maxBuildingSqFt: number | null;
  /** Whether the entered building fits the entered coverage; null when it cannot be checked. */
  coverageOk: boolean | null;
  /** Parking spaces the entered ratio calls for (rounded up); null when inputs are missing. */
  parkingSpaces: number | null;
  /** Parking area at the entered square feet per space; null when inputs are missing. */
  parkingSqFt: number | null;
  /** Open-space area at the entered share; null when pad or share is missing. */
  openSpaceSqFt: number | null;
  /** Building + parking + open space; null when any part is missing. */
  developedSqFt: number | null;
  /** Whether the developed area fits on the pad; null when it cannot be checked. */
  fitsOnPad: boolean | null;
  /** Square feet over the pad when it does not fit; 0 when it fits, null when unchecked. */
  overBySqFt: number | null;
  sitework: number;
  verticalBuild: number;
  selling: number;
  /** The shared underwriting run (peak equity = total cost; no monthly cash flow in pad mode). */
  underwriting: UnderwritingResult;
  /** False until pad dimensions and a building size have been entered. */
  complete: boolean;
  notes: string[];
}

const SQFT_PER_ACRE = 43_560;
const nonNeg = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function commercialPad(u: CommercialPadInputs): CommercialPadResult {
  const landPrice = nonNeg(u.landPrice);
  const padLengthFt = nonNeg(u.padLengthFt);
  const padWidthFt = nonNeg(u.padWidthFt);
  const buildingSqFt = nonNeg(u.buildingSqFt);
  const coveragePct = Math.min(100, nonNeg(u.coveragePct));
  const parkingPer1000SqFt = nonNeg(u.parkingPer1000SqFt);
  const sqFtPerSpace = nonNeg(u.sqFtPerSpace);
  const openSpacePct = Math.min(100, nonNeg(u.openSpacePct));
  const revenue = nonNeg(u.revenue);
  const durationMonths = nonNeg(u.durationMonths);

  const padSqFt = padLengthFt > 0 && padWidthFt > 0 ? padLengthFt * padWidthFt : null;
  const padAcres = padSqFt !== null ? padSqFt / SQFT_PER_ACRE : null;

  const maxBuildingSqFt =
    padSqFt !== null && coveragePct > 0 ? (padSqFt * coveragePct) / 100 : null;
  const coverageOk =
    maxBuildingSqFt !== null && buildingSqFt > 0 ? buildingSqFt <= maxBuildingSqFt : null;

  const parkingSpaces =
    buildingSqFt > 0 && parkingPer1000SqFt > 0
      ? Math.ceil((buildingSqFt / 1000) * parkingPer1000SqFt)
      : null;
  const parkingSqFt =
    parkingSpaces !== null && sqFtPerSpace > 0 ? parkingSpaces * sqFtPerSpace : null;
  const openSpaceSqFt =
    padSqFt !== null && openSpacePct > 0 ? (padSqFt * openSpacePct) / 100 : null;

  const developedSqFt =
    buildingSqFt > 0 && parkingSqFt !== null && openSpaceSqFt !== null
      ? buildingSqFt + parkingSqFt + openSpaceSqFt
      : null;
  const fitsOnPad =
    developedSqFt !== null && padSqFt !== null ? developedSqFt <= padSqFt : null;
  const overBySqFt =
    developedSqFt !== null && padSqFt !== null
      ? Math.max(0, developedSqFt - padSqFt)
      : null;

  const sitework = padAcres !== null ? nonNeg(u.siteworkPerPadAcre) * padAcres : 0;
  const verticalBuild = nonNeg(u.buildCostPerSqFt) * buildingSqFt;
  const selling = (revenue * Math.min(100, nonNeg(u.sellingCostPct))) / 100;

  const totalCost = landPrice + sitework + verticalBuild + selling + nonNeg(u.financing);
  const uw = underwrite({
    land: landPrice,
    sitework,
    verticalBuild,
    selling,
    hoaMonthlyPerLot: 0,
    lotCount: 1,
    carryMonths: durationMonths,
    financing: nonNeg(u.financing),
    revenue,
    // No monthly cash flow in pad mode: peak equity is taken as the full
    // all-in cost (all cash at peak). Labeled in the notes below.
    peakEquity: totalCost,
    durationMonths,
  });

  const complete = padSqFt !== null && buildingSqFt > 0;
  const notes: string[] = [
    'Coverage, parking and open-space ratios are the numbers you entered from the code that applies to your parcel — Field Pro has no zoning or parking-code source and checks none.',
    'Estimates from your figures. Peak equity is taken as the full all-in cost (pad mode has no monthly cash flow).',
  ];
  if (!complete) {
    notes.unshift('Enter the pad dimensions and building size to run the pad case.');
  }
  if (coverageOk === false && maxBuildingSqFt !== null) {
    notes.push(
      `The entered building (${Math.round(buildingSqFt).toLocaleString()} sq ft) is larger than the entered coverage allows on this pad (${Math.round(maxBuildingSqFt).toLocaleString()} sq ft).`,
    );
  }
  if (fitsOnPad === false && overBySqFt !== null) {
    notes.push(
      `Building + parking + open space runs ${Math.round(overBySqFt).toLocaleString()} sq ft over the pad at these figures.`,
    );
  }

  return {
    padSqFt,
    padAcres,
    maxBuildingSqFt,
    coverageOk,
    parkingSpaces,
    parkingSqFt,
    openSpaceSqFt,
    developedSqFt,
    fitsOnPad,
    overBySqFt,
    sitework,
    verticalBuild,
    selling,
    underwriting: uw,
    complete,
    notes,
  };
}
