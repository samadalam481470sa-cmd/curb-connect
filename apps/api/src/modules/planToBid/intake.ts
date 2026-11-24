// Plan-to-Bid intake: measurable quantities from the plan's drawn geometry.
//
// Only what the geometry reader actually measured becomes a number. The slab area comes from
// the measured footprint, wall framing from the measured wall lines, roof plan area from the
// footprint (slope is not measured, so it is labeled plan area, not roof area). Everything
// else stays null for the reviewer to fill in. The spec hint lets the web run the existing
// takeoff engine (computeTakeoff) against the measured house.
import type { PlanGeometryReading, PlanToBidDraftLine, PlanToBidSpecHint } from '@fieldline/contracts';

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Draft lines with measured quantities, in build-sequence order. */
export function quantitiesFromGeometry(reading: PlanGeometryReading | null): PlanToBidDraftLine[] {
  if (!reading?.footprint) return [];
  const { lengthFt, widthFt } = reading.footprint;
  const slabArea = r1(lengthFt * widthFt);
  const lines: PlanToBidDraftLine[] = [
    {
      trade: 'foundations',
      label: 'Slab on grade (measured footprint)',
      unit: 'SF',
      quantity: slabArea,
      source: 'geometry',
      evidence: `Measured footprint ${lengthFt} ft × ${widthFt} ft (confidence ${Math.round(reading.footprint.confidence * 100)}%).`,
      confidence: reading.footprint.confidence,
    },
    {
      trade: 'roofing',
      label: 'Roof plan area (footprint, slope not measured)',
      unit: 'SF',
      quantity: slabArea,
      source: 'geometry',
      evidence: 'Plan area from the measured footprint. Add the slope factor before pricing.',
      confidence: reading.footprint.confidence,
    },
  ];
  const wallLf = reading.walls.totalLf;
  if (wallLf > 0) {
    lines.push({
      trade: 'framing',
      label: 'Wall framing (measured wall lines)',
      unit: 'LF',
      quantity: r1(wallLf),
      source: 'geometry',
      evidence: `${reading.walls.count} wall lines measured, ${r1(wallLf)} LF total (confidence ${Math.round(reading.walls.confidence * 100)}%).`,
      confidence: reading.walls.confidence,
    });
  }
  if (reading.rooms.length > 0) {
    lines.push({
      trade: 'interior_finishes',
      label: `Interior finish allowance (${reading.rooms.length} labeled rooms)`,
      unit: 'ls',
      quantity: null,
      source: 'geometry',
      evidence: `${reading.rooms.length} rooms labeled on the plan. Enter the finish scope per room.`,
      confidence: 0.8,
    });
  }
  return lines;
}

/** House size the web feeds into the existing takeoff engine, or null when unmeasured. */
export function specHintFromGeometry(reading: PlanGeometryReading | null): PlanToBidSpecHint | null {
  if (!reading?.footprint) return null;
  const lengthFt = Math.min(120, Math.max(16, Math.round(reading.footprint.lengthFt)));
  const widthFt = Math.min(80, Math.max(16, Math.round(reading.footprint.widthFt)));
  const stories = reading.stories === 2 ? 2 : 1;
  return { lengthFt, widthFt, stories };
}
