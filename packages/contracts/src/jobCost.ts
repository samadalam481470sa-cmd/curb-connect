// Job cost, draw billing, accounts payable and lien-release contracts (builder operations
// section). Job cost is the in-app job-cost ledger: budget lines per cost code against a job,
// actuals recorded from POs, bills and manual entries — every number is builder-entered or
// carried from an existing record, never invented. Draws are progress-billing requests against
// a contract amount. AP invoices move capture → approval → payment-recorded; actually moving
// money stays gated on a payments provider (see integrations). Lien releases are tracked
// documents: Texas has statutory lien-waiver forms, and these records track the paperwork —
// they are not legal advice and the generated sheet says so.
import { z } from 'zod';
import { CurrencyCodeSchema, IsoDateSchema, IsoDateTimeSchema, UuidSchema } from './common';

// ---------------------------------------------------------------- job cost

export const JobCostBudgetLineSchema = z.object({
  id: UuidSchema,
  jobId: UuidSchema,
  costCode: z.string(),
  label: z.string(),
  budgetMinor: z.number().int(),
  currency: CurrencyCodeSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type JobCostBudgetLine = z.infer<typeof JobCostBudgetLineSchema>;

export const JobCostEntrySchema = z.object({
  id: UuidSchema,
  jobId: UuidSchema,
  costCode: z.string(),
  description: z.string(),
  amountMinor: z.number().int(),
  currency: CurrencyCodeSchema,
  /** Where the actual came from: a PO, an AP invoice, or typed in by hand. */
  source: z.enum(['purchase_order', 'ap_invoice', 'manual']),
  sourceId: UuidSchema.nullable(),
  incurredOn: IsoDateSchema,
  createdAt: IsoDateTimeSchema,
});
export type JobCostEntry = z.infer<typeof JobCostEntrySchema>;

/** Budget vs actual per cost code. `actualMinor` sums recorded entries only. */
export const JobCostSummaryLineSchema = z.object({
  costCode: z.string(),
  label: z.string().nullable(),
  budgetMinor: z.number().int().nullable(),
  actualMinor: z.number().int(),
  /** budget − actual; null when no budget line exists for the code. */
  remainingMinor: z.number().int().nullable(),
  entryCount: z.number().int(),
});
export type JobCostSummaryLine = z.infer<typeof JobCostSummaryLineSchema>;

export const JobCostSummarySchema = z.object({
  jobId: UuidSchema,
  lines: z.array(JobCostSummaryLineSchema),
  totalBudgetMinor: z.number().int().nullable(),
  totalActualMinor: z.number().int(),
  currency: CurrencyCodeSchema,
});
export type JobCostSummary = z.infer<typeof JobCostSummarySchema>;

export const UpsertJobCostBudgetRequestSchema = z.object({
  costCode: z.string().trim().min(1).max(24),
  label: z.string().trim().min(1).max(160),
  budgetMinor: z.number().int().min(0),
});
export type UpsertJobCostBudgetRequest = z.infer<typeof UpsertJobCostBudgetRequestSchema>;

export const CreateJobCostEntryRequestSchema = z.object({
  costCode: z.string().trim().min(1).max(24),
  description: z.string().trim().min(1).max(500),
  amountMinor: z.number().int(),
  source: z.enum(['purchase_order', 'ap_invoice', 'manual']).default('manual'),
  sourceId: UuidSchema.nullable().optional(),
  incurredOn: IsoDateSchema,
});
export type CreateJobCostEntryRequest = z.infer<typeof CreateJobCostEntryRequestSchema>;

// ---------------------------------------------------------------- draws / progress billing

export const DRAW_STATUSES = ['draft', 'submitted', 'approved', 'paid', 'rejected'] as const;
export const DrawStatusSchema = z.enum(DRAW_STATUSES);
export type DrawStatus = z.infer<typeof DrawStatusSchema>;

export const DrawRequestSchema = z.object({
  id: UuidSchema,
  jobId: UuidSchema,
  number: z.number().int(),
  status: DrawStatusSchema,
  /** Contract amount the draw is billed against (builder-entered). */
  contractMinor: z.number().int(),
  /** Amount requested on this draw (builder-entered). */
  requestedMinor: z.number().int(),
  /** Sum of earlier paid draws on this job, computed from records. */
  previouslyPaidMinor: z.number().int(),
  /** Retainage held back on this draw, builder-entered percent of requested. */
  retainagePct: z.number().min(0).max(100),
  currency: CurrencyCodeSchema,
  note: z.string().nullable(),
  submittedAt: IsoDateTimeSchema.nullable(),
  decidedAt: IsoDateTimeSchema.nullable(),
  paidAt: IsoDateTimeSchema.nullable(),
  revision: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type DrawRequest = z.infer<typeof DrawRequestSchema>;

export const DrawRequestListSchema = z.object({ items: z.array(DrawRequestSchema) });

export const CreateDrawRequestSchema = z.object({
  jobId: UuidSchema,
  contractMinor: z.number().int().min(0),
  requestedMinor: z.number().int().min(0),
  retainagePct: z.number().min(0).max(100).default(0),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type CreateDrawRequest = z.infer<typeof CreateDrawRequestSchema>;

export const UpdateDrawRequestSchema = z.object({
  status: DrawStatusSchema,
});
export type UpdateDrawRequest = z.infer<typeof UpdateDrawRequestSchema>;

// ---------------------------------------------------------------- accounts payable

export const AP_INVOICE_STATUSES = [
  'captured',
  'pending_approval',
  'approved',
  'payment_recorded',
  'rejected',
  'disputed',
] as const;
export const ApInvoiceStatusSchema = z.enum(AP_INVOICE_STATUSES);
export type ApInvoiceStatus = z.infer<typeof ApInvoiceStatusSchema>;

export const ApInvoiceSchema = z.object({
  id: UuidSchema,
  vendorName: z.string(),
  invoiceNumber: z.string().nullable(),
  jobId: UuidSchema.nullable(),
  costCode: z.string().nullable(),
  amountMinor: z.number().int(),
  currency: CurrencyCodeSchema,
  dueOn: IsoDateSchema.nullable(),
  status: ApInvoiceStatusSchema,
  /** Where it came from: typed in, Invoice Intelligence, or a network bill. */
  source: z.enum(['manual', 'invoice_intel', 'network_bill']),
  sourceId: UuidSchema.nullable(),
  approvalNote: z.string().nullable(),
  approvedByUserId: UuidSchema.nullable(),
  approvedAt: IsoDateTimeSchema.nullable(),
  paymentRecordedAt: IsoDateTimeSchema.nullable(),
  /** Set when payment is released only after a lien waiver is on file. */
  lienReleaseId: UuidSchema.nullable(),
  revision: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type ApInvoice = z.infer<typeof ApInvoiceSchema>;

export const ApInvoiceListSchema = z.object({ items: z.array(ApInvoiceSchema) });

export const CreateApInvoiceRequestSchema = z.object({
  vendorName: z.string().trim().min(1).max(180),
  invoiceNumber: z.string().trim().max(80).nullable().optional(),
  jobId: UuidSchema.nullable().optional(),
  costCode: z.string().trim().max(24).nullable().optional(),
  amountMinor: z.number().int(),
  dueOn: IsoDateSchema.nullable().optional(),
  source: z.enum(['manual', 'invoice_intel', 'network_bill']).default('manual'),
  sourceId: UuidSchema.nullable().optional(),
});
export type CreateApInvoiceRequest = z.infer<typeof CreateApInvoiceRequestSchema>;

export const DecideApInvoiceRequestSchema = z.object({
  decision: z.enum(['submit_for_approval', 'approve', 'reject', 'dispute', 'record_payment']),
  note: z.string().trim().max(2000).nullable().optional(),
  /** When recording payment, the lien release that gates it (optional). */
  lienReleaseId: UuidSchema.nullable().optional(),
});
export type DecideApInvoiceRequest = z.infer<typeof DecideApInvoiceRequestSchema>;

// ---------------------------------------------------------------- lien releases

export const LIEN_RELEASE_KINDS = [
  'conditional_progress',
  'unconditional_progress',
  'conditional_final',
  'unconditional_final',
] as const;
export const LienReleaseKindSchema = z.enum(LIEN_RELEASE_KINDS);
export type LienReleaseKind = z.infer<typeof LienReleaseKindSchema>;

export const LIEN_RELEASE_STATUSES = ['draft', 'requested', 'received', 'verified', 'void'] as const;
export const LienReleaseStatusSchema = z.enum(LIEN_RELEASE_STATUSES);
export type LienReleaseStatus = z.infer<typeof LienReleaseStatusSchema>;

export const LienReleaseSchema = z.object({
  id: UuidSchema,
  jobId: UuidSchema.nullable(),
  apInvoiceId: UuidSchema.nullable(),
  claimantName: z.string(),
  kind: LienReleaseKindSchema,
  status: LienReleaseStatusSchema,
  /** Amount the waiver covers (builder-entered). */
  amountMinor: z.number().int().nullable(),
  currency: CurrencyCodeSchema,
  throughOn: IsoDateSchema.nullable(),
  receivedAt: IsoDateTimeSchema.nullable(),
  note: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type LienRelease = z.infer<typeof LienReleaseSchema>;

export const LienReleaseListSchema = z.object({ items: z.array(LienReleaseSchema) });

export const CreateLienReleaseRequestSchema = z.object({
  claimantName: z.string().trim().min(1).max(180),
  kind: LienReleaseKindSchema,
  jobId: UuidSchema.nullable().optional(),
  apInvoiceId: UuidSchema.nullable().optional(),
  amountMinor: z.number().int().min(0).nullable().optional(),
  throughOn: IsoDateSchema.nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type CreateLienReleaseRequest = z.infer<typeof CreateLienReleaseRequestSchema>;

export const UpdateLienReleaseRequestSchema = z.object({
  status: LienReleaseStatusSchema,
});
export type UpdateLienReleaseRequest = z.infer<typeof UpdateLienReleaseRequestSchema>;

/** Plain-language label per kind, used by the web UI and the PDF sheet. */
export const LIEN_RELEASE_KIND_LABELS: Record<LienReleaseKind, string> = {
  conditional_progress: 'Conditional waiver — progress payment',
  unconditional_progress: 'Unconditional waiver — progress payment',
  conditional_final: 'Conditional waiver — final payment',
  unconditional_final: 'Unconditional waiver — final payment',
};
