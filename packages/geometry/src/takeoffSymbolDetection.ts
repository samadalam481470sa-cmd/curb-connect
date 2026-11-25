import { area, distance, validatePolygon, type Point } from './polygon';

const maximumSuggestions = 50;
export type TakeoffSquareSuggestion = { point: Point; side: number };
type SymbolContours = {
  contours: readonly (readonly Point[])[];
  curvedContours: readonly (readonly Point[])[];
};

export function findTakeoffSymbols(
  symbol: 'square' | 'triangle' | 'cross' | 'circle',
  { contours, curvedContours }: SymbolContours,
): Point[] {
  switch (symbol) {
    case 'square':
      return findSquareTakeoffSymbols(contours).map(({ point }) => point);
    case 'triangle':
      return findSymbols(contours, triangleMarker);
    case 'cross':
      return findSymbols(contours, crossMarker);
    case 'circle':
      return findSymbols(curvedContours, circleMarker);
  }
}

function findSymbols(
  contours: readonly (readonly Point[])[],
  detect: (contour: readonly Point[]) => Point | null,
) {
  const suggestions: Point[] = [];
  for (const contour of contours) {
    if (suggestions.length >= maximumSuggestions) break;
    const point = detect(contour);
    if (point && !suggestions.some((other) => distance(other, point) < 2)) suggestions.push(point);
  }
  return suggestions;
}

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
function triangleMarker(points: readonly Point[]) {
  if (points.length !== 3 || validatePolygon(points).length) return null;
  const edges = points.map((point, index) => {
    const next = points[(index + 1) % points.length]!;
    return Math.hypot(next.x - point.x, next.y - point.y);
  });
  const min = Math.min(...edges);
  const max = Math.max(...edges);
  return min >= 4 && max <= 48 && max / min <= 1.22 ? center(points) : null;
}

function crossMarker(points: readonly Point[]) {
  if (points.length !== 12 || validatePolygon(points).length) return null;
  const edges = points.map((point, index) => {
    const next = points[(index + 1) % points.length]!;
    const x = next.x - point.x;
    const y = next.y - point.y;
    return { x, y, length: Math.hypot(x, y) };
  });
  let left = 0;
  let right = 0;
  for (const [index, edge] of edges.entries()) {
    const next = edges[(index + 1) % edges.length]!;
    if (edge.length < 2 || next.length < 2) return null;
    const dot = edge.x * next.x + edge.y * next.y;
    if (Math.abs(dot) > 0.1 * edge.length * next.length) return null;
    if (edge.x * next.y - edge.y * next.x > 0) left++;
    else right++;
  }
  if (Math.min(left, right) !== 4) return null;
  const axis = edges[0]!;
  const alignedX = points.map((point) => (point.x * axis.x + point.y * axis.y) / axis.length);
  const alignedY = points.map((point) => (-point.x * axis.y + point.y * axis.x) / axis.length);
  const width = Math.max(...alignedX) - Math.min(...alignedX);
  const height = Math.max(...alignedY) - Math.min(...alignedY);
  const size = Math.max(width, height);
  const fill = area(points) / (width * height);
  return size <= 48 &&
    width >= 4 &&
    height >= 4 &&
    Math.min(width, height) / size >= 0.8 &&
    fill >= 0.3 &&
    fill <= 0.7
    ? center(points)
    : null;
}

function circleMarker(points: readonly Point[]) {
  if (points.length < 16 || validatePolygon(points).length) return null;
  const at = center(points);
  const radii = points.map((point) => Math.hypot(point.x - at.x, point.y - at.y));
  const min = Math.min(...radii);
  const max = Math.max(...radii);
  if (min < 2 || max > 24 || max / min > 1.12) return null;
  const ratio = area(points) / (Math.PI * max * max);
  return ratio >= 0.85 && ratio <= 1 ? at : null;
}

function center(points: readonly Point[]) {
  const count = points.length;
  return points.reduce(
    (mean, point) => ({
      x: mean.x + point.x / count,
      y: mean.y + point.y / count,
    }),
    { x: 0, y: 0 },
  );
}
