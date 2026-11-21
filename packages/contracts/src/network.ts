// ConstructionOS network exchange (blueprint workstreams 06-09, pages 004/006/082/122/142/162).
//
// Two independent companies connect through an explicit, workflow-scoped grant; work is shared as a
// project pair; an issued invoice travels to the recipient's own bill workflow, where it is viewed,
// approved or disputed, and paid. The issuer's books and the recipient's books are separate rows in
// separate tenants: only the fields listed here cross the boundary.
//
// Pure module: no I/O, no database access. The API owns persistence and authorization, the web app
// reads the same machine to decide which actions to offer.
import { z } from 'zod';
import {
  pageOf,
  CurrencyCodeSchema,
  DecimalStringSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  MinorUnitsSchema,
  MoneySchema,
  RateStringSchema,
  ResourceMetaSchema,
  UuidSchema,
} from './common';
import * as E from './enums';
import { InvoiceEmailSchema, MailAddressSchema, MailboxRefSchema } from './mailboxes';
import { defineStateMachine } from './state-machine';

const Name = z.string().trim().min(1).max(200);

// ================================================================ invoice exchange lifecycle
/**
 * OPS-068 + workstream 07/08: the delivery lifecycle of an invoice *between companies*. The issuer's
 * accounting status (draft/issued/paid/void) and the recipient's decision are distinct on purpose:
 * a bill can be disputed while the issuer still shows the invoice as issued and unpaid.
 */
export const networkInvoiceMachine = defineStateMachine({
  name: 'network_invoice',
  states: E.NETWORK_INVOICE_STATUSES,
  initial: 'draft',
  transitions: {
    draft: ['sent', 'void'],
    sent: ['viewed', 'approved', 'disputed', 'void'],
    viewed: ['approved', 'disputed', 'void'],
    approved: ['paid', 'disputed'],
    disputed: ['resolved', 'void'],
    resolved: ['approved', 'paid'],
    paid: [],
    void: [],
  },
});

/** Actions the recipient may take on a bill in a given state (mirrors billActions() in the API). */
export function nextBillActions(status: E.BillStatus): readonly ('approve' | 'dispute' | 'pay')[] {
  switch (status) {
    case 'received':
      return ['approve', 'dispute'];
    case 'approved':
      return ['pay', 'dispute'];
    default:
      return [];
  }
}

// ================================================================ directory and connections
/** Public card shown in the opt-in directory. Never includes financial or contact records. */
export const CompanyCardSchema = z.object({
  orgId: UuidSchema,
  displayName: z.string(),
  slug: z.string(),
  productLines: z.array(E.ProductLineSchema),
  serviceArea: z.string().nullable(),
  directoryOptIn: z.boolean(),
  /** Existing relationship from the caller's side, if any. */
  connectionStatus: E.ConnectionStatusSchema.nullable(),
});
export type CompanyCard = z.infer<typeof CompanyCardSchema>;

export const CompanyDirectoryResponseSchema = pageOf(CompanyCardSchema);

export const ConnectionSchema = ResourceMetaSchema.extend({
  partnerOrgId: UuidSchema,
  partnerDisplayName: z.string(),
  partnerSlug: z.string(),
  direction: E.ConnectionDirectionSchema,
  status: E.ConnectionStatusSchema,
  scopes: z.array(E.ConnectionScopeSchema),
  message: z.string().nullable(),
  respondedAt: IsoDateTimeSchema.nullable(),
  revokedAt: IsoDateTimeSchema.nullable(),
});
export type Connection = z.infer<typeof ConnectionSchema>;
export const ConnectionListSchema = pageOf(ConnectionSchema);

export const CreateConnectionRequestSchema = z.object({
  partnerOrgId: UuidSchema,
  /** What the requester asks to exchange. Invoices is the launch scope. */
  scopes: z.array(E.ConnectionScopeSchema).min(1).max(3).default(['invoices']),
  message: z.string().max(1000).optional(),
});
export type CreateConnectionRequest = z.infer<typeof CreateConnectionRequestSchema>;

export const ConnectionDecisionRequestSchema = z.object({
  note: z.string().max(1000).optional(),
});

/** Updates the asker's own directory listing (workstream 06: opt-in, moderated over time). */
export const UpdateDirectoryListingRequestSchema = z.object({
  directoryOptIn: z.boolean(),
  serviceArea: z.string().max(200).nullable().optional(),
});

// ================================================================ shared projects
export const NetworkProjectSchema = ResourceMetaSchema.extend({
  reference: z.string(),
  name: z.string(),
  clientName: z.string().nullable(),
  siteAddress: z.string().nullable(),
  status: E.NetworkProjectStatusSchema,
  /** Which company leads the work; the partner sees the mirrored row. */
  side: z.enum(['lead', 'partner']),
  partnerOrgId: UuidSchema,
  partnerDisplayName: z.string(),
  contractValue: MoneySchema.nullable(),
});
export type NetworkProject = z.infer<typeof NetworkProjectSchema>;
export const NetworkProjectListSchema = pageOf(NetworkProjectSchema);

export const CreateNetworkProjectRequestSchema = z.object({
  connectionId: UuidSchema,
  name: Name,
  clientName: z.string().max(200).optional(),
  siteAddress: z.string().max(300).optional(),
  contractValueMinor: MinorUnitsSchema.nonnegative().optional(),
  currency: CurrencyCodeSchema.optional(),
});
export type CreateNetworkProjectRequest = z.infer<typeof CreateNetworkProjectRequestSchema>;

// ================================================================ issued invoices (receivable)
export const NetworkInvoiceLineInputSchema = z.object({
  description: z.string().trim().min(1).max(500),
  /** Canonical decimal quantity; converted to minor units with round-half-up at the line level. */
  quantity: DecimalStringSchema.refine((v) => Number(v) > 0, 'quantity must be positive'),
  unit: E.PricingUnitSchema.default('each'),
  unitPriceMinor: MinorUnitsSchema.nonnegative(),
});
export type NetworkInvoiceLineInput = z.infer<typeof NetworkInvoiceLineInputSchema>;

export const NetworkInvoiceLineSchema = NetworkInvoiceLineInputSchema.extend({
  amountMinor: MinorUnitsSchema.nonnegative(),
});
export type NetworkInvoiceLine = z.infer<typeof NetworkInvoiceLineSchema>;

/** A person or business on an invoice (the "From" or "Bill To" block). */
export const InvoicePartySchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: MailAddressSchema.optional(),
  street: z.string().trim().max(200).optional(),
  cityState: z.string().trim().max(200).optional(),
  zip: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(40).optional(),
  mobile: z.string().trim().max(40).optional(),
  fax: z.string().trim().max(40).optional(),
  businessNumber: z.string().trim().max(60).optional(),
});
export type InvoiceParty = z.infer<typeof InvoicePartySchema>;

/** Invoice-level discount, applied to the subtotal before tax. Flat values are in major units. */
export const InvoiceDiscountSchema = z.object({
  type: z.enum(['percent', 'flat']),
  value: z.string().regex(/^\d{1,9}(\.\d{1,4})?$/, 'Enter a number such as 10 or 25.50'),
});
export type InvoiceDiscount = z.infer<typeof InvoiceDiscountSchema>;

/** One payment in a payment schedule: a share of the invoice total due on a date. */
export const InvoicePaymentSchema = z.object({
  label: z.string().trim().min(1).max(80),
  dueOn: IsoDateSchema,
  /** Share of the total, e.g. "50" for half. The shares add up to 100. */
  percent: z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, 'Enter a percent such as 50 or 33.33'),
});
export type InvoicePayment = z.infer<typeof InvoicePaymentSchema>;

/** Splits a total across payments by percent. The last payment takes the rounding remainder. */
export function paymentScheduleAmounts(
  totalMinor: number,
  payments: readonly { percent: string }[],
): number[] {
  let used = 0;
  return payments.map((payment, index) => {
    if (index === payments.length - 1) return totalMinor - used;
    const amount = moneyRound((totalMinor * Number(payment.percent)) / 100);
    used += amount;
    return amount;
  });
}

export const CreateNetworkInvoiceRequestSchema = z
  .object({
    /** A connected Field Pro company. Leave out and use billTo to bill an ordinary customer. */
    recipientOrgId: UuidSchema.optional(),
    /** An ordinary customer (homeowner or business) who is not on Field Pro. */
    billTo: InvoicePartySchema.optional(),
    /** The sender block printed on the invoice. Defaults to the company profile. */
    from: InvoicePartySchema.optional(),
    /** Heading printed on the document, e.g. "Invoice". */
    title: z.string().trim().min(1).max(60).optional(),
    /** Payment terms label, e.g. "On Receipt" or "Net 30". */
    terms: z.string().trim().max(60).optional(),
    issuedOn: IsoDateSchema.optional(),
    discount: InvoiceDiscountSchema.optional(),
    /** Optional deposit / installment plan. Shares must add up to 100. */
    paymentSchedule: z.array(InvoicePaymentSchema).max(12).optional(),
    projectId: UuidSchema.optional(),
    dueOn: IsoDateSchema,
    memo: z.string().max(2000).optional(),
    /** Percentage rate as a decimal string, e.g. "0.0825". */
    taxRate: RateStringSchema.default('0'),
    lines: z.array(NetworkInvoiceLineInputSchema).min(1).max(100),
    /** Where the invoice email goes. Without it the invoice is only delivered inside Field Pro. */
    recipientEmail: MailAddressSchema.optional(),
    /** Mailbox to send from; omitted = the sender's default connected mailbox. */
    sendVia: MailboxRefSchema.optional(),
    /**
     * Send automatically: issue the invoice right after it is created and, when recipientEmail is
     * set, email it with the PDF from the chosen mailbox. False keeps it as a draft.
     */
    autoSend: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (!value.recipientOrgId === !value.billTo) {
      ctx.addIssue({
        code: 'custom',
        path: ['billTo'],
        message: 'Choose either a connected company or a customer to bill.',
      });
    }
    if (value.paymentSchedule && value.paymentSchedule.length > 0) {
      const sum = value.paymentSchedule.reduce((acc, p) => acc + Number(p.percent), 0);
      if (Math.abs(sum - 100) > 0.001) {
        ctx.addIssue({
          code: 'custom',
          path: ['paymentSchedule'],
          message: 'Payment shares must add up to 100%.',
        });
      }
    }
    if (value.billTo && value.projectId) {
      ctx.addIssue({
        code: 'custom',
        path: ['projectId'],
        message: 'Shared projects only apply to invoices for connected companies.',
      });
    }
  });
export type CreateNetworkInvoiceRequest = z.infer<typeof CreateNetworkInvoiceRequestSchema>;

export const IssuedInvoiceSchema = ResourceMetaSchema.extend({
  number: z.string(),
  status: E.InvoiceStatusSchema,
  /** Recipient-facing delivery state; 'draft' means it has not left the company. */
  deliveryStatus: E.NetworkInvoiceStatusSchema,
  recipientOrgId: UuidSchema.nullable(),
  recipientName: z.string().nullable(),
  projectId: UuidSchema.nullable(),
  projectName: z.string().nullable(),
  currency: CurrencyCodeSchema,
  subtotalMinor: MinorUnitsSchema,
  taxMinor: MinorUnitsSchema,
  totalMinor: MinorUnitsSchema,
  amountPaidMinor: MinorUnitsSchema,
  issuedOn: IsoDateSchema.nullable(),
  dueOn: IsoDateSchema.nullable(),
  memo: z.string().nullable(),
  lines: z.array(NetworkInvoiceLineSchema),
  /** Customer block for invoices to someone who is not on Field Pro. */
  billTo: InvoicePartySchema.nullable().optional(),
  from: InvoicePartySchema.nullable().optional(),
  title: z.string().nullable().optional(),
  terms: z.string().nullable().optional(),
  discount: InvoiceDiscountSchema.nullable().optional(),
  discountMinor: MinorUnitsSchema.optional(),
  paymentSchedule: z.array(InvoicePaymentSchema).nullable().optional(),
  disputeReason: z.string().nullable(),
  approvedAt: IsoDateTimeSchema.nullable(),
  sentAt: IsoDateTimeSchema.nullable(),
  /** Email copy sent from the member's connected Gmail or Outlook; null when none was asked for. */
  email: InvoiceEmailSchema.nullable(),
});
export type IssuedInvoice = z.infer<typeof IssuedInvoiceSchema>;
export const IssuedInvoiceListSchema = pageOf(IssuedInvoiceSchema);

export const SendInvoiceRequestSchema = z.object({
  /** Optional: only connections with the invoices scope can receive. */
  connectionId: UuidSchema.optional(),
  message: z.string().max(2000).optional(),
  /** Also email it (PDF attached) to this address from the sender's connected mailbox. */
  recipientEmail: MailAddressSchema.optional(),
  sendVia: MailboxRefSchema.optional(),
});

// ================================================================ received bills (payable)
export const BillLineSchema = NetworkInvoiceLineInputSchema.pick({
  description: true,
  quantity: true,
  unit: true,
  unitPriceMinor: true,
}).extend({ amountMinor: MinorUnitsSchema.nonnegative() });
export type BillLine = z.infer<typeof BillLineSchema>;

export const BillSchema = ResourceMetaSchema.extend({
  /** The issuer's invoice id. Kept for reconciliation; the issuer's tenant is not reachable from here. */
  invoiceId: UuidSchema,
  issuerOrgId: UuidSchema,
  issuerName: z.string(),
  issuerSlug: z.string(),
  number: z.string(),
  projectName: z.string().nullable(),
  status: E.BillStatusSchema,
  currency: CurrencyCodeSchema,
  subtotalMinor: MinorUnitsSchema,
  taxMinor: MinorUnitsSchema,
  totalMinor: MinorUnitsSchema,
  issuedOn: IsoDateSchema.nullable(),
  dueOn: IsoDateSchema.nullable(),
  memo: z.string().nullable(),
  lines: z.array(BillLineSchema),
  disputeReason: z.string().nullable(),
  approvedAt: IsoDateTimeSchema.nullable(),
  paidAt: IsoDateTimeSchema.nullable(),
});
export type Bill = z.infer<typeof BillSchema>;
export const BillListSchema = pageOf(BillSchema);

export const ApproveBillRequestSchema = z.object({
  comment: z.string().max(1000).optional(),
});

/** A dispute must say what is wrong: the issuer cannot fix an unexplained rejection. */
export const DisputeBillRequestSchema = z.object({
  reason: z.string().trim().min(10).max(2000),
});

// ================================================================ payment links and settlement
export const CreatePaymentLinkRequestSchema = z.object({
  /** Hours the link stays open. The provider session, not this row, owns card data. */
  expiresInHours: z.coerce.number().int().min(1).max(720).default(72),
});
export const PaymentLinkSchema = z.object({
  id: UuidSchema,
  billId: UuidSchema,
  provider: E.PaymentProviderSchema,
  status: E.PaymentLinkStatusSchema,
  /** Reference shown to the AP clerk; not a secret and never a card token. */
  providerReference: z.string(),
  amount: MoneySchema,
  /** Relative URL of the bill this link refers to. */
  url: z.string(),
  expiresAt: IsoDateTimeSchema,
  paidAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type PaymentLink = z.infer<typeof PaymentLinkSchema>;

/**
 * Settlement is recorded from a verified provider event in production. Until a processor is
 * configured the only accepted source is an explicit manual/stand-in settlement, which the API
 * labels as such in the audit log and never claims as a card charge.
 */
export const RecordSettlementRequestSchema = z.object({
  method: z.enum(['bank_transfer', 'check', 'cash', 'card_stand_in']),
  reference: z.string().max(200).optional(),
  paidOn: IsoDateSchema.optional(),
});

export const LedgerEntrySchema = z.object({
  id: UuidSchema,
  transactionId: UuidSchema,
  account: E.LedgerAccountSchema,
  direction: E.LedgerDirectionSchema,
  amount: MoneySchema,
  invoiceId: UuidSchema.nullable(),
  memo: z.string().nullable(),
  postedAt: IsoDateTimeSchema,
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export const LedgerResponseSchema = z.object({
  entries: z.array(LedgerEntrySchema),
  totals: z.object({
    debitsMinor: MinorUnitsSchema,
    creditsMinor: MinorUnitsSchema,
    currency: CurrencyCodeSchema,
    /** True when debits equal credits in the returned window; the UI shows it plainly. */
    balanced: z.boolean(),
  }),
});

// ================================================================ pure calculation helpers
/** Rounds half-up away from zero for non-negative money amounts, all in integer cents. */
export function moneyRound(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value) + Number.EPSILON);
}

/**
 * Line amount in minor units. Quantity is a decimal string so 2.5 hours at $80.00 is exactly
 * 20000 cents; the fraction is rounded once, at the line, never accumulated as a float.
 */
export function lineAmountMinor(quantity: string, unitPriceMinor: number): number {
  const q = Number(quantity);
  if (!Number.isFinite(q) || q <= 0) throw new Error(`invalid quantity: ${quantity}`);
  if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 0) {
    throw new Error(`invalid unit price: ${unitPriceMinor}`);
  }
  return moneyRound(q * unitPriceMinor);
}

/** Subtotal, tax and total for a set of lines. Tax is applied to the subtotal, rounded once. */
/**
 * Totals with an invoice-level discount taken off the subtotal before tax. The discount never
 * goes below zero or above the subtotal.
 */
export function invoiceTotalsWithDiscount(
  lines: readonly { quantity: string; unitPriceMinor: number }[],
  taxRate: string,
  discount: InvoiceDiscount | undefined | null,
): {
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  amounts: number[];
} {
  const base = invoiceTotals(lines, taxRate);
  let discountMinor = 0;
  if (discount) {
    const value = Number(discount.value);
    discountMinor =
      discount.type === 'percent'
        ? moneyRound((base.subtotalMinor * Math.min(value, 100)) / 100)
        : moneyRound(value * 100);
    discountMinor = Math.max(0, Math.min(discountMinor, base.subtotalMinor));
  }
  const taxable = base.subtotalMinor - discountMinor;
  const taxMinor = moneyRound(taxable * Number(taxRate));
  return {
    subtotalMinor: base.subtotalMinor,
    discountMinor,
    taxMinor,
    totalMinor: taxable + taxMinor,
    amounts: base.amounts,
  };
}

export function invoiceTotals(
  lines: readonly { quantity: string; unitPriceMinor: number }[],
  taxRate: string,
): { subtotalMinor: number; taxMinor: number; totalMinor: number; amounts: number[] } {
  const amounts = lines.map((l) => lineAmountMinor(l.quantity, l.unitPriceMinor));
  const subtotalMinor = amounts.reduce((sum, a) => sum + a, 0);
  const rate = Number(taxRate);
  if (!Number.isFinite(rate) || rate < 0 || rate >= 1)
    throw new Error(`invalid tax rate: ${taxRate}`);
  const taxMinor = moneyRound(subtotalMinor * rate);
  return { subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor, amounts };
}

/** Status of an invoice brought in from another invoice app. */
export const IMPORTED_INVOICE_STATUSES = [
  'draft',
  'sent',
  'partially_paid',
  'paid',
  'void',
] as const;
export const ImportedInvoiceStatusSchema = z.enum(IMPORTED_INVOICE_STATUSES);
export type ImportedInvoiceStatus = z.infer<typeof ImportedInvoiceStatusSchema>;

/** One invoice from another app's export (CSV or pasted rows), already mapped to our fields. */
export const ImportedInvoiceSchema = z.object({
  /** The number it had in the other app. Kept as is; a number that already exists is skipped. */
  number: z.string().trim().min(1).max(60),
  clientName: z.string().trim().min(1).max(200),
  clientEmail: MailAddressSchema.optional(),
  issuedOn: IsoDateSchema.optional(),
  dueOn: IsoDateSchema.optional(),
  status: ImportedInvoiceStatusSchema,
  totalMinor: MinorUnitsSchema.nonnegative(),
  taxMinor: MinorUnitsSchema.nonnegative().default(0),
  amountPaidMinor: MinorUnitsSchema.nonnegative().default(0),
  memo: z.string().max(2000).optional(),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(500),
        quantity: DecimalStringSchema.refine((v) => Number(v) > 0, 'quantity must be positive'),
        unitPriceMinor: MinorUnitsSchema.nonnegative(),
      }),
    )
    .max(100)
    .default([]),
});
export type ImportedInvoice = z.infer<typeof ImportedInvoiceSchema>;

export const ImportInvoicesRequestSchema = z.object({
  /** Name of the app the invoices came from, as the user gave it (e.g. "Invoice Simple"). */
  source: z.string().trim().min(1).max(60),
  invoices: z.array(ImportedInvoiceSchema).min(1).max(200),
});
export type ImportInvoicesRequest = z.infer<typeof ImportInvoicesRequestSchema>;

export const ImportInvoicesResponseSchema = z.object({
  imported: z.number().int().nonnegative(),
  skipped: z.array(z.object({ number: z.string(), reason: z.string() })),
});
export type ImportInvoicesResponse = z.infer<typeof ImportInvoicesResponseSchema>;

/**
 * Someone you can bill: a saved client (added automatically from Bill To and from imports) or a
 * company connected to you in Network.
 */
export const InvoiceClientSchema = z.object({
  kind: z.enum(['customer', 'company']),
  /** Customer id, or the connected company's org id. */
  id: UuidSchema,
  name: z.string(),
  party: InvoicePartySchema.nullable(),
  lastUsedAt: z.string(),
});
export type InvoiceClient = z.infer<typeof InvoiceClientSchema>;
export const InvoiceClientListSchema = z.object({ items: z.array(InvoiceClientSchema) });
