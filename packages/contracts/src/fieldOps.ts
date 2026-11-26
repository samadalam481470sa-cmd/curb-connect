// Field operations contracts (builder operations section): mobile time tracking with labor
// cost allocation, generic inspection checklists, and the English/Spanish label dictionary the
// new field views render from. Time entries record what a crew member actually worked (entered
// by the member or their lead) and allocate the hours to a job + cost code at a builder-entered
// rate — the labor cost is hours × the entered rate, computed and labeled, never a market rate.
// Checklist templates are builder-defined; a completed checklist records pass/fail per item as
// observed by the inspector.
import { z } from 'zod';
import { CurrencyCodeSchema, IsoDateSchema, IsoDateTimeSchema, UuidSchema } from './common';

// ---------------------------------------------------------------- time entries

export const TimeEntrySchema = z.object({
  id: UuidSchema,
  membershipId: UuidSchema.nullable(),
  workerName: z.string(),
  jobId: UuidSchema.nullable(),
  costCode: z.string().nullable(),
  workDate: IsoDateSchema,
  /** Hours as entered (decimal allowed, e.g. 7.5). */
  hours: z.number().min(0).max(24),
  /** Builder-entered hourly rate in minor units; null until a rate is set. */
  rateMinorPerHour: z.number().int().nullable(),
  /** hours × rate, computed when both exist; null otherwise. Never invented. */
  laborCostMinor: z.number().int().nullable(),
  currency: CurrencyCodeSchema,
  note: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type TimeEntry = z.infer<typeof TimeEntrySchema>;

export const TimeEntryListSchema = z.object({ items: z.array(TimeEntrySchema) });

export const CreateTimeEntryRequestSchema = z.object({
  workerName: z.string().trim().min(1).max(160),
  membershipId: UuidSchema.nullable().optional(),
  jobId: UuidSchema.nullable().optional(),
  costCode: z.string().trim().max(24).nullable().optional(),
  workDate: IsoDateSchema,
  hours: z.number().min(0).max(24),
  rateMinorPerHour: z.number().int().min(0).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type CreateTimeEntryRequest = z.infer<typeof CreateTimeEntryRequestSchema>;

/** Hours + labor cost rolled up per job (and per cost code inside it). */
export const TimeRollupSchema = z.object({
  jobId: UuidSchema.nullable(),
  totalHours: z.number(),
  totalLaborCostMinor: z.number().int().nullable(),
  entryCount: z.number().int(),
  byCostCode: z.array(
    z.object({
      costCode: z.string().nullable(),
      hours: z.number(),
      laborCostMinor: z.number().int().nullable(),
    }),
  ),
});
export type TimeRollup = z.infer<typeof TimeRollupSchema>;

// ---------------------------------------------------------------- inspection checklists

export const InspectionChecklistTemplateSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  description: z.string().nullable(),
  items: z.array(z.object({ key: z.string(), label: z.string(), required: z.boolean() })),
  active: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type InspectionChecklistTemplate = z.infer<typeof InspectionChecklistTemplateSchema>;

export const InspectionChecklistTemplateListSchema = z.object({
  items: z.array(InspectionChecklistTemplateSchema),
});

export const CreateInspectionChecklistTemplateRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  items: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(60),
        label: z.string().trim().min(1).max(300),
        required: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(100),
});
export type CreateInspectionChecklistTemplateRequest = z.infer<
  typeof CreateInspectionChecklistTemplateRequestSchema
>;

export const InspectionResultSchema = z.object({
  id: UuidSchema,
  templateId: UuidSchema,
  jobId: UuidSchema.nullable(),
  inspectorName: z.string().nullable(),
  status: z.enum(['in_progress', 'completed']),
  answers: z.array(
    z.object({
      key: z.string(),
      result: z.enum(['pass', 'fail', 'na']),
      note: z.string().nullable().optional(),
    }),
  ),
  photoMediaIds: z.array(UuidSchema),
  completedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type InspectionResult = z.infer<typeof InspectionResultSchema>;

export const InspectionResultListSchema = z.object({
  items: z.array(InspectionResultSchema),
});

export const CreateInspectionResultRequestSchema = z.object({
  templateId: UuidSchema,
  jobId: UuidSchema.nullable().optional(),
  inspectorName: z.string().trim().max(160).nullable().optional(),
});
export type CreateInspectionResultRequest = z.infer<typeof CreateInspectionResultRequestSchema>;

export const UpdateInspectionResultRequestSchema = z.object({
  answers: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(60),
        result: z.enum(['pass', 'fail', 'na']),
        note: z.string().trim().max(2000).nullable().optional(),
      }),
    )
    .max(100)
    .optional(),
  photoMediaIds: z.array(UuidSchema).max(50).optional(),
  complete: z.boolean().optional(),
});
export type UpdateInspectionResultRequest = z.infer<typeof UpdateInspectionResultRequestSchema>;

// ---------------------------------------------------------------- bilingual labels

/** UI languages the builder-operations views render in. Stored values are never translated. */
export const UI_LANGUAGES = ['en', 'es'] as const;
export const UiLanguageSchema = z.enum(UI_LANGUAGES);
export type UiLanguage = z.infer<typeof UiLanguageSchema>;
