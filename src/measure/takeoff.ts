import {
  curbProfiles,
  defaultConcretePricing,
  estimateConcrete,
  type ConcreteEstimate,
  type ConcretePricing,
  type CurbProfileId
} from "../estimate/concrete";
import {
  defaultRoofingOptions,
  estimateRoof,
  type RoofEdges,
  type RoofingEstimate,
  type RoofingOptions
} from "../estimate/roofing";
import { isSelfIntersecting, pathLengthMeters, perimeterMeters, polygonAreaSqMeters, type LatLng } from "./geometry";
import { metersToFeet, sqMetersToSqFeet } from "./units";

export type ShapeKind = "line" | "area";

export interface MeasuredShape {
  id: string;
  kind: ShapeKind;
  label: string;
  points: LatLng[];
  /** Roof pitch rise per 12 for area shapes in roofing mode. */
  pitchRise: number;
}

export interface ShapeMeasurement {
  lengthFt: number;
  areaSqFt: number;
  invalid: boolean;
}

export function measureShape(shape: Pick<MeasuredShape, "kind" | "points">): ShapeMeasurement {
  if (shape.kind === "line") {
    return { lengthFt: metersToFeet(pathLengthMeters(shape.points)), areaSqFt: 0, invalid: false };
  }
  return {
    lengthFt: metersToFeet(perimeterMeters(shape.points)),
    areaSqFt: sqMetersToSqFeet(polygonAreaSqMeters(shape.points)),
    invalid: isSelfIntersecting(shape.points)
  };
}

/** A shape is complete enough to count once a line has two points or an area has three. */
export function isShapeComplete(shape: Pick<MeasuredShape, "kind" | "points">): boolean {
  return shape.points.length >= (shape.kind === "line" ? 2 : 3);
}

export interface CurbTakeoffInput {
  shapes: MeasuredShape[];
  profileId: CurbProfileId | "custom";
  customCrossSectionSqIn: number;
  slabThicknessIn: number;
  sawCutLf: number;
  pricing: ConcretePricing;
}

export const defaultCurbTakeoff: Omit<CurbTakeoffInput, "shapes"> = {
  profileId: "6x18 curb + 24 gutter",
  customCrossSectionSqIn: 108,
  slabThicknessIn: 4,
  sawCutLf: 0,
  pricing: defaultConcretePricing
};

/** Lines become curb runs; areas become slabs (sidewalk, aprons, ramps). Self-intersecting areas are skipped. */
export function curbTakeoff(input: CurbTakeoffInput): ConcreteEstimate {
  const crossSectionSqIn =
    input.profileId === "custom" ? input.customCrossSectionSqIn : curbProfiles[input.profileId].crossSectionSqIn;
  const complete = input.shapes.filter(isShapeComplete);

  const curbRuns = complete
    .filter((shape) => shape.kind === "line")
    .map((shape) => ({ linearFeet: measureShape(shape).lengthFt, crossSectionSqIn }));
  const slabs = complete
    .filter((shape) => shape.kind === "area")
    .map((shape) => measureShape(shape))
    .filter((measurement) => !measurement.invalid)
    .map((measurement) => ({ areaSqFt: measurement.areaSqFt, thicknessIn: input.slabThicknessIn }));

  return estimateConcrete(curbRuns, slabs, input.sawCutLf, input.pricing);
}

export interface RoofTakeoffInput {
  shapes: MeasuredShape[];
  edges: RoofEdges;
  options: RoofingOptions;
}

export const defaultRoofTakeoff: Omit<RoofTakeoffInput, "shapes"> = {
  edges: { ridgeLf: 0, hipLf: 0, eaveLf: 0, rakeLf: 0 },
  options: defaultRoofingOptions
};

/** Each area is a roof facet at its own pitch. Lines are ignored; enter edge lengths directly. */
export function roofTakeoff(input: RoofTakeoffInput): RoofingEstimate {
  const facets = input.shapes
    .filter((shape) => shape.kind === "area" && isShapeComplete(shape))
    .map((shape) => ({ shape, measurement: measureShape(shape) }))
    .filter(({ measurement }) => !measurement.invalid)
    .map(({ shape, measurement }) => ({ planAreaSqFt: measurement.areaSqFt, pitchRise: shape.pitchRise }));

  return estimateRoof(facets, input.edges, input.options);
}
