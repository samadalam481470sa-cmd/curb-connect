// General-ledger contracts (blueprint gap 3): chart of accounts, balanced
// journal entries (posted entries immutable; corrections via reversing
// entries), posting periods, trial balance, balance sheet, and P&L — all
// derived from posted lines only. The payments settlement ledger is separate
// and is not folded into these reports.
import { z } from 'zod';
import { UuidSchema } from './common';

export const GlAccountTypeSchema = z.enum(['asset', 'liability', 'equity', 'income', 'expense']);
export const GlDirectionSchema = z.enum(['debit', 'credit']);

export const GlAccountSchema = z.object({
  id: UuidSchema,
  code: z.string(),
  name: z.string(),
  type: GlAccountTypeSchema,
  normalBalance: GlDirectionSchema,
  active: z.boolean(),
  isTemplate: z.boolean(),
  sortOrder: z.number().int(),
  /** Balance from posted lines on the normal side. */
  balanceMinor: z.number().int(),
  revision: z.number().int(),
});
export type GlAccount = z.infer<typeof GlAccountSchema>;

export const CreateGlAccountRequestSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(120),
  type: GlAccountTypeSchema,
  normalBalance: GlDirectionSchema.optional(),
});

export const UpdateGlAccountRequestSchema = z.object({
  code: z.string().trim().min(1).max(20).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  active: z.boolean().optional(),
});

export const GlPeriodSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  startsOn: z.string(),
  endsOn: z.string(),
  status: z.enum(['open', 'closed']),
  closedAt: z.string().nullable(),
  revision: z.number().int(),
});
export type GlPeriod = z.infer<typeof GlPeriodSchema>;

export const CreateGlPeriodRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  startsOn: z.iso.date(),
  endsOn: z.iso.date(),
});

export const GlJournalLineInputSchema = z.object({
  accountId: UuidSchema,
  direction: GlDirectionSchema,
  amountMinor: z.number().int().min(1).max(1_000_000_000_000),
  memo: z.string().trim().max(300).nullable().optional(),
});

export const CreateGlEntryRequestSchema = z.object({
  entryDate: z.iso.date(),
  memo: z.string().trim().min(1).max(500),
  lines: z.array(GlJournalLineInputSchema).min(2).max(100),
});

export const GlJournalLineSchema = z.object({
  id: UuidSchema,
  accountId: UuidSchema,
  accountCode: z.string(),
  accountName: z.string(),
  direction: GlDirectionSchema,
  amountMinor: z.number().int(),
  memo: z.string().nullable(),
});

export const GlJournalEntrySchema = z.object({
  id: UuidSchema,
  entryDate: z.string(),
  memo: z.string(),
  status: z.enum(['draft', 'posted']),
  source: z.enum(['manual', 'reversal']),
  reversalOfId: UuidSchema.nullable(),
  periodId: UuidSchema.nullable(),
  postedAt: z.string().nullable(),
  lines: z.array(GlJournalLineSchema),
  totalDebitsMinor: z.number().int(),
  totalCreditsMinor: z.number().int(),
  balanced: z.boolean(),
  revision: z.number().int(),
  createdAt: z.string(),
});
export type GlJournalEntry = z.infer<typeof GlJournalEntrySchema>;

export const ReverseGlEntryRequestSchema = z.object({
  entryDate: z.iso.date(),
  memo: z.string().trim().min(1).max(500).optional(),
});

export const TrialBalanceRowSchema = z.object({
  accountId: UuidSchema,
  code: z.string(),
  name: z.string(),
  type: GlAccountTypeSchema,
  totalDebitsMinor: z.number().int(),
  totalCreditsMinor: z.number().int(),
  balanceMinor: z.number().int(),
});

export const TrialBalanceResponseSchema = z.object({
  asOf: z.string().nullable(),
  rows: z.array(TrialBalanceRowSchema),
  totalDebitsMinor: z.number().int(),
  totalCreditsMinor: z.number().int(),
  balanced: z.boolean(),
});
export type TrialBalanceResponse = z.infer<typeof TrialBalanceResponseSchema>;

export const BalanceSheetResponseSchema = z.object({
  asOf: z.string().nullable(),
  assetsMinor: z.number().int(),
  liabilitiesMinor: z.number().int(),
  equityMinor: z.number().int(),
  currentEarningsMinor: z.number().int(),
  liabilitiesEquityEarningsMinor: z.number().int(),
  differenceMinor: z.number().int(),
  balanced: z.boolean(),
  assets: z.array(TrialBalanceRowSchema),
  liabilities: z.array(TrialBalanceRowSchema),
  equity: z.array(TrialBalanceRowSchema),
});
export type BalanceSheetResponse = z.infer<typeof BalanceSheetResponseSchema>;

export const ProfitLossResponseSchema = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
  incomeMinor: z.number().int(),
  expenseMinor: z.number().int(),
  netIncomeMinor: z.number().int(),
  income: z.array(TrialBalanceRowSchema),
  expense: z.array(TrialBalanceRowSchema),
});
export type ProfitLossResponse = z.infer<typeof ProfitLossResponseSchema>;
