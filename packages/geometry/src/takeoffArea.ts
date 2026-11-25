import { at, cyclic, neumaierSum } from './numeric';
import {
  area,
  perimeter,
  pointInPolygon,
  segmentsIntersect,
  validatePolygon,
  type Point,
} from './polygon';

function ringsTouch(a: readonly Point[], b: readonly Point[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      if (segmentsIntersect(at(a, i), cyclic(a, i + 1), at(b, j), cyclic(b, j + 1))) return true;
    }
  }
  return false;
}

export function computeTakeoffArea(
  exterior: readonly Point[],
  holes: readonly (readonly Point[])[],
  scale: number,
  sheet: { widthPoints: number; heightPoints: number },
) {
  for (const ring of [exterior, ...holes]) {
    if (
      ring.some(({ x, y }) => x < 0 || y < 0 || x > sheet.widthPoints || y > sheet.heightPoints)
    ) {
      throw new RangeError('Place every area boundary inside the sheet.');
    }
    const [issue] = validatePolygon(ring);
    if (issue) throw new RangeError('Use a simple, closed shape. ' + issue.message + '.');
  }
  for (let i = 0; i < holes.length; i += 1) {
    const hole = at(holes, i);
    if (hole.some((point) => pointInPolygon(point, exterior) !== 1) || ringsTouch(exterior, hole)) {
      throw new RangeError('Keep every deduction strictly inside the exterior boundary.');
    }
    for (let j = 0; j < i; j += 1) {
      const prior = at(holes, j);
      if (
        ringsTouch(prior, hole) ||
        pointInPolygon(at(hole, 0), prior) >= 0 ||
        pointInPolygon(at(prior, 0), hole) >= 0
      ) {
        throw new RangeError('Keep deduction boundaries separate.');
      }
    }
  }
  const exteriorArea = area(exterior) * scale * scale;
  const deductedArea = neumaierSum(holes.map(area)) * scale * scale;
  const netArea = exteriorArea - deductedArea;
  const exteriorPerimeter = perimeter(exterior) * scale;
  const deductionPerimeter = neumaierSum(holes.map(perimeter)) * scale;
  if (
    scale <= 0 ||
    netArea <= 0 ||
    ![netArea, exteriorArea, deductedArea, exteriorPerimeter, deductionPerimeter].every(
      Number.isFinite,
    )
  ) {
    throw new RangeError('The calibrated area is out of range.');
  }
  return { exteriorArea, deductedArea, netArea, exteriorPerimeter, deductionPerimeter };
}
