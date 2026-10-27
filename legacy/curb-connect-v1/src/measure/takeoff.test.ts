import { describe, expect, it } from "vitest";
import type { LatLng } from "./geometry";
import { curbTakeoff, defaultCurbTakeoff, defaultRoofTakeoff, measureShape, roofTakeoff, type MeasuredShape } from "./takeoff";

const origin: LatLng = { lat: 32.78, lng: -96.8 };
const phi = (origin.lat * Math.PI) / 180;
const metersPerDegLat = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
const metersPerDegLng = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);

function feet(eastFt: number, northFt: number): LatLng {
  const eastM = eastFt * 0.3048;
  const northM = northFt * 0.3048;
  return { lat: origin.lat + northM / metersPerDegLat, lng: origin.lng + eastM / metersPerDegLng };
}

function shape(kind: MeasuredShape["kind"], points: LatLng[], pitchRise = 6): MeasuredShape {
  return { id: `${kind}-${points.length}`, kind, label: kind, points, pitchRise };
}

describe("takeoff", () => {
  it("measures a 100 ft curb run and a 40 x 25 ft area", () => {
    expect(measureShape(shape("line", [feet(0, 0), feet(100, 0)])).lengthFt).toBeCloseTo(100, 0);
    const area = measureShape(shape("area", [feet(0, 0), feet(40, 0), feet(40, 25), feet(0, 25)]));
    expect(area.areaSqFt).toBeCloseTo(1000, -1);
    expect(area.lengthFt).toBeCloseTo(130, 0);
    expect(area.invalid).toBe(false);
  });

  it("turns lines into curb and areas into slabs", () => {
    const estimate = curbTakeoff({
      ...defaultCurbTakeoff,
      profileId: "6x18 barrier curb",
      shapes: [
        shape("line", [feet(0, 0), feet(100, 0)]),
        shape("area", [feet(0, 0), feet(50, 0), feet(50, 5), feet(0, 5)]),
        // Unfinished shapes are ignored.
        shape("line", [feet(0, 0)])
      ]
    });

    expect(estimate.curbLinearFeet).toBeCloseTo(100, 0);
    expect(estimate.slabAreaSqFt).toBeCloseTo(250, -1);
    // 100 LF * 0.75 sq ft + 250 sq ft * (4/12) = 158.33 cu ft = 5.86 cy
    expect(estimate.netCubicYards).toBeCloseTo(5.86, 1);
  });

  it("skips self-intersecting areas", () => {
    const bowTie = shape("area", [feet(0, 0), feet(10, 10), feet(10, 0), feet(0, 10)]);
    expect(curbTakeoff({ ...defaultCurbTakeoff, shapes: [bowTie] }).slabAreaSqFt).toBe(0);
  });

  it("treats each area as a roof facet at its own pitch", () => {
    const estimate = roofTakeoff({
      ...defaultRoofTakeoff,
      options: { ...defaultRoofTakeoff.options, wastePercent: 0 },
      shapes: [
        shape("area", [feet(0, 0), feet(40, 0), feet(40, 25), feet(0, 25)], 12),
        shape("line", [feet(0, 0), feet(40, 0)])
      ]
    });
    expect(estimate.planAreaSqFt).toBeCloseTo(1000, -1);
    expect(estimate.surfaceAreaSqFt).toBeCloseTo(1414, -1);
  });
});
