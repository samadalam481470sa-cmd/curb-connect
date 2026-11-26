import { z } from 'zod';
import { CurrencyCodeSchema, MinorUnitsSchema } from './common';
import { EnterpriseBudgetAllocation } from './enterpriseBudgetRevisions';
import { EnterprisePurchaseCostCode } from './enterprisePurchasing';
import { EnterpriseScheduleDate } from './enterpriseSchedule';

const uuid = z.uuid();
const revision = z.number().int().positive();
const minor = MinorUnitsSchema.nonnegative().max(1_000_000_000_000);
const sumMinor = z.string().regex(/^\d+$/);
const instant = z.iso.datetime();

export const CreateEnterpriseBudgetBaseline = z.strictObject({
  currency: CurrencyCodeSchema,
  effectiveOn: EnterpriseScheduleDate,
  clientRequestId: uuid,
});

export const RecordEnterpriseBudgetDraftLine = z.strictObject({
  costCodeId: uuid,
  description: z.string().trim().min(2).max(200),
  amountMinor: minor,
  currency: CurrencyCodeSchema,
  unit: z.enum(['allowance', 'lump_sum', 'each', 'linear_ft', 'square_ft', 'cubic_yd', 'hour']),
  phase: z.string().trim().min(2).max(80),
  fundingSource: z.string().trim().min(2).max(120),
  clientRequestId: uuid,
});

export const ApproveEnterpriseBudgetBaseline = z.strictObject({
  reason: z.string().trim().min(3).max(500),
  clientRequestId: uuid,
});

export const EnterpriseBudgetCostCode = EnterprisePurchaseCostCode.extend({ id: uuid });
export const EnterpriseBudgetLine = RecordEnterpriseBudgetDraftLine.omit({
  clientRequestId: true,
}).extend({
  id: uuid,
  costCode: EnterpriseBudgetCostCode,
  createdAt: instant,
});

export const EnterpriseBudgetBaseline = z.object({
  id: uuid,
  status: z.enum(['draft', 'approved']),
  currency: CurrencyCodeSchema,
  effectiveOn: EnterpriseScheduleDate,
  revision,
  amountMinor: sumMinor,
  approvedAt: instant.nullable(),
  approvalReason: z.string().nullable(),
  createdAt: instant,
  lines: z.array(EnterpriseBudgetLine),
});

export const EnterpriseBudgetSummary = z.object({
  asOf: EnterpriseScheduleDate,
  readAt: instant,
  projectName: z.string(),
  companyCurrency: CurrencyCodeSchema,
  baseline: EnterpriseBudgetBaseline.nullable(),
  allocation: EnterpriseBudgetAllocation.nullable(),
  availableCostCodes: z.array(EnterpriseBudgetCostCode),
  canManageGrants: z.boolean(),
  canCreate: z.boolean(),
  canEditDraft: z.boolean(),
  canApprove: z.boolean(),
});

export const SetEnterpriseBudgetGrant = z.strictObject({
  active: z.boolean(),
  reason: z.string().trim().min(3).max(500),
  clientRequestId: uuid,
});

export const EnterpriseBudgetGrant = SetEnterpriseBudgetGrant.omit({
  clientRequestId: true,
}).extend({
  membershipId: uuid,
  revision,
  createdAt: instant,
});

export const EnterpriseBudgetCreated = EnterpriseBudgetBaseline.pick({
  id: true,
  currency: true,
  effectiveOn: true,
  revision: true,
  createdAt: true,
});

export const EnterpriseBudgetLineReceipt = z.object({ line: EnterpriseBudgetLine, revision });

export const EnterpriseBudgetApproved = z.object({
  budgetId: uuid,
  amountMinor: sumMinor,
  approvedAt: instant,
  reason: z.string(),
  revision,
});
