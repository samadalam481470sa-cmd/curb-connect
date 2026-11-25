import { z } from 'zod';
import {
  EnterpriseTakeoffCalibration,
  EnterpriseTakeoffCalibrationInput,
} from './enterpriseTakeoffCalibration';

export const TakeoffCalibrationLockMode = z.enum(['after_review', 'locked', 'unlocked']);
const Reason = z.string().trim().min(3).max(1000);

export const SetTakeoffCalibrationLock = z
  .object({
    mode: TakeoffCalibrationLockMode,
    reason: Reason,
    clientRequestId: z.uuid(),
  })
  .strict();

export const TakeoffCalibrationLockRevision = SetTakeoffCalibrationLock.omit({
  clientRequestId: true,
}).extend({
  revision: z.number().int().positive(),
  createdByUserId: z.uuid(),
  createdAt: z.iso.datetime(),
});

export const TakeoffCalibrationLock = z.object({
  mode: TakeoffCalibrationLockMode,
  effective: z.boolean(),
  revision: z.number().int().nonnegative(),
  dependentApprovals: z.number().int().nonnegative(),
  change: TakeoffCalibrationLockRevision.nullable(),
  history: z.array(TakeoffCalibrationLockRevision),
});

export const SubmitTakeoffCalibrationChange = z
  .object({
    input: EnterpriseTakeoffCalibrationInput.omit({ clientRequestId: true }),
    reason: Reason,
    clientRequestId: z.uuid(),
  })
  .strict();

export const DecideTakeoffCalibrationChange = z
  .object({
    decision: z.enum(['approved', 'declined']),
    reason: Reason,
  })
  .strict();

const ProposedScale = EnterpriseTakeoffCalibration.omit({
  id: true,
  sheetId: true,
  revision: true,
  createdAt: true,
});

export const TakeoffCalibrationChange = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  baseCalibrationId: z.uuid(),
  baseCalibrationRevision: z.number().int().positive(),
  previous: ProposedScale.pick({ scale: true, unit: true }),
  appliedCalibrationId: z.uuid().nullable(),
  proposed: ProposedScale,
  reason: Reason,
  status: z.enum(['pending', 'approved', 'declined']),
  submittedByUserId: z.uuid(),
  submittedAt: z.iso.datetime(),
  decidedByUserId: z.uuid().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  decisionReason: Reason.nullable(),
});

export const TakeoffCalibrationChangePage = z.object({
  items: z.array(TakeoffCalibrationChange),
  nextCursor: z.string().nullable(),
});
