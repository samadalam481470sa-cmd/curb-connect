// Critical-path scheduling contracts (blueprint gap 1): CPM results over the PM
// schedule task graph, reschedule simulation, dependency links and baselines.
// Computed dates are planning estimates derived from entered dates — the UI
// labels them as such.
import { z } from 'zod';
import { UuidSchema } from './common';

export const ScheduleDependencySchema = z.object({
  id: UuidSchema,
  jobId: UuidSchema,
  predecessorTaskId: UuidSchema,
  successorTaskId: UuidSchema,
  lagDays: z.number().int().min(0),
  createdAt: z.string(),
});
export type ScheduleDependency = z.infer<typeof ScheduleDependencySchema>;

export const CreateScheduleDependencyRequestSchema = z.object({
  predecessorTaskId: UuidSchema,
  successorTaskId: UuidSchema,
  lagDays: z.number().int().min(0).max(3650).default(0),
});

export const CpmTaskResultSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  durationDays: z.number().int(),
  enteredStartsOn: z.string(),
  enteredEndsOn: z.string(),
  earliestStart: z.string(),
  earliestFinish: z.string(),
  latestStart: z.string(),
  latestFinish: z.string(),
  floatDays: z.number().int(),
  critical: z.boolean(),
});
export type CpmTaskResult = z.infer<typeof CpmTaskResultSchema>;

export const CriticalPathResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    projectStart: z.string(),
    projectEnd: z.string(),
    projectDurationDays: z.number().int(),
    tasks: z.array(CpmTaskResultSchema),
    criticalPath: z.array(UuidSchema),
    dependencies: z.array(ScheduleDependencySchema),
  }),
  z.object({ ok: z.literal(false), reason: z.literal('cycle'), cycleTaskIds: z.array(UuidSchema) }),
  z.object({ ok: z.literal(false), reason: z.literal('empty') }),
]);
export type CriticalPathResponse = z.infer<typeof CriticalPathResponseSchema>;

export const SimulateMoveRequestSchema = z.object({
  taskId: UuidSchema,
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
});

export const SimulatedTaskChangeSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  beforeStartsOn: z.string(),
  beforeEndsOn: z.string(),
  afterStartsOn: z.string(),
  afterEndsOn: z.string(),
  shiftDays: z.number().int(),
});

export const SimulateMoveResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    changes: z.array(SimulatedTaskChangeSchema),
    projectEndBefore: z.string(),
    projectEndAfter: z.string(),
    projectEndShiftDays: z.number().int(),
    criticalPathAfter: z.array(UuidSchema),
  }),
  z.object({ ok: z.literal(false), reason: z.enum(['cycle', 'empty', 'task_not_found']) }),
]);
export type SimulateMoveResponse = z.infer<typeof SimulateMoveResponseSchema>;

export const ScheduleBaselineSchema = z.object({
  id: UuidSchema,
  jobId: UuidSchema,
  name: z.string(),
  note: z.string().nullable(),
  capturedAt: z.string(),
  taskCount: z.number().int(),
});
export type ScheduleBaseline = z.infer<typeof ScheduleBaselineSchema>;

export const CreateScheduleBaselineRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  note: z.string().trim().max(2000).nullable().optional(),
});

export const BaselineVarianceRowSchema = z.object({
  taskId: UuidSchema,
  title: z.string(),
  baselineStartsOn: z.string().nullable(),
  baselineEndsOn: z.string().nullable(),
  currentStartsOn: z.string().nullable(),
  currentEndsOn: z.string().nullable(),
  startVarianceDays: z.number().int().nullable(),
  finishVarianceDays: z.number().int().nullable(),
  state: z.enum(['on_plan', 'slipped', 'ahead', 'added', 'removed']),
});

export const BaselineCompareResponseSchema = z.object({
  baseline: ScheduleBaselineSchema,
  rows: z.array(BaselineVarianceRowSchema),
});
export type BaselineCompareResponse = z.infer<typeof BaselineCompareResponseSchema>;
