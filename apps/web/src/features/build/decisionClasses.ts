// Land decision classes: zones the builder paints on the parcel to record their own call on
// each part of the land — cultivated, conservation, regeneration, buildable pockets. This is
// a judgment layer, not measured data: no land-cover (NLCD) or soil (SSURGO) source is
// connected to Field Pro, so nothing here claims what is actually growing or what the soil
// is. Zones are rectangles in parcel feet (the same frame as the lot plan), drawn by the
// builder in the 2D plan and draped over the 3D scene. Pure helpers only.

import type { Rect } from './siteFeasibility';

export type DecisionClassId = 'cultivated' | 'conservation' | 'regeneration' | 'buildable_pocket';

export interface DecisionClass {
  id: DecisionClassId;
  label: string;
  /** Fill/stroke colour used in the 2D plan and the 3D scene. */
  color: string;
  /** What the class means, in plain words for the picker. */
  blurb: string;
}

export const DECISION_CLASSES: DecisionClass[] = [
  {
    id: 'cultivated',
    label: 'Cultivated',
    color: '#e8b93e',
    blurb: 'Ground in crops or pasture today, or kept in farm use.',
  },
  {
    id: 'conservation',
    label: 'Conservation',
    color: '#2e8b6e',
    blurb: 'Ground left alone — creek banks, woods, wet ground, habitat.',
  },
  {
    id: 'regeneration',
    label: 'Regeneration',
    color: '#7fb069',
    blurb: 'Ground being restored — replanting, erosion repair, soil building.',
  },
  {
    id: 'buildable_pocket',
    label: 'Buildable pocket',
    color: '#8fc2ff',
    blurb: 'A pocket you judge fit to build on, ahead of the lot check.',
  },
];

export const decisionClass = (id: DecisionClassId): DecisionClass =>
  DECISION_CLASSES.find((c) => c.id === id) ?? DECISION_CLASSES[0]!;

/** One painted zone: a rectangle in parcel feet with the class the builder picked. */
export interface DecisionZone {
  id: string;
  classId: DecisionClassId;
  rect: Rect;
}

const SQFT_PER_ACRE = 43_560;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Normalize a drag rectangle (any corner order) into a parcel-bounded rect, or null when it
 * is too small to mean anything (under 10 ft on a side, or outside the parcel).
 */
export function normalizeZoneRect(
  a: { x: number; z: number },
  b: { x: number; z: number },
  parcel: { widthFt: number; depthFt: number },
): Rect | null {
  if (![a.x, a.z, b.x, b.z].every(Number.isFinite)) return null;
  const rect: Rect = {
    x0: clamp(Math.min(a.x, b.x), 0, parcel.widthFt),
    x1: clamp(Math.max(a.x, b.x), 0, parcel.widthFt),
    z0: clamp(Math.min(a.z, b.z), 0, parcel.depthFt),
    z1: clamp(Math.max(a.z, b.z), 0, parcel.depthFt),
  };
  if (rect.x1 - rect.x0 < 10 || rect.z1 - rect.z0 < 10) return null;
  return rect;
}

export const zoneAcres = (rect: Rect): number =>
  Math.max(0, (rect.x1 - rect.x0) * (rect.z1 - rect.z0)) / SQFT_PER_ACRE;

export interface DecisionClassShare {
  classId: DecisionClassId;
  label: string;
  color: string;
  zones: number;
  acres: number;
  /** Share of the whole parcel, percent. Zones may overlap, so shares can add past 100%. */
  sharePct: number;
}

/** Per-class acreage and share of the parcel, from the painted zones only. */
export function decisionShares(
  zones: readonly DecisionZone[],
  parcel: { widthFt: number; depthFt: number },
): DecisionClassShare[] {
  const parcelAcres = Math.max(0, (parcel.widthFt * parcel.depthFt) / SQFT_PER_ACRE);
  return DECISION_CLASSES.map((c) => {
    const mine = zones.filter((z) => z.classId === c.id);
    const acres = mine.reduce((s, z) => s + zoneAcres(z.rect), 0);
    return {
      classId: c.id,
      label: c.label,
      color: c.color,
      zones: mine.length,
      acres,
      sharePct: parcelAcres > 0 ? (acres / parcelAcres) * 100 : 0,
    };
  });
}

/** The honesty line shown wherever the layer appears. */
export const DECISION_LAYER_NOTE =
  'Contractor-drawn zones: your judgment painted on the parcel. No land-cover or soil data source is connected, so Field Pro does not claim what is actually growing or what the soil is — confirm with a site visit and the county soil survey before relying on a class.';
