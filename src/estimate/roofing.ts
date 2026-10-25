/**
 * Roofing take-off math. Satellite footprints are horizontal (plan) area, so
 * each facet is scaled by its pitch multiplier to get true sloped surface area.
 */

export interface RoofFacet {
  /** Plan-view area traced on the map, in square feet. */
  planAreaSqFt: number;
  /** Rise in inches per 12 inches of run, e.g. 6 for a 6/12 roof. */
  pitchRise: number;
}

export interface RoofingOptions {
  wastePercent: number;
  /** Shingle bundles per square; 3 for most architectural shingles. */
  bundlesPerSquare: number;
  /** Linear feet covered by one bundle of ridge cap. Varies by product (typically 20–35). */
  ridgeCapLfPerBundle: number;
  /** Squares covered by one underlayment roll; ~10 for synthetic, 4 for #15 felt. */
  underlaymentSquaresPerRoll: number;
  /** Linear feet of starter strip per bundle. */
  starterLfPerBundle: number;
  /** Length of one drip-edge piece, in feet. */
  dripEdgePieceLengthFt: number;
}

export interface RoofEdges {
  ridgeLf: number;
  hipLf: number;
  eaveLf: number;
  rakeLf: number;
}

export interface RoofingEstimate {
  planAreaSqFt: number;
  surfaceAreaSqFt: number;
  squaresBeforeWaste: number;
  squaresWithWaste: number;
  shingleBundles: number;
  ridgeCapBundles: number;
  underlaymentRolls: number;
  starterBundles: number;
  dripEdgePieces: number;
}

export const defaultRoofingOptions: RoofingOptions = {
  wastePercent: 15,
  bundlesPerSquare: 3,
  ridgeCapLfPerBundle: 33,
  underlaymentSquaresPerRoll: 10,
  starterLfPerBundle: 105,
  dripEdgePieceLengthFt: 10
};

/** Common pitches shown in the picker. Any rise from 0 to 24 is accepted. */
export const commonPitches = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/** Ratio of sloped surface to plan area for a rise/12 pitch: √(rise² + 12²) / 12. */
export function pitchMultiplier(rise: number): number {
  if (!Number.isFinite(rise) || rise < 0) {
    throw new RangeError("Pitch rise must be a non-negative number.");
  }
  return Math.sqrt(rise * rise + 144) / 12;
}

/** Roof angle in degrees for a rise/12 pitch. */
export function pitchDegrees(rise: number): number {
  return (Math.atan2(rise, 12) * 180) / Math.PI;
}

/**
 * Ratio of true to plan length for a hip or valley between two equal-pitch slopes.
 * The hip covers 12√2 inches of plan run per `rise` inches of rise: √(rise² + 288) / √288.
 */
export function hipValleyMultiplier(rise: number): number {
  return Math.sqrt(rise * rise + 288) / Math.sqrt(288);
}

function roundUpTo(value: number, step: number): number {
  return Math.ceil(value / step - 1e-9) * step;
}

export function estimateRoof(
  facets: RoofFacet[],
  edges: RoofEdges,
  options: RoofingOptions = defaultRoofingOptions
): RoofingEstimate {
  if (options.wastePercent < 0 || options.wastePercent > 100) {
    throw new RangeError("Waste percent must be between 0 and 100.");
  }

  const planAreaSqFt = facets.reduce((total, facet) => total + facet.planAreaSqFt, 0);
  const surfaceAreaSqFt = facets.reduce(
    (total, facet) => total + facet.planAreaSqFt * pitchMultiplier(facet.pitchRise),
    0
  );
  const squaresBeforeWaste = surfaceAreaSqFt / 100;
  // Shingles are ordered in 1/3-square bundles, so round squares up to the nearest bundle.
  const squaresWithWaste = roundUpTo(
    squaresBeforeWaste * (1 + options.wastePercent / 100),
    1 / options.bundlesPerSquare
  );
  const cappedLf = edges.ridgeLf + edges.hipLf;

  return {
    planAreaSqFt,
    surfaceAreaSqFt,
    squaresBeforeWaste,
    squaresWithWaste,
    shingleBundles: Math.round(squaresWithWaste * options.bundlesPerSquare),
    ridgeCapBundles: cappedLf > 0 ? Math.ceil(cappedLf / options.ridgeCapLfPerBundle) : 0,
    underlaymentRolls: surfaceAreaSqFt > 0 ? Math.ceil(squaresWithWaste / options.underlaymentSquaresPerRoll) : 0,
    starterBundles:
      edges.eaveLf + edges.rakeLf > 0 ? Math.ceil((edges.eaveLf + edges.rakeLf) / options.starterLfPerBundle) : 0,
    dripEdgePieces:
      edges.eaveLf + edges.rakeLf > 0
        ? Math.ceil((edges.eaveLf + edges.rakeLf) / options.dripEdgePieceLengthFt)
        : 0
  };
}
