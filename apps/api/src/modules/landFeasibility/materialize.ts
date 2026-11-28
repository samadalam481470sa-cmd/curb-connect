// Materialization planner for "Create community from feasibility project": turns a saved
// feasibility snapshot (plus the optional client-computed lot layout the web sends) into
// the phase/lot rows to create in Land Management. Pure and unit-tested. Nothing is
// invented: with a layout, lots and phases come from it verbatim; without one, lots are
// numbered 1..lotCount from the stored client-computed summary (no dimensions, no
// phases); with neither, only the community is created.
import type { FeasibilityLayout } from '@fieldline/contracts';

/** Same cap as the layout contract — beyond this the builder adds lots by hand. */
export const MAX_MATERIALIZED_LOTS = 2000;

export interface PlannedPhase {
  name: string;
  plannedLotCount: number;
}

export interface PlannedLot {
  lotNumber: string;
  phaseName: string | null;
  widthFt: number | null;
  depthFt: number | null;
}

export interface MaterializationPlan {
  phases: PlannedPhase[];
  lots: PlannedLot[];
  lotSource: 'layout' | 'summary_lot_count' | 'none';
  /** True when the stored lot count exceeded the cap and no lots were planned. */
  lotCountTooLarge: boolean;
}

export function planCommunityMaterialization(input: {
  layout?: FeasibilityLayout | null;
  lotCount: number;
}): MaterializationPlan {
  const layout = input.layout ?? null;
  if (layout && layout.lots.length > 0) {
    const phaseByLot = new Map<number, string>();
    const phases: PlannedPhase[] = [];
    for (const phase of layout.phases ?? []) {
      const uniqueNumbers = [...new Set(phase.lotNumbers)];
      phases.push({ name: phase.name, plannedLotCount: uniqueNumbers.length });
      for (const n of uniqueNumbers) {
        if (!phaseByLot.has(n)) phaseByLot.set(n, phase.name);
      }
    }
    const seen = new Set<number>();
    const lots: PlannedLot[] = [];
    for (const lot of [...layout.lots].sort((a, b) => a.number - b.number)) {
      if (seen.has(lot.number)) continue;
      seen.add(lot.number);
      lots.push({
        lotNumber: String(lot.number),
        phaseName: phaseByLot.get(lot.number) ?? null,
        widthFt: lot.widthFt ?? null,
        depthFt: lot.depthFt ?? null,
      });
    }
    return { phases, lots, lotSource: 'layout', lotCountTooLarge: false };
  }

  const lotCount = Math.max(0, Math.floor(input.lotCount));
  if (lotCount > MAX_MATERIALIZED_LOTS) {
    return { phases: [], lots: [], lotSource: 'none', lotCountTooLarge: true };
  }
  if (lotCount > 0) {
    const lots: PlannedLot[] = [];
    for (let n = 1; n <= lotCount; n += 1) {
      lots.push({ lotNumber: String(n), phaseName: null, widthFt: null, depthFt: null });
    }
    return { phases: [], lots, lotSource: 'summary_lot_count', lotCountTooLarge: false };
  }
  return { phases: [], lots: [], lotSource: 'none', lotCountTooLarge: false };
}
