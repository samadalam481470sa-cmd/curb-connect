import { polygonAreaSqFt, type Coordinate } from './estimate';

/** A drawing is a separate mowable zone or a non-mowable island (bed, patio, house). */
export type RegionKind = 'grass' | 'exclude';
export interface LawnRegion {
  id: string;
  kind: RegionKind;
  name: string;
  points: Coordinate[];
}
export interface LawnAreaMeasurement {
  valid: boolean;
  grossSqFt: number;
  excludedSqFt: number;
  netSqFt: number | null;
  grassPerimeterFt: number;
  issues: string[];
  lawnZones: number;
  exclusions: number;
}

const R = 6371008.8;
const RAD = Math.PI / 180;
const FT_PER_M = 3.280839895;
const MAX_REGIONS = 24;
const MAX_POINTS = 150;

/** Great-circle edge length; short-property measurements are approximate, not surveyed. */
export function segmentLengthFeet(a: Coordinate, b: Coordinate): number {
  const phi = (b.lat - a.lat) * RAD / 2;
  const lambda = (b.lon - a.lon) * RAD / 2;
  const h = Math.sin(phi) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(lambda) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h)))) * FT_PER_M;
}
export function perimeterFeet(points: readonly Coordinate[]): number {
  if (points.length < 3) return 0;
  return points.reduce((s, p, i) => s + segmentLengthFeet(p, points[(i + 1) % points.length]!), 0);
}
/** Move an individual corner a specified ground distance without pixel-precision guessing. */
export function nudgeCoordinate(
  p: Coordinate, direction: 'north' | 'south' | 'east' | 'west', feet: number,
): Coordinate {
  const meters = feet / FT_PER_M;
  const latMetersPerDegree = RAD * R;
  const lat = p.lat + (direction === 'north' ? meters / latMetersPerDegree :
    direction === 'south' ? -meters / latMetersPerDegree : 0);
  const cosLat = Math.cos(p.lat * RAD);
  const lon = p.lon + (direction === 'east' && Math.abs(cosLat) > 1e-6
    ? meters / (latMetersPerDegree * cosLat) : direction === 'west' && Math.abs(cosLat) > 1e-6
      ? -meters / (latMetersPerDegree * cosLat) : 0);
  return { lat: Math.max(-90, Math.min(90, lat)), lon: Math.max(-180, Math.min(180, lon)) };
}

function orient(p: Coordinate, q: Coordinate, r: Coordinate): number {
  return (q.lon - p.lon) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lon - p.lon);
}
function onSegment(p: Coordinate, a: Coordinate, b: Coordinate): boolean {
  // In angular units; edge tolerance < 0.1 mm for midlatitudes. Boundary is not
  // treated as the interior of an exclusion.
  const eps = 1e-10;
  return Math.abs(orient(a, b, p)) < eps &&
    p.lon >= Math.min(a.lon, b.lon) - eps && p.lon <= Math.max(a.lon, b.lon) + eps &&
    p.lat >= Math.min(a.lat, b.lat) - eps && p.lat <= Math.max(a.lat, b.lat) + eps;
}
function strictlyInside(p: Coordinate, polygon: readonly Coordinate[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!, b = polygon[i]!;
    if (onSegment(p, a, b)) return false;
    if ((a.lat > p.lat) !== (b.lat > p.lat) &&
      p.lon < (b.lon - a.lon) * (p.lat - a.lat) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}
function properCross(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): boolean {
  const x = orient(a, b, c), y = orient(a, b, d);
  const z = orient(c, d, a), w = orient(c, d, b);
  return x * y < 0 && z * w < 0;
}
function edgesCross(a: readonly Coordinate[], b: readonly Coordinate[]): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (properCross(a[i]!, a[(i + 1) % a.length]!,
        b[j]!, b[(j + 1) % b.length]!)) return true;
    }
  }
  return false;
}
function overlaps(a: readonly Coordinate[], b: readonly Coordinate[]): boolean {
  return edgesCross(a, b) || a.some(p => strictlyInside(p, b)) ||
    b.some(p => strictlyInside(p, a));
}

export function validRegionPoints(regions: readonly LawnRegion[]): boolean {
  return regions.length <= MAX_REGIONS && regions.every(r =>
    typeof r.id === 'string' && r.id.length > 0 && r.id.length < 100 &&
    typeof r.name === 'string' && r.name.length <= 100 &&
    (r.kind === 'grass' || r.kind === 'exclude') && Array.isArray(r.points) &&
    r.points.length <= MAX_POINTS && r.points.every(p =>
      p && Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
      p.lat >= -90 && p.lat <= 90 && p.lon >= -180 && p.lon <= 180));
}

/** Incomplete drawings are ignored until a ring has three corners.
 * Invalid finished rings, overlapping regions and exclusions outside grass block pricing.
 */
export function measureLawnRegions(regions: readonly LawnRegion[]): LawnAreaMeasurement {
  const issues: string[] = [];
  const empty = {
    valid: false, grossSqFt: 0, excludedSqFt: 0, netSqFt: null,
    grassPerimeterFt: 0, issues, lawnZones: 0, exclusions: 0,
  };
  if (!validRegionPoints(regions)) return { ...empty, issues: ['Saved geometry is invalid or too large.'] };
  const finished = regions.filter(r => r.points.length >= 3);
  const grass = finished.filter(r => r.kind === 'grass');
  const excluded = finished.filter(r => r.kind === 'exclude');
  if (!grass.length) issues.push('Draw at least one grass zone with three or more corners.');
  for (const r of regions) {
    if (r.points.length > 0 && r.points.length < 3) {
      issues.push(`Finish ${r.name || r.kind}: add at least three corners.`);
    } else if (r.points.length >= 3 &&
      (polygonAreaSqFt(r.points) === null ||
        r.points.some((p, i) => segmentLengthFeet(p, r.points[(i + 1) % r.points.length]!) < 0.2))) {
      issues.push(`Invalid shape for ${r.name || r.kind}: remove crossing or duplicate corners.`);
    }
  }
  for (let i = 0; i < grass.length; i++) {
    for (let j = i + 1; j < grass.length; j++) {
      if (overlaps(grass[i]!.points, grass[j]!.points)) {
        issues.push(`${grass[i]!.name} overlaps ${grass[j]!.name}; avoid counting grass twice.`);
      }
    }
  }
  for (const hole of excluded) {
    const owners = grass.filter(g =>
      hole.points.every(p => strictlyInside(p, g.points)) &&
      !edgesCross(hole.points, g.points));
    if (owners.length !== 1) issues.push(
      `${hole.name}: exclusions must be completely inside exactly one grass zone.`);
  }
  for (let i = 0; i < excluded.length; i++) {
    for (let j = i + 1; j < excluded.length; j++) {
      if (overlaps(excluded[i]!.points, excluded[j]!.points)) {
        issues.push(`${excluded[i]!.name} overlaps ${excluded[j]!.name}; avoid double subtraction.`);
      }
    }
  }
  const gross = grass.reduce((n, p) => n + (polygonAreaSqFt(p.points) ?? 0), 0);
  const subtraction = excluded.reduce((n, p) => n + (polygonAreaSqFt(p.points) ?? 0), 0);
  const net = Math.max(0, gross - subtraction);
  if (gross > 0 && net <= 0) issues.push('Excluded area is greater than or equal to the grass.');
  return {
    valid: issues.length === 0,
    grossSqFt: gross, excludedSqFt: subtraction,
    netSqFt: issues.length ? null : net,
    grassPerimeterFt: Math.round(grass.reduce((n, p) => n + perimeterFeet(p.points), 0)),
    issues, lawnZones: grass.length, exclusions: excluded.length,
  };
}

/** Migrate the earlier single outline to the multi-zone private draft. */
export function migrateLegacyLawnPolygon(points: Coordinate[]): LawnRegion[] {
  return points.length ? [{ id: 'legacy-front-lawn', name: 'Main lawn', kind: 'grass', points }] : [];
}
