export interface LatLng {
  lat: number;
  lng: number;
}

interface PlanePoint {
  x: number;
  y: number;
}

// WGS84 semi-major axis and flattening, used for the local tangent-plane projection.
const EARTH_RADIUS_EQUATOR_M = 6378137;
const FLATTENING = 1 / 298.257223563;
const ECCENTRICITY_SQ = FLATTENING * (2 - FLATTENING);

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Projects points onto a flat plane (meters) centred on the reference point.
 * Uses the ellipsoid's meridional and prime-vertical radii at the reference
 * latitude, which keeps error well under 0.1% for site-scale shapes (a few km).
 */
function projectToPlane(points: LatLng[], reference: LatLng): PlanePoint[] {
  const latRad = toRadians(reference.lat);
  const sinLat = Math.sin(latRad);
  const denominator = 1 - ECCENTRICITY_SQ * sinLat * sinLat;
  const meridionalRadius = (EARTH_RADIUS_EQUATOR_M * (1 - ECCENTRICITY_SQ)) / Math.pow(denominator, 1.5);
  const primeVerticalRadius = EARTH_RADIUS_EQUATOR_M / Math.sqrt(denominator);
  const metersPerRadLng = primeVerticalRadius * Math.cos(latRad);

  return points.map((point) => ({
    x: toRadians(point.lng - reference.lng) * metersPerRadLng,
    y: toRadians(point.lat - reference.lat) * meridionalRadius
  }));
}

function centroid(points: LatLng[]): LatLng {
  const sum = points.reduce((acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / points.length, lng: sum.lng / points.length };
}

/** Great-circle distance in meters (haversine on the mean Earth radius). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const meanRadius = 6371008.8;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * meanRadius * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of an open path, in meters. */
export function pathLengthMeters(points: LatLng[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distanceMeters(points[index - 1], points[index]);
  }
  return total;
}

/** Perimeter of a closed ring, in meters. The ring does not need to repeat its first point. */
export function perimeterMeters(points: LatLng[]): number {
  if (points.length < 2) {
    return 0;
  }
  return pathLengthMeters(points) + (points.length > 2 ? distanceMeters(points[points.length - 1], points[0]) : 0);
}

/** Enclosed area of a simple polygon in square meters (shoelace on a local tangent plane). */
export function polygonAreaSqMeters(points: LatLng[]): number {
  if (points.length < 3) {
    return 0;
  }

  const plane = projectToPlane(points, centroid(points));
  let doubled = 0;
  for (let index = 0; index < plane.length; index += 1) {
    const current = plane[index];
    const next = plane[(index + 1) % plane.length];
    doubled += current.x * next.y - next.x * current.y;
  }
  return Math.abs(doubled) / 2;
}

/** Returns true when any two non-adjacent edges of the ring cross, which makes its area meaningless. */
export function isSelfIntersecting(points: LatLng[]): boolean {
  if (points.length < 4) {
    return false;
  }

  const plane = projectToPlane(points, centroid(points));
  const edgeCount = plane.length;

  function cross(o: PlanePoint, a: PlanePoint, b: PlanePoint): number {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }

  for (let i = 0; i < edgeCount; i += 1) {
    const a1 = plane[i];
    const a2 = plane[(i + 1) % edgeCount];
    for (let j = i + 1; j < edgeCount; j += 1) {
      const adjacent = j === i + 1 || (i === 0 && j === edgeCount - 1);
      if (adjacent) {
        continue;
      }
      const b1 = plane[j];
      const b2 = plane[(j + 1) % edgeCount];
      const d1 = cross(b1, b2, a1);
      const d2 = cross(b1, b2, a2);
      const d3 = cross(a1, a2, b1);
      const d4 = cross(a1, a2, b2);
      if (d1 * d2 < 0 && d3 * d4 < 0) {
        return true;
      }
    }
  }
  return false;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Picks the closest candidate within `tolerancePx` of the pointer, or null.
 * Works in screen pixels so snapping feels the same at every zoom level.
 */
export function findSnapTarget<T extends ScreenPoint>(pointer: ScreenPoint, candidates: T[], tolerancePx: number): T | null {
  let best: T | null = null;
  let bestDistance = tolerancePx;
  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.x - pointer.x, candidate.y - pointer.y);
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
