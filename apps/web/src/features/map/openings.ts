// Rectangular roof openings → cut length for curb estimate + corner rings for map display.
import length from '@turf/length';
import { lineString } from '@turf/helpers';
import type { LngLat } from './geometry/polygonArea';
import type { MapOpening, OpeningEquipment } from './types';

const M_PER_FT = 0.3048;
const DEG = Math.PI / 180;

/** Build an open rectangle ring around a center in local ENU feet. */
export function rectangleRingAround(
  center: LngLat,
  widthFt: number,
  lengthFt: number,
): LngLat[] {
  const [lng, lat] = center;
  const halfW = (widthFt * M_PER_FT) / 2;
  const halfL = (lengthFt * M_PER_FT) / 2;
  const dLat = halfL / 110540;
  const dLng = halfW / (111320 * Math.cos(lat * DEG));
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
  ];
}

/** Perimeter in feet of an opening (drawn ring or width×length). */
export function openingPerimeterFt(opening: MapOpening): number {
  if (opening.ring && opening.ring.length >= 3) {
    const closed = [...opening.ring, opening.ring[0]!];
    const m = length(lineString(closed.map(([a, b]) => [a, b])), { units: 'meters' });
    return m / M_PER_FT;
  }
  return 2 * (opening.widthFt + opening.lengthFt);
}

/** Sum of opening perimeters — used as cut length for curb takeoff. */
export function totalCutLengthFt(openings: readonly MapOpening[]): number {
  return openings.reduce((sum, o) => sum + openingPerimeterFt(o), 0);
}

export function newOpeningId(): string {
  return `opening-${crypto.randomUUID().slice(0, 8)}`;
}

export const EQUIPMENT_LABELS: Record<OpeningEquipment, string> = {
  hvac: 'HVAC curb',
  hatch: 'Roof hatch',
  skylight: 'Skylight',
  exhaust: 'Exhaust',
  other: 'Other',
};
