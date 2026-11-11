// Manual roof takeoff for the Roof Measurements workspace. Slope factors come from the shared
// pricing engine so this matches the report pipeline exactly.
import { slopeFactor } from '@fieldline/pricing';

export interface FacetInput {
  id: string;
  name: string;
  lengthFt: number;
  /** Horizontal (plan) depth of the facet, eave to ridge. */
  runFt: number;
  pitch: number;
  /** Measured plan area (e.g. traced on imagery). When set, it replaces length × run. */
  planSqFtOverride?: number;
}

export interface FacetResult extends FacetInput {
  planSqFt: number;
  slopeFactor: number;
  slopedSqFt: number;
}

export interface RoofResult {
  facets: FacetResult[];
  planSqFt: number;
  slopedSqFt: number;
  squares: number;
  squaresWithWaste: number;
  bundles: number;
  underlaymentRolls: number;
  deckSheets: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function roofTakeoff(facets: readonly FacetInput[], wastePercent: number): RoofResult {
  const results = facets.map((f): FacetResult => {
    const length = Math.max(0, f.lengthFt || 0);
    const run = Math.max(0, f.runFt || 0);
    const pitch = Math.max(0, Math.min(24, f.pitch || 0));
    const factor = slopeFactor({ rise: pitch, run: 12 }).toNumber();
    const plan =
      f.planSqFtOverride !== undefined && Number.isFinite(f.planSqFtOverride)
        ? Math.max(0, f.planSqFtOverride)
        : length * run;
    return { ...f, planSqFt: r2(plan), slopeFactor: r2(factor), slopedSqFt: r2(plan * factor) };
  });
  const planSqFt = results.reduce((s, f) => s + f.planSqFt, 0);
  const slopedSqFt = results.reduce((s, f) => s + f.slopedSqFt, 0);
  const waste = 1 + Math.max(0, Math.min(40, wastePercent)) / 100;
  const squares = slopedSqFt / 100;
  const withWaste = squares * waste;
  return {
    facets: results,
    planSqFt: r2(planSqFt),
    slopedSqFt: r2(slopedSqFt),
    squares: r2(squares),
    squaresWithWaste: r2(withWaste),
    bundles: Math.ceil(withWaste * 3 - 1e-9),
    underlaymentRolls: Math.ceil(withWaste / 10 - 1e-9),
    deckSheets: Math.ceil((slopedSqFt * waste) / 32 - 1e-9),
  };
}
