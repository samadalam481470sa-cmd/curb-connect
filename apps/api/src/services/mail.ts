// Mail adapters (PLT-020, BE-080). Development and tests use DevOutboxMail, which writes each
// message as a JSON file to MAIL_OUTBOX_DIR and sends nothing. SmtpMail is used only when SMTP_URL
// is configured. Messages never carry job photos or signed media URLs (PLT-020 D).
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { BRAND } from '@fieldline/contracts';
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

export function createMailAdapter(config: AppConfig): MailAdapter {
  if (config.mail.smtpUrl && config.mail.from) return new SmtpMail(config.mail.smtpUrl, config.mail.from);
  const dir = isAbsolute(config.mail.outboxDir) ? config.mail.outboxDir : resolve(packageRoot(), config.mail.outboxDir);
  return new DevOutboxMail(dir);
}
