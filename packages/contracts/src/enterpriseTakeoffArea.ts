import { z } from 'zod';
import { EnterpriseTakeoffPoint, EnterpriseTakeoffUnit } from './enterpriseTakeoffCalibration';

export const MAX_TAKEOFF_AREA_RING_VERTICES = 150;
export const MAX_TAKEOFF_AREA_HOLES = 20;
export const MAX_TAKEOFF_AREA_POINTS = 500;
const Ring = z.array(EnterpriseTakeoffPoint).min(3).max(MAX_TAKEOFF_AREA_RING_VERTICES);
const AreaInput = z.object({
  calibrationId: z.uuid(),
  exterior: Ring,
  holes: z.array(Ring).max(MAX_TAKEOFF_AREA_HOLES),
});
export const EnterpriseTakeoffAreaInput = AreaInput.extend({
  clientRequestId: z.uuid(),
})
  .strict()
  .refine(
    ({ exterior, holes }) =>
      exterior.length + holes.reduce((n, ring) => n + ring.length, 0) <= MAX_TAKEOFF_AREA_POINTS,
    {
      message:
        'An area can contain at most ' +
        MAX_TAKEOFF_AREA_POINTS +
        ' vertices across all boundaries.',
    },
  );

export const EnterpriseTakeoffArea = AreaInput.extend({
  id: z.uuid(),
  sheetId: z.uuid(),
  exteriorArea: z.number().positive(),
  deductedArea: z.number().nonnegative(),
  netArea: z.number().positive(),
  exteriorPerimeter: z.number().positive(),
  deductionPerimeter: z.number().nonnegative(),
  unit: EnterpriseTakeoffUnit,
  requiresReview: z.boolean(),
  createdAt: z.iso.datetime(),
});

export const EnterpriseTakeoffAreaPage = z.object({
  items: z.array(EnterpriseTakeoffArea),
  nextCursor: z.string().nullable(),
});
