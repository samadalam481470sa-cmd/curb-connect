import { z } from 'zod';

export const EnterpriseTakeoffUnit = z.enum(['ft', 'in', 'yd', 'm', 'cm', 'mm']);
export type EnterpriseTakeoffUnit = z.infer<typeof EnterpriseTakeoffUnit>;

export const EnterpriseTakeoffPoint = z
  .object({
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
  })
  .strict();
export type EnterpriseTakeoffPoint = z.infer<typeof EnterpriseTakeoffPoint>;

const CalibrationLine = z.object({
  pointA: EnterpriseTakeoffPoint,
  pointB: EnterpriseTakeoffPoint,
  knownLength: z.number().positive(),
});

const CalibrationData = CalibrationLine.extend({
  unit: EnterpriseTakeoffUnit,
  verification: CalibrationLine.strict().nullable(),
});

export const EnterpriseTakeoffCalibrationInput = CalibrationData.extend({
  clientRequestId: z.uuid(),
}).strict();

const CalibrationResult = z.object({
  drawingLength: z.number().positive(),
  scale: z.number().positive(),
  verificationResult: z
    .object({
      drawingLength: z.number().positive(),
      calculatedLength: z.number().positive(),
      errorPercent: z.number().nonnegative(),
    })
    .nullable(),
});

export const EnterpriseTakeoffCalibration = CalibrationData.extend(CalibrationResult.shape).extend({
  id: z.uuid(),
  sheetId: z.uuid(),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
export type EnterpriseTakeoffCalibration = z.infer<typeof EnterpriseTakeoffCalibration>;

export const EnterpriseTakeoffCalibrationState = z.object({
  revision: z.number().int().nonnegative(),
  calibration: EnterpriseTakeoffCalibration.nullable(),
});

function referenceLength(
  line: z.infer<typeof CalibrationLine>,
  sheet: { widthPoints: number; heightPoints: number },
) {
  const { pointA, pointB } = line;
  for (const point of [pointA, pointB]) {
    if (point.x < 0 || point.y < 0 || point.x > sheet.widthPoints || point.y > sheet.heightPoints) {
      throw new RangeError('Select points inside the sheet.');
    }
  }
  const length = Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
  if (!Number.isFinite(length) || length === 0) {
    throw new RangeError('Select two distinct points for each reference.');
  }
  return length;
}

export function computeTakeoffCalibration(
  data: z.infer<typeof CalibrationData>,
  sheet: { widthPoints: number; heightPoints: number },
): z.infer<typeof CalibrationResult> {
  const drawingLength = referenceLength(data, sheet);
  const scale = data.knownLength / drawingLength;
  if (!Number.isFinite(scale) || scale <= 0)
    throw new RangeError('Enter a valid reference length.');
  if (!data.verification) return { drawingLength, scale, verificationResult: null };

  const verificationDrawingLength = referenceLength(data.verification, sheet);
  const calculatedLength = verificationDrawingLength * scale;
  const errorPercent =
    (Math.abs(calculatedLength - data.verification.knownLength) / data.verification.knownLength) *
    100;
  if (
    !Number.isFinite(errorPercent) ||
    !Number.isFinite(calculatedLength) ||
    calculatedLength <= 0
  ) {
    throw new RangeError('Enter a valid verification length.');
  }
  return {
    drawingLength,
    scale,
    verificationResult: {
      drawingLength: verificationDrawingLength,
      calculatedLength,
      errorPercent,
    },
  };
}
