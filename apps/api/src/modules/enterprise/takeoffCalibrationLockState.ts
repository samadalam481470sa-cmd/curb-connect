import { and, count, desc, eq } from 'drizzle-orm';
import {
  enterpriseTakeoffCalibrationLockRevisions as locks,
  enterpriseTakeoffReviews as reviews,
} from '../../db/schema/enterpriseTakeoff';
import type { Tx } from '../../db/runtime';
import type { TakeoffSheetScope } from './takeoffCalibrationData';
import { sheetScope } from './takeoffMeasurements';

export type CalibrationLockRow = typeof locks.$inferSelect;

export function lockRevisionDto(row: CalibrationLockRow) {
  return {
    revision: row.revision,
    mode: row.mode,
    reason: row.reason,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function readCalibrationLock(
  tx: Tx,
  scope: TakeoffSheetScope,
  calibrationId: string | undefined,
  historyLimit = 1,
) {
  const changes = await tx
    .select()
    .from(locks)
    .where(sheetScope(locks, scope))
    .orderBy(desc(locks.revision))
    .limit(historyLimit);
  const [change] = changes;
  const approvals = calibrationId
    ? await tx
        .select({ total: count() })
        .from(reviews)
        .where(
          and(
            sheetScope(reviews, scope),
            eq(reviews.calibrationId, calibrationId),
            eq(reviews.status, 'approved'),
          ),
        )
    : [];
  const dependentApprovals = approvals[0]?.total ?? 0;
  const mode = change?.mode ?? 'after_review';
  return {
    mode,
    revision: change?.revision ?? 0,
    dependentApprovals,
    effective: Boolean(
      calibrationId && (mode === 'locked' || (mode === 'after_review' && dependentApprovals > 0)),
    ),
    change: change ? lockRevisionDto(change) : null,
    history: changes.map(lockRevisionDto),
  };
}
