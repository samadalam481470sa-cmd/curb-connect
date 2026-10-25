import { describe, expect, it } from "vitest";
import { curbCubicFeet, defaultConcretePricing, estimateConcrete, slabCubicFeet } from "./concrete";
import {
  defaultRoofingOptions,
  estimateRoof,
  hipValleyMultiplier,
  pitchDegrees,
  pitchMultiplier
} from "./roofing";

describe("roofing", () => {
  it("matches published pitch multipliers", () => {
    expect(pitchMultiplier(0)).toBe(1);
    expect(pitchMultiplier(4)).toBeCloseTo(1.0541, 4);
    expect(pitchMultiplier(6)).toBeCloseTo(1.118, 3);
    expect(pitchMultiplier(12)).toBeCloseTo(1.4142, 4);
    expect(pitchDegrees(12)).toBeCloseTo(45, 6);
    expect(hipValleyMultiplier(12)).toBeCloseTo(Math.sqrt(432 / 288), 6);
    expect(() => pitchMultiplier(-1)).toThrow(RangeError);
  });

  it("estimates a 2,000 sq ft 6/12 roof with 15% waste", () => {
    const estimate = estimateRoof(
      [{ planAreaSqFt: 2000, pitchRise: 6 }],
      { ridgeLf: 50, hipLf: 0, eaveLf: 100, rakeLf: 80 },
      defaultRoofingOptions
    );

    expect(estimate.surfaceAreaSqFt).toBeCloseTo(2236.07, 1);
    expect(estimate.squaresBeforeWaste).toBeCloseTo(22.36, 2);
    // 22.36 * 1.15 = 25.71, rounded up to the next 1/3 square = 25.667 -> 26.0
    expect(estimate.squaresWithWaste).toBeCloseTo(26, 6);
    expect(estimate.shingleBundles).toBe(78);
    expect(estimate.ridgeCapBundles).toBe(2);
    expect(estimate.underlaymentRolls).toBe(3);
    expect(estimate.starterBundles).toBe(2);
    expect(estimate.dripEdgePieces).toBe(18);
  });

  it("combines facets with different pitches", () => {
    const estimate = estimateRoof(
      [
        { planAreaSqFt: 1000, pitchRise: 4 },
        { planAreaSqFt: 500, pitchRise: 12 }
      ],
      { ridgeLf: 0, hipLf: 0, eaveLf: 0, rakeLf: 0 },
      { ...defaultRoofingOptions, wastePercent: 0 }
    );

    expect(estimate.planAreaSqFt).toBe(1500);
    expect(estimate.surfaceAreaSqFt).toBeCloseTo(1000 * 1.05409 + 500 * 1.41421, 1);
    expect(estimate.ridgeCapBundles).toBe(0);
    expect(estimate.starterBundles).toBe(0);
  });

  it("rejects an impossible waste percentage", () => {
    expect(() =>
      estimateRoof([], { ridgeLf: 0, hipLf: 0, eaveLf: 0, rakeLf: 0 }, { ...defaultRoofingOptions, wastePercent: 150 })
    ).toThrow(RangeError);
  });
});

describe("concrete", () => {
  it("computes curb and slab volumes", () => {
    // 100 LF of 6" x 18" curb = 100 * 0.75 = 75 cu ft
    expect(curbCubicFeet({ linearFeet: 100, crossSectionSqIn: 108 })).toBeCloseTo(75, 10);
    // 10' x 10' slab at 4" = 33.33 cu ft
    expect(slabCubicFeet({ areaSqFt: 100, thicknessIn: 4 })).toBeCloseTo(33.333, 3);
    expect(() => slabCubicFeet({ areaSqFt: -1, thicknessIn: 4 })).toThrow(RangeError);
  });

  it("prices a curb run with sidewalk and saw-cutting in whole cents", () => {
    const estimate = estimateConcrete(
      [{ linearFeet: 270, crossSectionSqIn: 108 }],
      [{ areaSqFt: 405, thicknessIn: 4 }],
      60,
      defaultConcretePricing
    );

    // 270 * 0.75 = 202.5 cu ft + 135 cu ft = 337.5 cu ft = 12.5 cy net
    expect(estimate.netCubicYards).toBeCloseTo(12.5, 10);
    // 12.5 * 1.10 = 13.75 cy, already on a 1/4 yard increment
    expect(estimate.orderCubicYards).toBeCloseTo(13.75, 10);
    expect(estimate.concreteCents).toBe(226_875);
    expect(estimate.sawCutCents).toBe(27_000);
    expect(estimate.laborCents).toBe(270 * 1800 + 405 * 450);
    expect(estimate.totalCents).toBe(estimate.concreteCents + estimate.sawCutCents + estimate.laborCents);
    expect(Number.isInteger(estimate.totalCents)).toBe(true);
  });

  it("orders nothing when nothing is measured", () => {
    const estimate = estimateConcrete([], [], 0);
    expect(estimate.orderCubicYards).toBe(0);
    expect(estimate.totalCents).toBe(0);
  });
});
