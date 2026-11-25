import { z } from 'zod';
import { EnterpriseTakeoffUnit } from './enterpriseTakeoffCalibration';
import { EnterpriseTakeoffMeasurementKind } from './enterpriseTakeoffCondition';

export const EnterpriseTakeoffReviewStatus = z.enum([
  'review_required',
  'approved',
  'changes_requested',
]);
const Note = z.string().trim().min(3).max(1000);
const Revision = z.number().int().positive();

export const SubmitEnterpriseTakeoffReview = z
  .object({
    note: Note,
    clientRequestId: z.uuid(),
  })
  .strict();

export const DecideEnterpriseTakeoffReview = z
  .object({
    decision: z.enum(['approved', 'changes_requested']),
    note: Note,
  })
  .strict();

export const EnterpriseTakeoffReview = z.object({
  id: z.uuid(),
  measurementId: z.uuid(),
  measurementKind: EnterpriseTakeoffMeasurementKind,
  measurementRevision: Revision,
  calibrationId: z.uuid().nullable(),
  quantity: z.number().nonnegative(),
  unit: EnterpriseTakeoffUnit.nullable(),
  status: EnterpriseTakeoffReviewStatus,
  revision: Revision,
  submitNote: Note,
  submittedByUserId: z.uuid(),
  createdAt: z.iso.datetime(),
  reviewNote: Note.nullable(),
  reviewedByUserId: z.uuid().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
});

export const EnterpriseTakeoffReviewHistory = z.object({
  measurementRevision: Revision,
  approvalBlock: z.enum(['stale_calibration', 'incorrect_scale']).nullable(),
  reviews: z.array(EnterpriseTakeoffReview),
  nextCursor: z.string().nullable(),
});
