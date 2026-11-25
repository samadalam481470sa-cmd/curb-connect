import type { Point } from './polygon';

export type TakeoffSnapSegment = { from: Point; to: Point };
export type TakeoffSnapTarget = { point: Point; kind: 'endpoint' | 'line' };

export function snapToTakeoffSegments(
  point: Point,
  segments: readonly TakeoffSnapSegment[],
  tolerance: number,
  accepts: (candidate: Point) => boolean = () => true,
): TakeoffSnapTarget | null {
  if (!Number.isFinite(tolerance) || tolerance < 0) return null;
  const limit = tolerance * tolerance;
  let endpoint: Point | undefined;
  let line: Point | undefined;
  let endpointDistance = limit;
  let lineDistance = limit;
  for (const { from, to } of segments) {
    for (const candidate of [from, to]) {
      const distance = (candidate.x - point.x) ** 2 + (candidate.y - point.y) ** 2;
      if (distance <= limit && (!endpoint || distance < endpointDistance) && accepts(candidate)) {
        endpointDistance = distance;
        endpoint = candidate;
      }
    }
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const segmentLengthSquared = dx * dx + dy * dy;
    if (segmentLengthSquared === 0) continue;
    const fraction = ((point.x - from.x) * dx + (point.y - from.y) * dy) / segmentLengthSquared;
    if (fraction <= 0 || fraction >= 1) continue;
    const x = from.x + fraction * dx;
    const y = from.y + fraction * dy;
    const distance = (x - point.x) ** 2 + (y - point.y) ** 2;
    if (distance <= limit && (!line || distance < lineDistance) && accepts({ x, y })) {
      lineDistance = distance;
      line = { x, y };
    }
  }
  if (endpoint) return { kind: 'endpoint', point: endpoint };
  return line ? { kind: 'line', point: line } : null;
}
