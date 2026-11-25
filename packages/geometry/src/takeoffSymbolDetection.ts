import type { Point } from './polygon';

const maximumSuggestions = 50;
export type TakeoffSquareSuggestion = { point: Point; side: number };

export function findSquareTakeoffSymbols(contours: readonly (readonly Point[])[]) {
  const suggestions: TakeoffSquareSuggestion[] = [];
  for (const contour of contours) {
    if (suggestions.length >= maximumSuggestions) break;
    const square = squareMarker(contour);
    if (
      square &&
      !suggestions.some(
        ({ point }) => Math.hypot(point.x - square.point.x, point.y - square.point.y) < 2,
      )
    ) {
      suggestions.push(square);
    }
  }
  return suggestions;
}

function squareMarker(contour: readonly Point[]): TakeoffSquareSuggestion | null {
  if (contour.length !== 4) return null;
  const edges = contour.map((point, index) => {
    const next = contour[(index + 1) % contour.length]!;
    return { x: next.x - point.x, y: next.y - point.y };
  });
  const lengths = edges.map(({ x, y }) => Math.hypot(x, y));
  const smallest = Math.min(...lengths);
  const largest = Math.max(...lengths);
  if (!Number.isFinite(largest) || smallest < 4 || largest > 48 || largest / smallest > 1.12)
    return null;
  if (
    edges.some((edge, index) => {
      const next = edges[(index + 1) % edges.length]!;
      const dot = edge.x * next.x + edge.y * next.y;
      return Math.abs(dot) > 0.12 * lengths[index]! * lengths[(index + 1) % lengths.length]!;
    })
  )
    return null;
  const point = contour.reduce(
    (center, vertex) => ({
      x: center.x + vertex.x / 4,
      y: center.y + vertex.y / 4,
    }),
    { x: 0, y: 0 },
  );
  const side = lengths.reduce((sum, length) => sum + length, 0) / 4;
  return { point, side };
}
