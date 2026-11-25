import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  computeTakeoffCalibration,
  type EnterpriseTakeoffCalibrationInput,
} from '@fieldline/contracts';
import {
  enterpriseTakeoffCalibrations as calibrations,
  enterpriseTakeoffPlanSheets as sheets,
} from '../../db/schema/enterpriseTakeoff';
import type { Tx } from '../../db/runtime';
import { problem } from '../../http/problem';
import { audit } from './access';

export const calibrationParams = z.object({
  projectId: z.uuid(),
  planId: z.uuid(),
  sheetId: z.uuid(),
});
export const calibrationPath =
  '/enterprise/projects/:projectId/takeoff/plan-sets/:planId/sheets/:sheetId/calibration';
export type TakeoffSheetScope = z.infer<typeof calibrationParams> & { orgId: string };

export function calibrationScope({ orgId, projectId, planId, sheetId }: TakeoffSheetScope) {
  return and(
    eq(calibrations.orgId, orgId),
    eq(calibrations.projectId, projectId),
    eq(calibrations.planId, planId),
    eq(calibrations.sheetId, sheetId),
  );
}

export async function readSheet(tx: Tx, { orgId, projectId, planId, sheetId }: TakeoffSheetScope) {
  const [sheet] = await tx
    .select({ widthPoints: sheets.widthPoints, heightPoints: sheets.heightPoints })
    .from(sheets)
    .where(
      and(
        eq(sheets.orgId, orgId),
        eq(sheets.projectId, projectId),
        eq(sheets.planId, planId),
        eq(sheets.id, sheetId),
      ),
    );
  if (!sheet) throw problem('not_found');
  return sheet;
}

export async function currentCalibration(tx: Tx, scope: TakeoffSheetScope) {
  const [row] = await tx
    .select()
    .from(calibrations)
    .where(calibrationScope(scope))
    .orderBy(desc(calibrations.revision))
    .limit(1);
  return row;
}

export function calibrationDto(row: typeof calibrations.$inferSelect) {
  return {
    id: row.id,
    sheetId: row.sheetId,
    revision: row.revision,
    ...row.input,
    ...row.result,
    createdAt: row.createdAt.toISOString(),
  };
}

type Calibration = typeof calibrations.$inferSelect;
type CalibrationInput = Omit<z.infer<typeof EnterpriseTakeoffCalibrationInput>, 'clientRequestId'>;
type CalibrationResult = ReturnType<typeof computeTakeoffCalibration>;

export function computeCalibrationResult(
  input: CalibrationInput,
  sheet: { widthPoints: number; heightPoints: number },
) {
  try {
    return computeTakeoffCalibration(input, sheet);
  } catch (error) {
    if (error instanceof RangeError) throw problem('validation_failed', error.message);
    throw error;
  }
}

export async function insertTakeoffCalibration(
  tx: Tx,
  scope: TakeoffSheetScope,
  userId: string,
  data: {
    current: Calibration | undefined;
    input: CalibrationInput;
    result: CalibrationResult;
    requestHash: string;
    clientRequestId: string;
  },
) {
  const { current, ...values } = data;
  const [row] = await tx
    .insert(calibrations)
    .values({
      ...scope,
      ...values,
      revision: (current?.revision ?? 0) + 1,
      createdByUserId: userId,
    })
    .returning();
  if (!row) throw new Error('Takeoff calibration insertion failed.');
  await audit(
    tx,
    scope.orgId,
    userId,
    'takeoff_sheet',
    scope.sheetId,
    'takeoff_sheet.calibrated',
    current ? calibrationDto(current) : null,
    calibrationDto(row),
  );
  return row;
}
