// Progress-billing contracts (blueprint gap 2): schedules of values,
// applications with contractor-entered percent-complete and stored materials,
// approval, invoice generation, and AR aging. Money is integer minor units.
import { z } from 'zod';
import { UuidSchema } from './common';

export const SovLineInputSchema = z.object({
  itemNumber: z.string().trim().max(40).default(''),
  description: z.string().trim().min(1).max(300),
  costCode: z.string().trim().max(60).nullable().optional(),
  scheduledValueMinor: z.number().int().min(0).max(1_000_000_000_000),
});

export const SovLineSchema = SovLineInputSchema.extend({
  id: UuidSchema,
  sortOrder: z.number().int(),
});
export type SovLine = z.infer<typeof SovLineSchema>;

export const ScheduleOfValuesSchema = z.object({
  id: UuidSchema,
  jobId: UuidSchema,
  name: z.string(),
  contractMinor: z.number().int(),
  /** Sum of line scheduled values; may differ from contractMinor (shown honestly). */
  linesTotalMinor: z.number().int(),
  retainagePct: z.number(),
  currency: z.string(),
  status: z.enum(['draft', 'active', 'closed']),
  lines: z.array(SovLineSchema),
  revision: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ScheduleOfValues = z.infer<typeof ScheduleOfValuesSchema>;

export const CreateSovRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contractMinor: z.number().int().min(0).max(1_000_000_000_000),
  retainagePct: z.number().min(0).max(100).default(0),
  lines: z.array(SovLineInputSchema).min(1).max(200),
});

export const UpdateSovRequestSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  contractMinor: z.number().int().min(0).max(1_000_000_000_000).optional(),
  retainagePct: z.number().min(0).max(100).optional(),
  status: z.enum(['draft', 'active', 'closed']).optional(),
  lines: z.array(SovLineInputSchema).min(1).max(200).optional(),
});

export const ApplicationLineInputSchema = z.object({
  sovLineId: UuidSchema,
  percentComplete: z.number().min(0).max(100),
  storedMaterialsMinor: z.number().int().min(0).max(1_000_000_000_000).default(0),
});

export const CreateApplicationRequestSchema = z.object({
  periodStart: z.iso.date(),
  periodEnd: z.iso.date(),
  note: z.string().trim().max(2000).nullable().optional(),
  lines: z.array(ApplicationLineInputSchema).max(200).default([]),
});

export const UpdateApplicationRequestSchema = z.object({
  periodStart: z.iso.date().optional(),
  periodEnd: z.iso.date().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  lines: z.array(ApplicationLineInputSchema).max(200).optional(),
});

export const ComputedApplicationLineSchema = z.object({
  sovLineId: UuidSchema,
  itemNumber: z.string(),
  description: z.string(),
  scheduledValueMinor: z.number().int(),
  percentComplete: z.number(),
  completedToDateMinor: z.number().int(),
  storedMaterialsMinor: z.number().int(),
  completedStoredToDateMinor: z.number().int(),
  previousCompletedStoredMinor: z.number().int(),
  thisPeriodMinor: z.number().int(),
  balanceToFinishMinor: z.number().int(),
  overbilled: z.boolean(),
});

export const ProgressBillingApplicationSchema = z.object({
  id: UuidSchema,
  sovId: UuidSchema,
  jobId: UuidSchema,
  number: z.number().int(),
  periodStart: z.string(),
  periodEnd: z.string(),
  status: z.enum(['draft', 'submitted', 'approved', 'rejected', 'invoiced']),
  invoiceId: UuidSchema.nullable(),
  invoiceNumber: z.string().nullable(),
  note: z.string().nullable(),
  submittedAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  currency: z.string(),
  lines: z.array(ComputedApplicationLineSchema),
  totals: z.object({
    scheduledTotalMinor: z.number().int(),
    completedStoredTotalMinor: z.number().int(),
    previousCompletedStoredMinor: z.number().int(),
    thisPeriodGrossMinor: z.number().int(),
    retainageToDateMinor: z.number().int(),
    retainageThisPeriodMinor: z.number().int(),
    currentDueMinor: z.number().int(),
    balanceToFinishMinor: z.number().int(),
    overbilled: z.boolean(),
  }),
  revision: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProgressBillingApplication = z.infer<typeof ProgressBillingApplicationSchema>;

export const ProgressBillingPdfResponseSchema = z.object({
  filename: z.string(),
  contentBase64: z.string(),
  sha256Hex: z.string(),
  pages: z.number().int(),
});
export type ProgressBillingPdfResponse = z.infer<typeof ProgressBillingPdfResponseSchema>;

export const ArAgingBucketSchema = z.object({
  bucket: z.enum(['current', 'days_1_30', 'days_31_60', 'days_61_90', 'days_90_plus', 'no_due_date']),
  invoiceCount: z.number().int(),
  outstandingMinor: z.number().int(),
});

export const ArAgingResponseSchema = z.object({
  currency: z.string(),
  /** As-of date used for bucketing (today, UTC). */
  asOf: z.string(),
  buckets: z.array(ArAgingBucketSchema),
  totalOutstandingMinor: z.number().int(),
  invoices: z.array(
    z.object({
      id: UuidSchema,
      number: z.string(),
      customerName: z.string().nullable(),
      jobId: UuidSchema.nullable(),
      status: z.string(),
      dueOn: z.string().nullable(),
      totalMinor: z.number().int(),
      amountPaidMinor: z.number().int(),
      outstandingMinor: z.number().int(),
      daysOverdue: z.number().int().nullable(),
    }),
  ),
});
export type ArAgingResponse = z.infer<typeof ArAgingResponseSchema>;
