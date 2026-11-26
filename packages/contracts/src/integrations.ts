// Integrations contracts (builder operations section): QuickBooks Online sync and the B2B
// payments rail, both gated scaffolding. Neither is connected today — QuickBooks needs the
// owner's Intuit OAuth app, and moving money needs a regulated payments provider (Stripe
// Connect, Dwolla, …) plus compliance decisions only the owner can make. These contracts
// describe the honest states the API reports until then; nothing here moves money or syncs
// anything. Same pattern as the voice front desk: off until connected, never pretending.
import { z } from 'zod';
import { IsoDateTimeSchema } from './common';

// ---------------------------------------------------------------- QuickBooks Online

export const QuickBooksStatusSchema = z.object({
  state: z.enum(['connected', 'not_connected', 'misconfigured']),
  /** Env vars still missing, named so the owner knows exactly what to set. */
  missing: z.array(z.string()),
  message: z.string(),
  /** Last successful sync time; null until a sync has ever run. */
  lastSyncedAt: IsoDateTimeSchema.nullable(),
});
export type QuickBooksStatus = z.infer<typeof QuickBooksStatusSchema>;

export const QuickBooksSyncResultSchema = z.object({
  state: z.enum(['ok', 'not_connected']),
  message: z.string(),
  /** Records pushed/pulled; 0 when not connected (nothing ran). */
  pushed: z.number().int(),
  pulled: z.number().int(),
});
export type QuickBooksSyncResult = z.infer<typeof QuickBooksSyncResultSchema>;

// ---------------------------------------------------------------- payments rail

/** Payout rails the payments provider can use (distinct from invoice PAYMENT_METHODS). */
export const PAYOUT_METHODS = ['ach', 'wire', 'e_check', 'virtual_card', 'real_time'] as const;
export const PayoutMethodSchema = z.enum(PAYOUT_METHODS);
export type PayoutMethod = z.infer<typeof PayoutMethodSchema>;

export const PaymentsRailStatusSchema = z.object({
  provider: z.string().nullable(),
  state: z.enum(['connected', 'not_connected', 'unsupported_provider']),
  /** Env vars still missing, named so the owner knows exactly what to set. */
  missing: z.array(z.string()),
  message: z.string(),
  /** Whether payouts release only after a lien waiver is on file (owner setting). */
  lienWaiverGating: z.boolean(),
  /** Whether the early-pay option is offered to payees (owner setting). */
  earlyPayEnabled: z.boolean(),
});
export type PaymentsRailStatus = z.infer<typeof PaymentsRailStatusSchema>;

export const PayoutRequestSchema = z.object({
  /** The AP invoice being paid. */
  apInvoiceId: z.uuid(),
  method: PayoutMethodSchema,
  /** Payee-facing language for payment notices. */
  language: z.enum(['en', 'es']).default('en'),
});
export type PayoutRequest = z.infer<typeof PayoutRequestSchema>;

export const PayoutResultSchema = z.object({
  state: z.enum(['queued', 'not_connected', 'blocked']),
  message: z.string(),
});
export type PayoutResult = z.infer<typeof PayoutResultSchema>;
