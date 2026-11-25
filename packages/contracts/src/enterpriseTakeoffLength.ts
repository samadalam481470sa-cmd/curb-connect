import { z } from 'zod';
import { EnterpriseTakeoffPoint, EnterpriseTakeoffUnit } from './enterpriseTakeoffCalibration';

export const MAX_TAKEOFF_LENGTH_VERTICES = 250;
export const TakeoffLengthVertices = z
  .array(EnterpriseTakeoffPoint)
  .min(2)
  .max(MAX_TAKEOFF_LENGTH_VERTICES);

export const EnterpriseTakeoffCategoryInput = z
  .object({
    name: z.string().trim().min(2).max(100),
  })
  .strict();

export const EnterpriseTakeoffCategory = EnterpriseTakeoffCategoryInput.extend({
  id: z.uuid(),
});

export const EnterpriseTakeoffLengthInput = z
  .object({
    calibrationId: z.uuid(),
    categoryId: z.uuid(),
    vertices: TakeoffLengthVertices,
    clientRequestId: z.uuid(),
  })
  .strict();

export const EnterpriseTakeoffLength = EnterpriseTakeoffLengthInput.omit({
  clientRequestId: true,
}).extend({
  id: z.uuid(),
  sheetId: z.uuid(),
  drawingLength: z.number().positive(),
  length: z.number().positive(),
  unit: EnterpriseTakeoffUnit,
  requiresReview: z.boolean(),
  createdAt: z.iso.datetime(),
});

export const EnterpriseTakeoffLengthPage = z.object({
  items: z.array(EnterpriseTakeoffLength),
  categories: z.array(EnterpriseTakeoffCategory),
  nextCursor: z.string().nullable(),
});

export function computeTakeoffLength(
  vertices: readonly EnterpriseTakeoffPoint[],
  scale: number,
  sheet: { widthPoints: number; heightPoints: number },
) {
  if (vertices.length < 2 || vertices.length > MAX_TAKEOFF_LENGTH_VERTICES)
    throw new RangeError('Select at least two points within the supported vertex limit.');
  let drawingLength = 0;
  let previous: EnterpriseTakeoffPoint | undefined;
  for (const point of vertices) {
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0 ||
      point.y < 0 ||
      point.x > sheet.widthPoints ||
      point.y > sheet.heightPoints
    ) {
      throw new RangeError('Select points inside the sheet.');
    }
    if (previous) {
      const segment = Math.hypot(point.x - previous.x, point.y - previous.y);
      if (!Number.isFinite(segment) || segment === 0)
        throw new RangeError('Each segment needs two distinct points.');
      drawingLength += segment;
    }
    previous = point;
  }
  const length = drawingLength * scale;
  if (!Number.isFinite(length) || length <= 0)
    throw new RangeError('The calibrated length is out of range.');
  return { drawingLength, length };
}

export function snapTakeoffDirection(
  start: EnterpriseTakeoffPoint,
  end: EnterpriseTakeoffPoint,
  sheet: { widthPoints: number; heightPoints: number },
): EnterpriseTakeoffPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const xDirection = Math.cos(angle);
  const yDirection = Math.sin(angle);
  const maxX =
    Math.abs(xDirection) < 1e-12
      ? Infinity
      : (xDirection > 0 ? sheet.widthPoints - start.x : start.x) / Math.abs(xDirection);
  const maxY =
    Math.abs(yDirection) < 1e-12
      ? Infinity
      : (yDirection > 0 ? sheet.heightPoints - start.y : start.y) / Math.abs(yDirection);
  const length = Math.min(Math.hypot(dx, dy), maxX, maxY);
  return {
    x: Math.max(0, Math.min(sheet.widthPoints, start.x + length * xDirection)),
    y: Math.max(0, Math.min(sheet.heightPoints, start.y + length * yDirection)),
  };
}
