import { z } from 'zod';
import { CurrencyCodeSchema } from './common';
import {
  TemplateBudgetLineSchema,
  TemplateQuestionSchema,
  TemplateScheduleTaskSchema,
} from './templates';

const id = z.uuid();
const minor = z.number().int().nonnegative();
const named = z.object({ id, name: z.string() });
const price = z.object({ currency: CurrencyCodeSchema, amountMinor: minor.nullable() });
const lotStatus = z.enum([
  'held',
  'released',
  'available',
  'reserved',
  'under_contract',
  'sold',
  'closed',
]);
const plan = named.extend({ revision: z.number().int().positive() });
const lot = z.object({
  id,
  communityId: id,
  lotNumber: z.string(),
  status: lotStatus,
  listedPrice: price,
});
const designOption = named.extend({ category: z.string(), price });
const catalog = named.extend({
  revisionId: id,
  revisionNumber: z.number().int().positive(),
  effectiveFrom: z.iso.date().nullable(),
  currency: CurrencyCodeSchema,
});
const questionnaire = z.strictObject({
  requirements: z.string().trim().min(3).max(4000),
  preferredMoveOn: z.iso.date().optional(),
  targetBudgetMinor: minor.optional(),
});
const template = named.extend({
  revision: z.number().int().positive(),
  sourceTemplateId: id,
  lines: z.array(TemplateBudgetLineSchema),
  tasks: z.array(TemplateScheduleTaskSchema),
  questions: z.array(TemplateQuestionSchema),
  laborAssumptions: z.string(),
});
const approvedTemplate = template.pick({
  id: true,
  name: true,
  revision: true,
  sourceTemplateId: true,
});

export const ApproveSalesEstimateTemplate = z.strictObject({
  sourceTemplateId: id,
  laborAssumptions: z.string().trim().min(3).max(4000),
  reason: z.string().trim().min(3).max(1000),
  clientRequestId: id,
});
export const SalesEstimateTemplateControls = z.object({
  sources: z.array(named),
  approved: z.array(approvedTemplate),
});

export const SalesEstimateOptions = z.object({
  opportunityId: id,
  opportunityName: z.string(),
  revision: z.number().int().positive(),
  canCreate: z.boolean(),
  defaultCurrency: CurrencyCodeSchema,
  pricingAsOf: z.iso.date(),
  plans: z.array(plan),
  lots: z.array(lot),
  options: z.array(designOption),
  catalogs: z.array(catalog),
  approvedTemplates: z.array(approvedTemplate),
  existingEstimateId: id.nullable(),
});

export const CreateSalesEstimate = z.strictObject({
  title: z.string().trim().min(3).max(200),
  planId: id.optional(),
  lotId: id.optional(),
  catalogRevisionId: id.optional(),
  templateRevisionId: id.optional(),
  optionIds: z
    .array(id)
    .max(100)
    .refine((ids) => ids.length === new Set(ids).size, 'Select each option once.'),
  questionnaire,
  currency: CurrencyCodeSchema,
  clientRequestId: id,
});

export const SalesEstimateSnapshot = z.object({
  buyerName: z.string(),
  pricingAsOf: z.iso.date(),
  buyerPreferredContact: z.enum(['none', 'email', 'phone']),
  leadRevision: z.number().int().positive(),
  community: named.nullable(),
  plan: plan.nullable(),
  lot: lot.nullable(),
  options: z.array(designOption),
  catalog: catalog.nullable(),
  template: template.nullable(),
  questionnaire,
  defaultLaborRates: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      unit: z.string(),
      unitsPerHour: z.string(),
      crewSize: z.number().int().positive(),
    }),
  ),
});

export const SalesEstimateDraft = z.object({
  id,
  opportunityId: id,
  title: z.string(),
  status: z.literal('draft'),
  currency: CurrencyCodeSchema,
  createdAt: z.iso.datetime(),
  revision: z.number().int().positive(),
  snapshot: SalesEstimateSnapshot,
  currentLotStatus: lotStatus.nullable(),
  lotHold: z.boolean(),
  knownOptionSubtotalMinor: z.string().regex(/^\d+$/),
  unpricedOptionIds: z.array(id),
});
