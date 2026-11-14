// Mail adapters (PLT-020, BE-080). Development and tests use DevOutboxMail, which writes each
// message as a JSON file to MAIL_OUTBOX_DIR and sends nothing. SmtpMail is used only when SMTP_URL
// is configured. Messages never carry job photos or signed media URLs (PLT-020 D).
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { BRAND, LEGAL } from '@fieldline/contracts';
import nodemailer from 'nodemailer';
import type { AppConfig } from '../config';
import { packageRoot } from '../storage';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Stable key so a retried job does not produce a second message at the provider. */
  idempotencyKey: string;
}

export interface MailResult {
  providerMessageId: string;
}

export interface MailAdapter {
  readonly name: 'dev-outbox' | 'smtp';
  send(message: MailMessage): Promise<MailResult>;
}

export interface MailFooterOptions {
  appOrigin: string;
  /** Valid physical postal address (street, PO box or registered mail drop). CAN-SPAM 15 U.S.C. 7704. */
  postalAddress: string | undefined;
}

/**
 * Legal footer added to every outgoing message: who sent it, a postal address, why the recipient
 * got it, and a working way to stop notification email (Settings > Notifications, or by email).
 */
export function withLegalFooter(message: MailMessage, opts: MailFooterOptions): MailMessage {
  const origin = opts.appOrigin.replace(/\/$/, '');
  const lines = [
    '',
    '--',
    `Sent by ${BRAND.name} (Samad Alam dba ${BRAND.name}).`,
    opts.postalAddress ? opts.postalAddress : null,
    `You received this email because you have, or were invited to, a ${BRAND.name} company account.`,
    `To stop notification emails, open ${origin}/settings/notifications, or email ${LEGAL.contactEmail} and we will remove you within 10 business days.`,
    `Privacy Policy: ${LEGAL.privacy}`,
  ].filter((line): line is string => line !== null);
  return { ...message, text: `${message.text.replace(/\s+$/, '')}\n${lines.join('\n')}\n` };
}

export class DevOutboxMail implements MailAdapter {
  readonly name = 'dev-outbox' as const;
  constructor(private readonly dir: string) {}

  async send(message: MailMessage): Promise<MailResult> {
    await mkdir(this.dir, { recursive: true });
    const safeKey = message.idempotencyKey.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
    // Same idempotency key -> same file: a retried job overwrites instead of duplicating.
    const file = join(this.dir, `${safeKey}.json`);
    await writeFile(
      file,
      JSON.stringify(
        {
          note: 'DEVELOPMENT ONLY: recorded by the dev mail adapter, not sent.',
          from: `${BRAND.name} <no-reply@fieldline.invalid>`,
          ...message,
          recordedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    return { providerMessageId: `dev-outbox:${safeKey}` };
  }
}

export class SmtpMail implements MailAdapter {
  readonly name = 'smtp' as const;
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;
  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async send(message: MailMessage): Promise<MailResult> {
    const info = await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      messageId: `<${message.idempotencyKey.replace(/[^A-Za-z0-9._-]/g, '')}@fieldline>`,
    });
    return { providerMessageId: String(info.messageId ?? randomUUID()) };
  }
}

/** Wraps an adapter so every message carries the legal footer. */
class FooterMail implements MailAdapter {
  constructor(
    private readonly inner: MailAdapter,
    private readonly opts: MailFooterOptions,
  ) {}
  get name() {
    return this.inner.name;
  }
  send(message: MailMessage): Promise<MailResult> {
    return this.inner.send(withLegalFooter(message, this.opts));
  }
}

export function createMailAdapter(config: AppConfig): MailAdapter {
  const footer: MailFooterOptions = {
    appOrigin: config.appOrigin,
    postalAddress: config.mail.postalAddress,
  };
  if (config.mail.smtpUrl && config.mail.from) {
    if (!config.mail.postalAddress) {
      console.warn(
        '[mail] MAIL_POSTAL_ADDRESS is not set. Commercial email must include a valid postal address (CAN-SPAM).',
      );
    }
    return new FooterMail(new SmtpMail(config.mail.smtpUrl, config.mail.from), footer);
  }
  const dir = isAbsolute(config.mail.outboxDir)
    ? config.mail.outboxDir
    : resolve(packageRoot(), config.mail.outboxDir);
  return new FooterMail(new DevOutboxMail(dir), footer);
}
