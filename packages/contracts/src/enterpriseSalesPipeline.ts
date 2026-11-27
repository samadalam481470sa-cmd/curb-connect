import { z } from 'zod';
import { CurrencyCodeSchema } from './common';

export const SALES_PIPELINE_STAGES = [
  { id: 'c96f4577-e27b-4d93-b362-730e849a0001', key: 'new', label: 'New' },
  {
    id: 'c96f4577-e27b-4d93-b362-730e849a0002',
    key: 'attempting_contact',
    label: 'Attempting contact',
  },
  { id: 'c96f4577-e27b-4d93-b362-730e849a0003', key: 'qualified', label: 'Qualified' },
  { id: 'c96f4577-e27b-4d93-b362-730e849a0004', key: 'consultation', label: 'Consultation' },
  { id: 'c96f4577-e27b-4d93-b362-730e849a0005', key: 'estimating', label: 'Estimating' },
  { id: 'c96f4577-e27b-4d93-b362-730e849a0006', key: 'proposal_sent', label: 'Proposal sent' },
  { id: 'c96f4577-e27b-4d93-b362-730e849a0007', key: 'negotiation', label: 'Negotiation' },
  { id: 'c96f4577-e27b-4d93-b362-730e849a0008', key: 'contract_sent', label: 'Contract sent' },
  { id: 'c96f4577-e27b-4d93-b362-730e849a0009', key: 'contract_signed', label: 'Contract signed' },
  { id: 'c96f4577-e27b-4d93-b362-730e849a0010', key: 'lost', label: 'Lost' },
  { id: 'c96f4577-e27b-4d93-b362-730e849a0011', key: 'nurture', label: 'Nurture' },
  { id: 'c96f4577-e27b-4d93-b362-730e849a0012', key: 'project_created', label: 'Project created' },
] as const;

const id = z.uuid();
const instant = z.iso.datetime();
const revision = z.number().int().positive();
export const SalesStageKey = z.enum(SALES_PIPELINE_STAGES.map(({ key }) => key));
export type SalesStageKey = z.infer<typeof SalesStageKey>;
export const SalesStage = z.object({ id, key: SalesStageKey, label: z.string() });
const amount = z.string().regex(/^\d{1,16}$/);
export const SalesPipelineSort = z.enum([
  'created_desc',
  'created_asc',
  'name_asc',
  'name_desc',
  'stage_age_desc',
  'stage_age_asc',
  'source_asc',
  'source_desc',
  'community_asc',
  'community_desc',
  'owner_asc',
  'owner_desc',
  'next_activity_asc',
  'next_activity_desc',
  'approved_value_desc',
  'approved_value_asc',
  'probability_desc',
  'probability_asc',
]);
export type SalesPipelineSort = z.infer<typeof SalesPipelineSort>;

export const SalesPipelineFilterFields = z.strictObject({
  sort: SalesPipelineSort.optional(),
  stage: SalesStageKey.optional(),
  sourceId: id.optional(),
  communityId: id.optional(),
  ownerMembershipId: id.optional(),
  lotId: id.optional(),
  search: z.string().trim().min(1).max(160).optional(),
  createdFrom: z.iso.date().optional(),
  createdThrough: z.iso.date().optional(),
  nextActivity: z.enum(['scheduled', 'unscheduled']).optional(),
  minValueMinor: amount.optional(),
  maxValueMinor: amount.optional(),
  currency: CurrencyCodeSchema.optional(),
  consentPurpose: z.enum(['inquiry', 'marketing']).optional(),
  consentChannel: z.enum(['email', 'phone']).optional(),
  consentStatus: z.enum(['granted', 'declined', 'not_recorded']).optional(),
});
export const SalesPipelineFilters = SalesPipelineFilterFields.superRefine((value, ctx) => {
  if (value.createdFrom && value.createdThrough && value.createdFrom > value.createdThrough) {
    ctx.addIssue({
      code: 'custom',
      path: ['createdThrough'],
      message: 'The end date must follow the start date.',
    });
  }
  if ((value.minValueMinor || value.maxValueMinor) && !value.currency) {
    ctx.addIssue({
      code: 'custom',
      path: ['currency'],
      message: 'Choose the currency for the approved value range.',
    });
  }
  if (
    value.minValueMinor &&
    value.maxValueMinor &&
    BigInt(value.minValueMinor) > BigInt(value.maxValueMinor)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['maxValueMinor'],
      message: 'The maximum value must be at least the minimum.',
    });
  }
  const consent = [value.consentPurpose, value.consentChannel, value.consentStatus];
  if (consent.some(Boolean) && !consent.every(Boolean)) {
    ctx.addIssue({
      code: 'custom',
      path: ['consentStatus'],
      message: 'Choose a consent purpose, channel and status.',
    });
  }
});
export const SalesPipelineFilterOptions = z.object({
  sources: z.array(z.object({ id, name: z.string() })),
  communities: z.array(z.object({ id, name: z.string() })),
  owners: z.array(z.object({ id, name: z.string() })),
  lots: z.array(z.object({ id, name: z.string() })),
  currency: CurrencyCodeSchema,
});

export const AdvanceSalesStage = z.strictObject({
  targetStageId: id,
  reason: z.string().trim().min(3).max(1000).optional(),
  clientRequestId: id,
});

export const SalesStageEvent = z.object({
  id,
  from: SalesStage,
  to: SalesStage,
  reason: z.string().nullable(),
  recordedAt: instant,
  previousStageDurationMs: z.number().int().nonnegative(),
  revision,
});

export const SalesPipelineLead = z.object({
  id,
  name: z.string(),
  revision,
  stage: SalesStage,
  stageEnteredAt: instant,
  source: z.object({ id, name: z.string() }),
  community: z.object({ id, name: z.string() }).nullable(),
  owner: z.object({ id, name: z.string() }).nullable(),
  lastActivityAt: instant.nullable(),
  nextActivityAt: instant.nullable(),
  lot: z.object({ id, name: z.string() }).nullable(),
  approvedValue: z.object({ amountMinor: amount, currency: CurrencyCodeSchema }).nullable(),
  probabilityBasisPoints: z.number().int().min(0).max(10000).nullable(),
  daysInStage: z.number().int().nonnegative(),
});

export const SalesOpportunity = SalesPipelineLead.extend({
  estimateId: id.nullable(),
  possibleTransitions: z.array(
    z.object({
      stage: SalesStage,
      blockedReason: z.string().nullable(),
      requiresReason: z.boolean(),
    }),
  ),
  history: z.array(SalesStageEvent),
});

export const SalesPipelinePage = z.object({
  items: z.array(SalesPipelineLead),
  nextCursor: z.string().nullable(),
  counts: z.array(z.object({ stage: SalesStage, count: z.number().int().nonnegative() })),
  readAt: instant,
});

export const SALES_TERMINAL_STAGES = ['lost', 'project_created'] as const;
