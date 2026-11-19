// RFC 5322 / MIME message builder for the Gmail API (messages.send takes the raw message). Outlook
// takes JSON instead (see providers.ts), but both are built from the same OutboundMessage.
import { randomBytes } from 'node:crypto';
import type { MailerAttachment } from '@fieldline/contracts';

export interface OutboundMessage {
  to: string;
  subject: string;
  text: string;
  fromName?: string | undefined;
  attachments: MailerAttachment[];
}

const ADDRESS = /^[^\s@<>,;:"]+@[^\s@<>,;:"]+\.[^\s@<>,;:"]+$/;

export function assertPlainEmail(address: string): string {
  const value = address.trim();
  if (!ADDRESS.test(value) || value.length > 254) throw new Error('invalid email address');
  return value;
}

/** Collapse CR/LF so no value can start a new header. */
export function headerSafe(value: string, max = 998): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, max);
}

/** RFC 2047 encoded-word when the value is not plain printable ASCII. */
export function encodeWord(value: string): string {
  const clean = headerSafe(value);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

/** "Name <addr>" with the display name quoted or encoded as needed. */
export function formatAddress(address: string, name?: string): string {
  const addr = assertPlainEmail(address);
  const display = name ? headerSafe(name, 120) : '';
  if (!display) return addr;
  if (/^[\x20-\x7e]*$/.test(display)) {
    return `"${display.replace(/["\\]/g, '')}" <${addr}>`;
  }
  return `${encodeWord(display)} <${addr}>`;
}

/** Base64 wrapped at 76 characters (RFC 2045). */
function wrapBase64(b64: string): string {
  return b64.replace(/(.{76})/g, '$1\r\n');
}

export function buildMime(
  message: OutboundMessage,
  from: string,
  opts: { boundary?: string; date?: Date } = {},
): string {
  const boundary = opts.boundary ?? `fl_${randomBytes(12).toString('hex')}`;
  const headers = [
    `From: ${formatAddress(from, message.fromName)}`,
    `To: ${assertPlainEmail(message.to)}`,
    `Subject: ${encodeWord(message.subject)}`,
    `Date: ${(opts.date ?? new Date()).toUTCString()}`,
    'MIME-Version: 1.0',
  ];
  const textPart = [
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(Buffer.from(message.text.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64')),
  ].join('\r\n');

  if (message.attachments.length === 0) {
    return [...headers, textPart].join('\r\n');
  }
  const parts = [
    textPart,
    ...message.attachments.map((a) => {
      const name = headerSafe(a.filename, 150).replace(/["\\]/g, '');
      return [
        `Content-Type: ${a.contentType}; name="${name}"`,
        `Content-Disposition: attachment; filename="${name}"`,
        'Content-Transfer-Encoding: base64',
        '',
        wrapBase64(a.contentBase64.replace(/\s+/g, '')),
      ].join('\r\n');
    }),
  ];
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    ...parts.map((p) => `--${boundary}\r\n${p}`),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}
