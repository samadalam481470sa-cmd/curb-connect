import { describe, expect, it } from "vitest";
import {
  distanceMeters,
  findSnapTarget,
  isSelfIntersecting,
  pathLengthMeters,
  perimeterMeters,
  polygonAreaSqMeters,
  type LatLng
} from "./geometry";
import { formatArea, formatFeetInches, formatLength, metersToFeet, sqMetersToSqFeet } from "./units";

// Fixtures near Dallas (32.78° N) built with the standard WGS84 meters-per-degree series,
// independent of the projection used in geometry.ts.
const origin: LatLng = { lat: 32.78, lng: -96.8 };
const phi = (origin.lat * Math.PI) / 180;
const metersPerDegLat = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
const metersPerDegLng = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);

function offset(eastM: number, northM: number): LatLng {
  return { lat: origin.lat + northM / metersPerDegLat, lng: origin.lng + eastM / metersPerDegLng };
}

describe("geometry", () => {
  it("measures a known distance: one degree of latitude is ~111 km", () => {
    expect(distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -1);
  });

  it("sums path and perimeter lengths", () => {
    const square = [offset(0, 0), offset(100, 0), offset(100, 100), offset(0, 100)];
    expect(pathLengthMeters(square)).toBeCloseTo(300, -0.5);
    expect(perimeterMeters(square)).toBeCloseTo(400, -0.5);
    expect(perimeterMeters([offset(0, 0)])).toBe(0);
  });

  it("computes polygon area within 0.1% for a 100 m square", () => {
    const square = [offset(0, 0), offset(100, 0), offset(100, 100), offset(0, 100)];
    expect(Math.abs(polygonAreaSqMeters(square) - 10_000) / 10_000).toBeLessThan(0.001);
  });

  it("gives the same area regardless of winding direction", () => {
    const ring = [offset(0, 0), offset(40, 0), offset(40, 25), offset(0, 25)];
    expect(polygonAreaSqMeters(ring)).toBeCloseTo(polygonAreaSqMeters([...ring].reverse()), 6);
  });

  it("returns zero area for fewer than three points", () => {
    expect(polygonAreaSqMeters([offset(0, 0), offset(10, 0)])).toBe(0);
  });

  it("detects a bow-tie ring", () => {
    const bowTie = [offset(0, 0), offset(10, 10), offset(10, 0), offset(0, 10)];
    const square = [offset(0, 0), offset(10, 0), offset(10, 10), offset(0, 10)];
    expect(isSelfIntersecting(bowTie)).toBe(true);
    expect(isSelfIntersecting(square)).toBe(false);
  });

  it("snaps to the nearest candidate within tolerance", () => {
    const candidates = [
      { id: "a", x: 100, y: 100 },
      { id: "b", x: 108, y: 100 }
    ];
    expect(findSnapTarget({ x: 106, y: 100 }, candidates, 10)?.id).toBe("b");
    expect(findSnapTarget({ x: 200, y: 200 }, candidates, 10)).toBeNull();
  });
});

describe("units", () => {
  it("converts meters and square meters to feet", () => {
    expect(metersToFeet(0.3048)).toBeCloseTo(1, 10);
    expect(sqMetersToSqFeet(1)).toBeCloseTo(10.7639, 4);
  });

  it("formats feet and inches to the nearest eighth", () => {
    expect(formatFeetInches(12.375)).toBe(`12' 4-1/2"`);
    expect(formatFeetInches(10)).toBe(`10' 0"`);
    expect(formatFeetInches(0.0104)).toBe(`0' 0-1/8"`);
  });

  it("formats lengths and areas in each unit", () => {
    expect(formatLength(30.48, "ft")).toBe("100.0 ft");
    expect(formatLength(30.48, "yd")).toBe("33.33 yd");
    expect(formatLength(30.48, "m")).toBe("30.48 m");
    expect(formatArea(4046.8564224, "acre")).toBe("1.000 ac");
    expect(formatArea(4046.8564224, "sqft")).toBe("43,560 sq ft");
  });
});
