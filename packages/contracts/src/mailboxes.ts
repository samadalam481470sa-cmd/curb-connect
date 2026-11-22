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

/** Most mailboxes one member can connect in one company (several Gmail and Outlook addresses). */
export const MAILBOX_LIMIT = 10;

/**
 * A mailbox is one address at one provider. Its id is `<provider>:<lowercase address>`, so the same
 * address can never be connected twice. A bare provider (`gmail` / `outlook`) is also accepted
 * wherever a mailbox is chosen: it means "my default mailbox at that provider, else the newest".
 */
export function mailboxId(provider: MailboxProvider, email: string): string {
  return `${provider}:${email.trim().toLowerCase()}`;
}

export const MailboxRefSchema = z
  .string()
  .trim()
  .max(270)
  .regex(
    /^(gmail|outlook)(:[^\s@<>,;:"]+@[^\s@<>,;:"]+\.[^\s@<>,;:"]+)?$/,
    'Choose a connected mailbox.',
  );
export type MailboxRef = z.infer<typeof MailboxRefSchema>;

export function parseMailboxRef(ref: string): { provider: MailboxProvider; email: string | null } {
  const index = ref.indexOf(':');
  const provider = (index === -1 ? ref : ref.slice(0, index)) as MailboxProvider;
  return { provider, email: index === -1 ? null : ref.slice(index + 1).toLowerCase() };
}

export const MailboxSchema = z.object({
  /** `<provider>:<address>`; pass it to choose this mailbox. */
  id: z.string(),
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
  /** The mailbox invoices go out from when none is chosen. */
  defaultMailboxId: z.string().nullable(),
  items: z.array(MailboxSchema),
});
export type MailboxList = z.infer<typeof MailboxListSchema>;

export const ConnectMailboxRequestSchema = z.object({
  provider: MailboxProviderSchema,
  /** Pre-selects this account on the Google / Microsoft page (e.g. the address you signed in with). */
  loginHint: MailAddressSchema.optional(),
});
export const ConnectMailboxResponseSchema = z.object({
  /** Full-page navigation target on the mail server; it redirects to Google or Microsoft. */
  url: z.url(),
});
export const SetDefaultMailboxRequestSchema = z.object({ mailbox: MailboxRefSchema });
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
  /** Mailbox chosen for this invoice (a mailbox id or a provider); null = the sender's default. */
  via: z.string().nullable(),
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
  sendVia: MailboxRefSchema.optional(),
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
  /** A mailbox id or a provider; null = the member's default mailbox. */
  mailbox: MailboxRefSchema.nullable(),
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
  mailboxId: z.string(),
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

/**
 * Inbox search for replies. The mail server looks only for messages FROM the given addresses
 * received after `since`, so a member's other mail is never read or returned.
 */
export const MailerInboxSearchRequestSchema = z.object({
  mailbox: MailboxRefSchema.nullable(),
  from: z.array(MailAddressSchema).min(1).max(40),
  since: IsoDateTimeSchema,
  limit: z.number().int().min(1).max(50).default(30),
});
export type MailerInboxSearchRequest = z.input<typeof MailerInboxSearchRequestSchema>;

export const MailerInboundMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  fromName: z.string().nullable(),
  subject: z.string(),
  text: z.string(),
  receivedAt: IsoDateTimeSchema,
  webLink: z.string().nullable(),
});
export type MailerInboundMessage = z.infer<typeof MailerInboundMessageSchema>;

export const MailerInboxSearchResultSchema = z.object({
  /** read_permission_missing: the mailbox was connected before reply reading existed. */
  status: z.enum(['ok', 'read_permission_missing']),
  mailboxId: z.string(),
  messages: z.array(MailerInboundMessageSchema),
});
export type MailerInboxSearchResult = z.infer<typeof MailerInboxSearchResultSchema>;
