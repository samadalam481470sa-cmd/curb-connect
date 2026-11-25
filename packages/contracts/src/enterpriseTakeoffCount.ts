import { z } from 'zod';
import { EnterpriseTakeoffPoint } from './enterpriseTakeoffCalibration';
import { EnterpriseTakeoffCategory } from './enterpriseTakeoffLength';

export const MAX_TAKEOFF_COUNT_MARKERS = 500;
export const EnterpriseTakeoffMarkerSymbol = z.enum(['circle', 'square', 'triangle', 'cross']);
export type EnterpriseTakeoffMarkerSymbol = z.infer<typeof EnterpriseTakeoffMarkerSymbol>;

const Marker = z.object({
  id: z.uuid(),
  point: EnterpriseTakeoffPoint,
  removedAt: z.iso.datetime().nullable(),
});

export const EnterpriseTakeoffCountInput = z
  .object({
    categoryId: z.uuid(),
    symbol: EnterpriseTakeoffMarkerSymbol,
    points: z.array(EnterpriseTakeoffPoint).min(1).max(MAX_TAKEOFF_COUNT_MARKERS),
    clientRequestId: z.uuid(),
  })
  .strict();

export const EnterpriseTakeoffCount = z.object({
  id: z.uuid(),
  sheetId: z.uuid(),
  categoryId: z.uuid(),
  symbol: EnterpriseTakeoffMarkerSymbol,
  total: z.number().int().nonnegative(),
  revision: z.number().int().positive(),
  markers: z.array(Marker),
  createdAt: z.iso.datetime(),
});

export const EnterpriseTakeoffCountList = z.object({
  items: z.array(EnterpriseTakeoffCount),
  categories: z.array(EnterpriseTakeoffCategory),
  nextCursor: z.string().nullable(),
});

export function nearTakeoffMarker(
  point: EnterpriseTakeoffPoint,
  existing: readonly EnterpriseTakeoffPoint[],
  tolerancePoints: number,
) {
  return existing.some(
    (marker) => Math.hypot(marker.x - point.x, marker.y - point.y) <= tolerancePoints,
  );
}
