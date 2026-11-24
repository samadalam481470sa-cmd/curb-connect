// Slope and grading analysis from the USGS 3DEP elevation grid already used by Land
// feasibility. Samples the parcel on a grid, buckets each sample into a slope band, and
// writes a plain-language grading note. High-level only: this is an estimate from
// LiDAR-derived elevations, not engineering — a civil engineer must confirm grading,
// drainage and retaining walls before anyone relies on it.

import { slopeAt, type Terrain } from './siteFeasibility';

export type SlopeBandId = 'gentle' | 'moderate' | 'steep' | 'over_limit';

export interface SlopeBand {
  id: SlopeBandId;
  label: string;
  /** Upper edge of the band, percent slope. */
  maxPct: number;
  samples: number;
  sharePct: number;
}

export interface SlopeGrading {
  bands: SlopeBand[];
  sampled: number;
  reliefFt: number;
  note: string;
}

const BANDS: { id: SlopeBandId; label: string; maxPct: (limit: number) => number }[] = [
  { id: 'gentle', label: 'Gentle — under 5%', maxPct: () => 5 },
  { id: 'moderate', label: 'Moderate — 5 to 15%', maxPct: () => 15 },
  { id: 'steep', label: 'Steep — 15% to building limit', maxPct: (limit) => limit },
  { id: 'over_limit', label: 'Over the building limit', maxPct: () => Number.POSITIVE_INFINITY },
];

function bandOf(slopePct: number, limit: number): SlopeBandId {
  if (slopePct < 5) return 'gentle';
  if (slopePct < 15) return 'moderate';
  if (slopePct <= limit) return 'steep';
  return 'over_limit';
}

/** Share of the parcel in each slope band, sampled across the terrain grid. */
export function slopeBands(
  terrain: Terrain,
  parcel: { widthFt: number; depthFt: number },
  maxBuildSlopePct: number,
): SlopeGrading {
  const limit = Number.isFinite(maxBuildSlopePct) && maxBuildSlopePct > 0 ? maxBuildSlopePct : 25;
  const flat = terrain.grid.flat();
  const reliefFt = flat.length ? Math.max(...flat) - Math.min(...flat) : 0;
  // Sample about every 20 ft, at least a 4x4 grid, so a big parcel stays cheap to scan.
  const step = Math.max(10, Math.min(parcel.widthFt, parcel.depthFt) / 16 || 20);
  const counts: Record<SlopeBandId, number> = { gentle: 0, moderate: 0, steep: 0, over_limit: 0 };
  let sampled = 0;
  for (let z = step / 2; z < parcel.depthFt; z += step) {
    for (let x = step / 2; x < parcel.widthFt; x += step) {
      counts[bandOf(slopeAt(terrain, parcel, x, z), limit)] += 1;
      sampled += 1;
    }
  }
  const bands: SlopeBand[] = BANDS.map((b) => ({
    id: b.id,
    label: b.label,
    maxPct: b.maxPct(limit),
    samples: counts[b.id],
    sharePct: sampled > 0 ? (counts[b.id] / sampled) * 100 : 0,
  }));
  return { bands, sampled, reliefFt, note: gradingNote(bands, limit) };
}

/** Plain-language grading note for a band breakdown. Always carries the estimate disclaimer. */
export function gradingNote(bands: SlopeBand[], maxBuildSlopePct: number): string {
  const share = (id: SlopeBandId) => bands.find((b) => b.id === id)?.sharePct ?? 0;
  const over = share('over_limit');
  const steep = share('steep');
  const gentle = share('gentle');
  const head =
    over > 0
      ? `${over.toFixed(0)}% of the parcel is over the ${maxBuildSlopePct}% building limit — those areas need stepped foundations or retaining walls, or stay as open space.`
      : steep > 0
        ? `${steep.toFixed(0)}% of the parcel is steep (15–${maxBuildSlopePct}%). Expect more grading and retaining there.`
        : gentle >= 80
          ? 'Mostly gentle ground — grading should be light.'
          : 'Mixed slopes — check the steepest lots in the table above before pricing grading.';
  return `${head} High-level estimate from USGS 3DEP LiDAR elevations against flat house pads — a civil engineer must confirm grading, drainage and retaining walls.`;
}
