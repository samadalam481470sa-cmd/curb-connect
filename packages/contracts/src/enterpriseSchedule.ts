import { z } from 'zod';

export const EnterpriseScheduleDate = z.iso
  .date()
  .refine(
    (value) => value >= '2000-01-01' && value <= '2200-12-31',
    'Enter a date between 2000 and 2200.',
  );

export const EnterpriseScheduleTaskInput = z
  .object({
    title: z.string().trim().min(2).max(180),
    phase: z.string().trim().min(1).max(80),
    startsOn: EnterpriseScheduleDate,
    endsOn: EnterpriseScheduleDate,
    predecessorId: z.uuid().nullable(),
    lagDays: z.number().int().min(0).max(365),
    progressPercent: z.number().int().min(0).max(100),
  })
  .refine((task) => task.startsOn <= task.endsOn, {
    message: 'End date must be on or after the start date.',
    path: ['endsOn'],
  })
  .refine((task) => task.predecessorId !== null || task.lagDays === 0, {
    message: 'Select a predecessor to apply a lag.',
    path: ['lagDays'],
  });
export type EnterpriseScheduleTaskInput = z.infer<typeof EnterpriseScheduleTaskInput>;

export const EnterpriseScheduleTask = EnterpriseScheduleTaskInput.safeExtend({
  id: z.uuid(),
  revision: z.number().int().positive(),
  actualStartOn: z.iso.date().nullable(),
  actualFinishOn: z.iso.date().nullable(),
  forecastStartOn: z.iso.date(),
  forecastEndOn: z.iso.date(),
  leftPercent: z.number(),
  widthPercent: z.number(),
  baselineEndOn: z.iso.date().nullable(),
  varianceDays: z.number().int().nullable(),
});
export type EnterpriseScheduleTask = z.infer<typeof EnterpriseScheduleTask>;

export const EnterpriseScheduleSnapshot = z.object({
  items: z.array(EnterpriseScheduleTask),
  chartStart: z.iso.date().nullable(),
  chartEnd: z.iso.date().nullable(),
  baselines: z.array(
    z.object({
      id: z.uuid(),
      label: z.string(),
      createdAt: z.iso.datetime(),
    }),
  ),
  selectedBaselineId: z.uuid().nullable(),
});
export type EnterpriseScheduleSnapshot = z.infer<typeof EnterpriseScheduleSnapshot>;

export const EnterpriseSchedulePreview = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  affected: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      beforeStartOn: z.iso.date(),
      beforeEndOn: z.iso.date(),
      afterStartOn: z.iso.date(),
      afterEndOn: z.iso.date(),
    }),
  ),
});
export type EnterpriseSchedulePreview = z.infer<typeof EnterpriseSchedulePreview>;

export const EnterpriseScheduleTemplate = z.object({
  id: z.uuid(),
  label: z.string(),
  taskCount: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
export const EnterpriseScheduleTemplates = z.object({
  items: z.array(EnterpriseScheduleTemplate),
  nextCursor: z.string().nullable(),
});
export const EnterpriseScheduleTemplatePlacement = z.object({
  templateId: z.uuid(),
  startsOn: EnterpriseScheduleDate,
});
export const EnterpriseScheduleTemplatePreview = z.object({
  token: EnterpriseSchedulePreview.shape.token,
  items: z.array(
    z.object({
      key: z.uuid(),
      title: z.string(),
      phase: z.string(),
      startOn: z.iso.date(),
      endOn: z.iso.date(),
    }),
  ),
});
export type EnterpriseScheduleTemplatePreview = z.infer<typeof EnterpriseScheduleTemplatePreview>;
