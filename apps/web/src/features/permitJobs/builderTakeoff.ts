// Per-builder material takeoff for the Builder book. Reuses the House Builder takeoff engine
// (computeTakeoff) — no duplicate math. Inputs come only from permit text (stated sq ft / stories);
// everything else is an explicit, editable assumption shown next to the result. Permits that do
// not state square footage contribute nothing: "insufficient data", never an invented size.
import { LIMITS } from '../build/layout';
import { computeTakeoff, DEFAULT_SPEC, type BuildSpec } from '../build/takeoff';

export interface TakeoffAssumptions {
  bedrooms: number;
  bathrooms: number;
  garage: 'none' | 'one_car' | 'two_car';
  wallHeightFt: 8 | 9 | 10;
  roofPitch: number;
  wastePercent: number;
}

export const DEFAULT_TAKEOFF_ASSUMPTIONS: TakeoffAssumptions = {
  bedrooms: DEFAULT_SPEC.bedrooms,
  bathrooms: DEFAULT_SPEC.bathrooms,
  garage: DEFAULT_SPEC.garage,
  wallHeightFt: DEFAULT_SPEC.wallHeightFt,
  roofPitch: DEFAULT_SPEC.roofPitch,
  wastePercent: DEFAULT_SPEC.wastePercent,
};

/** Assumed footprint proportions when only total sq ft is known (length:width = 5:4). */
export const FOOTPRINT_RATIO = 5 / 4;

export function specFromPermitSqFt(
  sqFt: number,
  stories: 1 | 2 | null,
  a: TakeoffAssumptions,
): { spec: BuildSpec; notes: string[] } {
  const floors = stories ?? 1;
  const footprintArea = sqFt / floors;
  const widthFt = Math.sqrt(footprintArea / FOOTPRINT_RATIO);
  const lengthFt = widthFt * FOOTPRINT_RATIO;
  const spec: BuildSpec = {
    lengthFt: Math.min(LIMITS.maxLength, Math.max(LIMITS.minLength, Math.round(lengthFt))),
    widthFt: Math.min(LIMITS.maxWidth, Math.max(LIMITS.minWidth, Math.round(widthFt))),
    stories: floors,
    bedrooms: a.bedrooms,
    bathrooms: a.bathrooms,
    garage: a.garage,
    wallHeightFt: a.wallHeightFt,
    roofPitch: a.roofPitch,
    overhangFt: DEFAULT_SPEC.overhangFt,
    wastePercent: a.wastePercent,
    studSpacingIn: DEFAULT_SPEC.studSpacingIn,
  };
  const notes = [
    `Footprint ${spec.lengthFt}×${spec.widthFt} ft derived from ${sqFt.toLocaleString('en-US')} stated sq ft assuming a 5:4 rectangle${stories ? '' : ' and 1 story (permit did not state stories)'}.`,
    `Bedrooms (${a.bedrooms}), bathrooms (${a.bathrooms}), garage (${a.garage.replace('_', ' ')}), wall height (${a.wallHeightFt} ft), roof pitch (${a.roofPitch}/12) and waste (${a.wastePercent}%) are assumptions — edit them to match the plans.`,
  ];
  return { spec, notes };
}

export interface BuilderTakeoffLine {
  material: string;
  group: string;
  quantity: number;
  /** Example formula from the first permit that produced this line. */
  formula: string;
}

export interface BuilderTakeoff {
  permitsUsed: number;
  permitsSkipped: number;
  totalSqFt: number;
  totalRoofSquares: number;
  totalConcreteYd3: number;
  lines: BuilderTakeoffLine[];
  notes: string[];
}

export function aggregateBuilderTakeoff(
  permits: { sqFt: number | null; stories: 1 | 2 | null }[],
  a: TakeoffAssumptions,
): BuilderTakeoff {
  const byMaterial = new Map<string, BuilderTakeoffLine>();
  let permitsUsed = 0;
  let totalSqFt = 0;
  let totalRoofSquares = 0;
  let totalConcreteYd3 = 0;
  const notes = new Set<string>();
  for (const p of permits) {
    if (p.sqFt === null) continue;
    const { spec, notes: specNotes } = specFromPermitSqFt(p.sqFt, p.stories, a);
    specNotes.forEach((n) => notes.add(n));
    const takeoff = computeTakeoff(spec);
    permitsUsed += 1;
    totalSqFt += p.sqFt;
    totalRoofSquares += takeoff.summary.roofSquares;
    totalConcreteYd3 += takeoff.summary.concreteYd3;
    for (const line of takeoff.lines) {
      const key = line.material;
      const existing = byMaterial.get(key);
      if (existing) existing.quantity += line.quantity;
      else
        byMaterial.set(key, {
          material: line.material,
          group: line.group,
          quantity: line.quantity,
          formula: line.formula,
        });
    }
  }
  return {
    permitsUsed,
    permitsSkipped: permits.length - permitsUsed,
    totalSqFt,
    totalRoofSquares: Math.round(totalRoofSquares * 10) / 10,
    totalConcreteYd3: Math.round(totalConcreteYd3 * 10) / 10,
    lines: [...byMaterial.values()].sort((x, y) => x.group.localeCompare(y.group)),
    notes: [...notes],
  };
}
