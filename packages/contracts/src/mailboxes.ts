// Connected mailboxes: a member signs in with Google or Microsoft so invoices are emailed from their
// own Gmail or Outlook address. The tokens live only in the separate mail server (apps/mailer);
// the API and the web app only ever see the address, the provider and the delivery outcome.
//
// Two groups of schemas live here:
//   - the public API (/v1/mailboxes, invoice email fields) used by the web app;
//   - the internal API <-> mail server protocol (/internal/*), signed with MAILER_SHARED_SECRET.
// Pure module: no I/O.
import { z } from 'zod';
import { IsoDateTimeSchema } from './common';

export const MAILBOX_PROVIDERS = ['gmail', 'outlook'] as const;
export const MailboxProviderSchema = z.enum(MAILBOX_PROVIDERS);
export type MailboxProvider = z.infer<typeof MailboxProviderSchema>;

export const MAILBOX_PROVIDER_LABEL: Record<MailboxProvider, string> = {
  gmail: 'Gmail',
  outlook: 'Outlook',
};

/** Same rule the mail server applies before it builds a message. */
export const MailAddressSchema = z
  .string()
  .trim()
  .max(254)
  .regex(/^[^\s@<>,;:"]+@[^\s@<>,;:"]+\.[^\s@<>,;:"]+$/, 'Enter a valid email address.');

export const MailboxSchema = z.object({
  provider: MailboxProviderSchema,
  email: z.string(),
  displayName: z.string().nullable(),
  connectedAt: IsoDateTimeSchema,
  isDefault: z.boolean(),
});
export type Mailbox = z.infer<typeof MailboxSchema>;

export const MailboxListSchema = z.object({
  /** False when the API has no MAILER_URL / MAILER_SHARED_SECRET (feature switched off). */
  available: z.boolean(),
  /** Which providers the mail server has app keys for. */
  providers: z.object({ gmail: z.boolean(), outlook: z.boolean() }),
  defaultProvider: MailboxProviderSchema.nullable(),
  items: z.array(MailboxSchema),
});
export type MailboxList = z.infer<typeof MailboxListSchema>;

export const ConnectMailboxRequestSchema = z.object({ provider: MailboxProviderSchema });
export const ConnectMailboxResponseSchema = z.object({
  /** Full-page navigation target on the mail server; it redirects to Google or Microsoft. */
  url: z.url(),
});
export const SetDefaultMailboxRequestSchema = z.object({ provider: MailboxProviderSchema });
/**
 * Finishes a connection after the Google / Microsoft sign-in. The mail server activates it only
 * when the signed-in member is the one who started it, so a forwarded link connects nothing.
 */
export const ConfirmMailboxRequestSchema = z.object({ pending: z.string().min(20).max(200) });

// ------------------------------------------------------------------ invoice email delivery
export const INVOICE_EMAIL_STATUSES = ['queued', 'sent', 'failed', 'unknown'] as const;
export const InvoiceEmailStatusSchema = z.enum(INVOICE_EMAIL_STATUSES);
export type InvoiceEmailStatus = z.infer<typeof InvoiceEmailStatusSchema>;

export const InvoiceEmailSchema = z.object({
  recipient: z.string(),
  /** Mailbox chosen for this invoice; null = the sender's default mailbox. */
  via: MailboxProviderSchema.nullable(),
  /**
   * queued: waiting for the worker. sent: the provider accepted it. failed: not sent (see error).
   * unknown: the provider stopped answering mid-send, so it may or may not have gone out.
   */
  status: InvoiceEmailStatusSchema.nullable(),
  /** Address it was (or will be) sent from, once known. */
  from: z.string().nullable(),
  sentAt: IsoDateTimeSchema.nullable(),
  error: z.string().nullable(),
});
export type InvoiceEmail = z.infer<typeof InvoiceEmailSchema>;

export const EmailInvoiceRequestSchema = z.object({
  /** Optional: change the recipient before (re)sending. */
  recipientEmail: MailAddressSchema.optional(),
  sendVia: MailboxProviderSchema.optional(),
});

// ------------------------------------------------------------------ internal protocol (API <-> mailer)
/** JWT audience for service calls and for one-time connect tickets. */
export const MAILER_SERVICE_AUDIENCE = 'fieldline-mailer';
export const MAILER_CONNECT_AUDIENCE = 'fieldline-mailer:connect';
export const MAILER_ISSUER = 'fieldline-api';

/** Gmail and Graph both accept a few MB; an invoice PDF is far smaller. */
export const MAILER_MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

export const MailerAttachmentSchema = z.object({
  filename: z
    .string()
    .trim()
    .min(1)
    .max(150)
    .regex(/^[^\\/\r\n"]+$/, 'Attachment names cannot contain slashes, quotes or line breaks.'),
  contentType: z.enum(['application/pdf', 'text/csv', 'text/plain']),
  contentBase64: z.base64(),
});
export type MailerAttachment = z.infer<typeof MailerAttachmentSchema>;

export const MailerSendRequestSchema = z.object({
  /** null = the member's default mailbox. */
  provider: MailboxProviderSchema.nullable(),
  to: MailAddressSchema,
  subject: z.string().trim().min(1).max(250),
  text: z.string().min(1).max(100_000),
  /** Shown as the sender name next to the connected address, e.g. the company name. */
  fromName: z.string().trim().max(120).optional(),
  attachments: z.array(MailerAttachmentSchema).max(5).default([]),
  /**
   * Stable key per delivery attempt. The mail server sends a key at most once: a repeat returns the
   * first outcome, and a key whose send was interrupted is never sent again automatically.
   */
  idempotencyKey: z
    .string()
    .min(8)
    .max(200)
    .regex(/^[A-Za-z0-9:._-]+$/),
});
export type MailerSendRequest = z.infer<typeof MailerSendRequestSchema>;

export const MailerSendResultSchema = z.object({
  status: z.literal('sent'),
  provider: MailboxProviderSchema,
  from: z.string(),
  providerMessageId: z.string().nullable(),
});
export type MailerSendResult = z.infer<typeof MailerSendResultSchema>;

/**
 * Why a send did not happen. `retry` is the only code worth retrying automatically; `unknown`
 * means the provider may have delivered it, so it must not be retried without a person deciding.
 */
export const MAILER_ERROR_CODES = [
  'not_connected',
  'reconnect_required',
  'rejected',
  'retry',
  'unknown',
  'in_progress',
] as const;
export const MailerErrorCodeSchema = z.enum(MAILER_ERROR_CODES);
export type MailerErrorCode = z.infer<typeof MailerErrorCodeSchema>;
export const MailerErrorSchema = z.object({ code: MailerErrorCodeSchema, message: z.string() });

export const MailerMailboxListSchema = MailboxListSchema.omit({ available: true });
