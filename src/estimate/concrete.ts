/**
 * Curb, sidewalk, and flatwork take-off math. All money is handled in whole
 * cents so totals never drift from float rounding.
 */

export const CUBIC_FEET_PER_CUBIC_YARD = 27;

export type ConcreteShape = "curb" | "slab";

/**
 * Simplified rectangular curb profiles (curb width x depth, plus gutter width x thickness).
 * Real profiles taper and batter, so confirm the area against the project's detail sheet
 * or enter a custom cross-section.
 */
export const curbProfiles = {
  "6x18 barrier curb": { label: '6" x 18" barrier curb', crossSectionSqIn: 6 * 18 },
  "6x18 curb + 24 gutter": { label: '6" x 18" curb + 24" x 7" gutter', crossSectionSqIn: 6 * 18 + 24 * 7 },
  "6x18 curb + 30 gutter": { label: '6" x 18" curb + 30" x 7" gutter', crossSectionSqIn: 6 * 18 + 30 * 7 },
  "4x12 header curb": { label: '4" x 12" header / ribbon curb', crossSectionSqIn: 4 * 12 }
} as const;

export type CurbProfileId = keyof typeof curbProfiles;

export interface CurbRunInput {
  linearFeet: number;
  crossSectionSqIn: number;
}

export interface SlabInput {
  areaSqFt: number;
  thicknessIn: number;
}

export interface ConcretePricing {
  wastePercent: number;
  /** Ready-mix price per cubic yard, in cents. */
  concreteCentsPerCy: number;
  /** Saw-cutting price per linear foot, in cents. */
  sawCutCentsPerLf: number;
  /** Labor and forming price per linear foot of curb, in cents. */
  curbLaborCentsPerLf: number;
  /** Labor and finishing price per square foot of slab, in cents. */
  slabLaborCentsPerSqFt: number;
  /** Ready-mix suppliers sell in fractions of a yard; order is rounded up to this increment. */
  orderIncrementCy: number;
}

export interface ConcreteEstimate {
  curbLinearFeet: number;
  slabAreaSqFt: number;
  sawCutLinearFeet: number;
  netCubicYards: number;
  orderCubicYards: number;
  concreteCents: number;
  sawCutCents: number;
  laborCents: number;
  totalCents: number;
}

export const defaultConcretePricing: ConcretePricing = {
  wastePercent: 10,
  concreteCentsPerCy: 16500,
  sawCutCentsPerLf: 450,
  curbLaborCentsPerLf: 1800,
  slabLaborCentsPerSqFt: 450,
  orderIncrementCy: 0.25
};

export function curbCubicFeet(run: CurbRunInput): number {
  assertNonNegative(run.linearFeet, "Linear feet");
  assertNonNegative(run.crossSectionSqIn, "Cross-section");
  return run.linearFeet * (run.crossSectionSqIn / 144);
}

export function slabCubicFeet(slab: SlabInput): number {
  assertNonNegative(slab.areaSqFt, "Area");
  assertNonNegative(slab.thicknessIn, "Thickness");
  return slab.areaSqFt * (slab.thicknessIn / 12);
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative number.`);
  }
}

export function estimateConcrete(
  curbRuns: CurbRunInput[],
  slabs: SlabInput[],
  sawCutLinearFeet: number,
  pricing: ConcretePricing = defaultConcretePricing
): ConcreteEstimate {
  assertNonNegative(sawCutLinearFeet, "Saw-cut length");
  if (pricing.wastePercent < 0 || pricing.wastePercent > 100) {
    throw new RangeError("Waste percent must be between 0 and 100.");
  }

  const curbLinearFeet = curbRuns.reduce((total, run) => total + run.linearFeet, 0);
  const slabAreaSqFt = slabs.reduce((total, slab) => total + slab.areaSqFt, 0);
  const cubicFeet =
    curbRuns.reduce((total, run) => total + curbCubicFeet(run), 0) +
    slabs.reduce((total, slab) => total + slabCubicFeet(slab), 0);
  const netCubicYards = cubicFeet / CUBIC_FEET_PER_CUBIC_YARD;
  const withWaste = netCubicYards * (1 + pricing.wastePercent / 100);
  const orderCubicYards =
    withWaste > 0 ? Math.ceil(withWaste / pricing.orderIncrementCy - 1e-9) * pricing.orderIncrementCy : 0;

  const concreteCents = Math.round(orderCubicYards * pricing.concreteCentsPerCy);
  const sawCutCents = Math.round(sawCutLinearFeet * pricing.sawCutCentsPerLf);
  const laborCents = Math.round(
    curbLinearFeet * pricing.curbLaborCentsPerLf + slabAreaSqFt * pricing.slabLaborCentsPerSqFt
  );

  return {
    curbLinearFeet,
    slabAreaSqFt,
    sawCutLinearFeet,
    netCubicYards,
    orderCubicYards,
    concreteCents,
    sawCutCents,
    laborCents,
    totalCents: concreteCents + sawCutCents + laborCents
  };
}
