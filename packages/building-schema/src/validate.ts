// Deterministic design checks run after schema parsing. These never certify a design: they only
// report geometry and consistency problems so a qualified reviewer can act on them.
import type { HomeDesign } from './schema';

export type DesignIssue = {
  severity: 'error' | 'warning';
  elementId?: string;
  code: string;
  message: string;
};

export function checkDesign(design: HomeDesign): DesignIssue[] {
  const issues: DesignIssue[] = [];
  const levelIndexes = new Set(design.levels.map((l) => l.index));
  const byId = new Map(design.elements.map((e) => [e.id, e]));

  const ids = new Set<string>();
  for (const el of design.elements) {
    if (ids.has(el.id)) {
      issues.push({ severity: 'error', elementId: el.id, code: 'duplicate-id', message: 'Duplicate element id.' });
    }
    ids.add(el.id);

    if (!levelIndexes.has(el.level)) {
      issues.push({
        severity: 'error',
        elementId: el.id,
        code: 'unknown-level',
        message: `Element references level ${el.level}, which does not exist.`,
      });
    }

    if (el.type === 'door' || el.type === 'window') {
      const host = el.hostId ? byId.get(el.hostId) : undefined;
      if (!host) {
        issues.push({ severity: 'error', elementId: el.id, code: 'missing-host', message: 'Opening host wall not found.' });
      } else if (host.type !== 'wall') {
        issues.push({ severity: 'error', elementId: el.id, code: 'bad-host', message: 'Opening must sit in a wall.' });
      } else if (el.widthM !== undefined) {
        const hostLength = segmentLength(host);
        if (el.widthM > hostLength) {
          issues.push({
            severity: 'error',
            elementId: el.id,
            code: 'opening-too-wide',
            message: `Opening (${el.widthM} m) is longer than its host wall (${hostLength.toFixed(2)} m).`,
          });
        }
      }
    }

    if (el.type === 'window' || el.type === 'door') {
      const level = design.levels.find((l) => l.index === el.level);
      if (level && el.heightM > level.heightM) {
        issues.push({
          severity: 'warning',
          elementId: el.id,
          code: 'opening-taller-than-level',
          message: 'Opening is taller than its level.',
        });
      }
    }
  }

  const modelledSqFt = modelledFloorAreaSqFt(design);
  if (modelledSqFt > 0) {
    const ratio = modelledSqFt / design.targetAreaSqFt;
    if (ratio < 0.9 || ratio > 1.1) {
      issues.push({
        severity: 'warning',
        code: 'area-mismatch',
        message: `Modelled floor area ${Math.round(modelledSqFt)} sq ft differs from target ${design.targetAreaSqFt} sq ft by more than 10%.`,
      });
    }
  }

  return issues;
}

/** Length of a wall's centreline segment in metres. */
export function segmentLength(el: { start: { x: number; y: number }; end: { x: number; y: number } }): number {
  return Math.hypot(el.end.x - el.start.x, el.end.y - el.start.y);
}

/** Sum of floor-element areas, converted to square feet. */
export function modelledFloorAreaSqFt(design: HomeDesign): number {
  const M2_TO_SQFT = 10.763910416709722;
  const areaM2 = design.elements
    .filter((e) => e.type === 'floor')
    .reduce((sum, e) => sum + segmentLength(e) * e.thicknessM, 0);
  return areaM2 * M2_TO_SQFT;
}
