// Measure tools for the GIS Workbench: distance along clicked points and area of a clicked
// ring, measured on the WGS84 ellipsoid with @fieldline/geometry (GeographicLib — the same
// library QGIS uses for QgsDistanceArea). Pure functions; the map component feeds points in.

import { geodesicArea, geodesicDistance, geodesicPerimeter } from '@fieldline/geometry';

export interface MeasurePoint {
  lon: number;
  lat: number;
}

const M_PER_FT = 0.3048;
const SQFT_PER_SQM = 10.76391041671;
const SQFT_PER_ACRE = 43_560;

export interface DistanceMeasurement {
  metres: number;
  feet: number;
  /** Display text, e.g. "1,234 ft" or "2.3 mi". */
  label: string;
  segments: number;
}

/** Total geodesic distance along a polyline of clicked points. */
export function measureDistance(points: readonly MeasurePoint[]): DistanceMeasurement | null {
  if (points.length < 2) return null;
  let metres = 0;
  for (let i = 1; i < points.length; i++) {
    metres += geodesicDistance(points[i - 1]!, points[i]!);
  }
  const feet = metres / M_PER_FT;
  const label =
    feet >= 5280
      ? `${(feet / 5280).toFixed(2)} mi (${Math.round(feet).toLocaleString('en-US')} ft)`
      : `${Math.round(feet).toLocaleString('en-US')} ft`;
  return { metres, feet, label, segments: points.length - 1 };
}

export interface AreaMeasurement {
  squareMetres: number;
  squareFeet: number;
  acres: number;
  perimeterFeet: number;
  label: string;
}

/** Geodesic area + perimeter of a clicked ring (open ring in, closed internally). */
export function measureArea(points: readonly MeasurePoint[]): AreaMeasurement | null {
  if (points.length < 3) return null;
  const ring = points.map((p) => ({ lon: p.lon, lat: p.lat }));
  const squareMetres = geodesicArea(ring);
  const squareFeet = squareMetres * SQFT_PER_SQM;
  const acres = squareFeet / SQFT_PER_ACRE;
  const perimeterFeet = geodesicPerimeter(ring) / M_PER_FT;
  const label = `${Math.round(squareFeet).toLocaleString('en-US')} sq ft (${acres.toFixed(3)} ac) · perimeter ${Math.round(perimeterFeet).toLocaleString('en-US')} ft`;
  return { squareMetres, squareFeet, acres, perimeterFeet, label };
}
