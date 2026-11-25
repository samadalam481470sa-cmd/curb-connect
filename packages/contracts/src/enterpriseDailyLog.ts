import { z } from 'zod';
import { EnterpriseScheduleDate } from './enterpriseSchedule';

export const EnterpriseDailyLogStatus = z.enum([
  'draft',
  'submitted',
  'changes_requested',
  'approved',
]);

export const EnterpriseDailyLogInput = z
  .object({
    workDate: EnterpriseScheduleDate,
    weather: z.string().trim().max(250),
    crewCount: z.number().int().min(0).max(1000),
    laborMinutes: z.number().int().min(0).max(1_440_000),
    workPerformed: z.string().trim().min(3).max(6000),
    safetyAndDelays: z.string().trim().max(6000),
    scheduleTaskId: z.uuid().nullable(),
  })
  .refine((log) => log.laborMinutes <= log.crewCount * 1440, {
    message: 'Labor hours cannot exceed 24 hours per crew member.',
    path: ['laborMinutes'],
  });
export type EnterpriseDailyLogInput = z.infer<typeof EnterpriseDailyLogInput>;

export const EnterpriseDailyLog = EnterpriseDailyLogInput.safeExtend({
  id: z.uuid(),
  status: EnterpriseDailyLogStatus,
  revision: z.number().int().positive(),
  reviewNote: z.string().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
});
export type EnterpriseDailyLog = z.infer<typeof EnterpriseDailyLog>;

export const EnterpriseDailyLogPage = z.object({
  items: z.array(EnterpriseDailyLog),
  nextCursor: z.string().nullable(),
});
