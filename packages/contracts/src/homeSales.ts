// Home-sales pipeline + design center contracts (builder operations section). Prospects move
// through a sales pipeline; a prospect tracks BOTH the homebuyer and their real estate agent
// (the Hyphen CRM dual-tracking idea, rebuilt fresh). Contracts carry a base price plus priced
// options the buyer selected from the builder's own options catalog — every price is
// builder-entered; there is no manufacturer catalog and nothing is invented. Selections can be
// attached to a House Studio house so the buyer sees them against the 3D model. Email campaigns
// stay gated on the mailer (not connected) — no campaign sending here.
import { z } from 'zod';
import { CurrencyCodeSchema, IsoDateSchema, IsoDateTimeSchema, UuidSchema } from './common';

// ---------------------------------------------------------------- prospects

export const PROSPECT_STAGES = [
  'new',
  'contacted',
  'appointment',
  'contract',
  'closed',
  'lost',
] as const;
export const ProspectStageSchema = z.enum(PROSPECT_STAGES);
export type ProspectStage = z.infer<typeof ProspectStageSchema>;

export const SalesProspectSchema = z.object({
  id: UuidSchema,
  buyerName: z.string(),
  buyerEmail: z.string().nullable(),
  buyerPhone: z.string().nullable(),
  /** The buyer's real estate agent, tracked alongside the buyer. */
  agentName: z.string().nullable(),
  agentEmail: z.string().nullable(),
  agentPhone: z.string().nullable(),
  agentBrokerage: z.string().nullable(),
  stage: ProspectStageSchema,
  communityName: z.string().nullable(),
  budgetMinor: z.number().int().nullable(),
  currency: CurrencyCodeSchema,
  notes: z.string().nullable(),
  customerId: UuidSchema.nullable(),
  revision: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type SalesProspect = z.infer<typeof SalesProspectSchema>;

export const SalesProspectListSchema = z.object({ items: z.array(SalesProspectSchema) });

export const CreateSalesProspectRequestSchema = z.object({
  buyerName: z.string().trim().min(1).max(200),
  buyerEmail: z.string().trim().max(320).nullable().optional(),
  buyerPhone: z.string().trim().max(40).nullable().optional(),
  agentName: z.string().trim().max(200).nullable().optional(),
  agentEmail: z.string().trim().max(320).nullable().optional(),
  agentPhone: z.string().trim().max(40).nullable().optional(),
  agentBrokerage: z.string().trim().max(200).nullable().optional(),
  communityName: z.string().trim().max(200).nullable().optional(),
  budgetMinor: z.number().int().min(0).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
});
export type CreateSalesProspectRequest = z.infer<typeof CreateSalesProspectRequestSchema>;

export const UpdateSalesProspectRequestSchema = z.object({
  stage: ProspectStageSchema.optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  communityName: z.string().trim().max(200).nullable().optional(),
});
export type UpdateSalesProspectRequest = z.infer<typeof UpdateSalesProspectRequestSchema>;

// ---------------------------------------------------------------- appointments

export const SalesAppointmentSchema = z.object({
  id: UuidSchema,
  prospectId: UuidSchema,
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema,
  location: z.string().nullable(),
  note: z.string().nullable(),
  status: z.enum(['booked', 'completed', 'cancelled', 'no_show']),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type SalesAppointment = z.infer<typeof SalesAppointmentSchema>;

export const SalesAppointmentListSchema = z.object({
  items: z.array(SalesAppointmentSchema),
});

export const CreateSalesAppointmentRequestSchema = z.object({
  startsAt: IsoDateTimeSchema,
  endsAt: IsoDateTimeSchema,
  location: z.string().trim().max(300).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type CreateSalesAppointmentRequest = z.infer<typeof CreateSalesAppointmentRequestSchema>;

export const UpdateSalesAppointmentRequestSchema = z.object({
  status: z.enum(['booked', 'completed', 'cancelled', 'no_show']),
});
export type UpdateSalesAppointmentRequest = z.infer<typeof UpdateSalesAppointmentRequestSchema>;

// ---------------------------------------------------------------- options catalog + selections

export const OPTION_CATEGORIES = [
  'structural',
  'elevation',
  'finish',
  'fixture',
  'flooring',
  'other',
] as const;
export const OptionCategorySchema = z.enum(OPTION_CATEGORIES);
export type OptionCategory = z.infer<typeof OptionCategorySchema>;

export const SalesOptionSchema = z.object({
  id: UuidSchema,
  category: OptionCategorySchema,
  name: z.string(),
  description: z.string().nullable(),
  /** Builder-entered price. Never invented; null means "price on request". */
  priceMinor: z.number().int().nullable(),
  currency: CurrencyCodeSchema,
  /** Optional visual attribute (e.g. a finish color name/hex the builder entered). */
  visualNote: z.string().nullable(),
  active: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type SalesOption = z.infer<typeof SalesOptionSchema>;

export const SalesOptionListSchema = z.object({ items: z.array(SalesOptionSchema) });

export const CreateSalesOptionRequestSchema = z.object({
  category: OptionCategorySchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  priceMinor: z.number().int().min(0).nullable().optional(),
  visualNote: z.string().trim().max(300).nullable().optional(),
});
export type CreateSalesOptionRequest = z.infer<typeof CreateSalesOptionRequestSchema>;

export const UpdateSalesOptionRequestSchema = z.object({
  priceMinor: z.number().int().min(0).nullable().optional(),
  active: z.boolean().optional(),
  visualNote: z.string().trim().max(300).nullable().optional(),
});
export type UpdateSalesOptionRequest = z.infer<typeof UpdateSalesOptionRequestSchema>;

export const SalesSelectionSchema = z.object({
  id: UuidSchema,
  contractId: UuidSchema,
  optionId: UuidSchema,
  /** Price snapshot at selection time (builder-entered catalog price). */
  priceMinor: z.number().int().nullable(),
  currency: CurrencyCodeSchema,
  note: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type SalesSelection = z.infer<typeof SalesSelectionSchema>;

// ---------------------------------------------------------------- contracts

export const SALES_CONTRACT_STATUSES = [
  'draft',
  'signed',
  'in_design',
  'under_construction',
  'closed',
  'cancelled',
] as const;
export const SalesContractStatusSchema = z.enum(SALES_CONTRACT_STATUSES);
export type SalesContractStatus = z.infer<typeof SalesContractStatusSchema>;

export const SalesContractSchema = z.object({
  id: UuidSchema,
  prospectId: UuidSchema,
  status: SalesContractStatusSchema,
  communityName: z.string().nullable(),
  lotLabel: z.string().nullable(),
  planName: z.string().nullable(),
  /** Builder-entered base price. */
  basePriceMinor: z.number().int().nullable(),
  currency: CurrencyCodeSchema,
  /** House Studio house the selections are visualized against, when linked. */
  studioHouseId: UuidSchema.nullable(),
  /** Job created from this contract, when construction starts. */
  jobId: UuidSchema.nullable(),
  signedOn: IsoDateSchema.nullable(),
  selections: z.array(SalesSelectionSchema),
  /** base + priced selections; null when the base price is not entered. */
  totalMinor: z.number().int().nullable(),
  revision: z.number().int(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type SalesContract = z.infer<typeof SalesContractSchema>;

export const SalesContractListSchema = z.object({ items: z.array(SalesContractSchema) });

export const CreateSalesContractRequestSchema = z.object({
  prospectId: UuidSchema,
  communityName: z.string().trim().max(200).nullable().optional(),
  lotLabel: z.string().trim().max(120).nullable().optional(),
  planName: z.string().trim().max(200).nullable().optional(),
  basePriceMinor: z.number().int().min(0).nullable().optional(),
  studioHouseId: UuidSchema.nullable().optional(),
});
export type CreateSalesContractRequest = z.infer<typeof CreateSalesContractRequestSchema>;

export const UpdateSalesContractRequestSchema = z.object({
  status: SalesContractStatusSchema.optional(),
  studioHouseId: UuidSchema.nullable().optional(),
  signedOn: IsoDateSchema.nullable().optional(),
});
export type UpdateSalesContractRequest = z.infer<typeof UpdateSalesContractRequestSchema>;

export const AddSelectionRequestSchema = z.object({
  optionId: UuidSchema,
  note: z.string().trim().max(2000).nullable().optional(),
});
export type AddSelectionRequest = z.infer<typeof AddSelectionRequestSchema>;
