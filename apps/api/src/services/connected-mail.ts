// Sends invoice email from the user's own Outlook (Microsoft Graph sendMail) or Gmail (Gmail API
// messages.send) account, using an access token obtained through that provider's OAuth consent.
// The token is supplied by the caller; this module never stores or logs it.
import type { MailMessage } from './mail';

export type ConnectedMailProvider = 'outlook' | 'gmail';

export const GRAPH_SEND_URL = 'https://graph.microsoft.com/v1.0/me/sendMail';
export const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

const MAX_SUBJECT = 998;

export function assertPlainEmail(address: string): string {
  const value = address.trim();
  if (!/^[^\s@<>,;:"]+@[^\s@<>,;:"]+\.[^\s@<>,;:"]+$/.test(value) || value.length > 254) {
    throw new Error('invalid recipient address');
  }
  return value;
}

/** Strip CR/LF so a subject or header cannot inject extra headers. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').slice(0, MAX_SUBJECT);
}

/** RFC 2047 encoded-word for a non-ASCII subject; plain ASCII passes through. */
export function encodeSubject(subject: string): string {
  const clean = headerSafe(subject);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

/** Builds the RFC 822 message Gmail expects (plain text, UTF-8, base64url-encoded in sendGmail). */
export function buildRfc822(message: MailMessage, from: string): string {
  const to = assertPlainEmail(message.to);
  const sender = assertPlainEmail(from);
  const body = message.text.replace(/\r?\n/g, '\r\n');
  return [
    `From: ${sender}`,
    `To: ${to}`,
    `Subject: ${encodeSubject(message.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
  ].join('\r\n');
}

export function gmailSendBody(message: MailMessage, from: string): { raw: string } {
  return { raw: Buffer.from(buildRfc822(message, from), 'utf8').toString('base64url') };
}

export function graphSendBody(message: MailMessage) {
  return {
    message: {
      subject: headerSafe(message.subject),
      body: { contentType: 'Text', content: message.text },
      toRecipients: [{ emailAddress: { address: assertPlainEmail(message.to) } }],
    },
    saveToSentItems: true,
  };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ConnectedSendResult {
  providerMessageId: string | null;
}

/**
 * Sends one message through the connected account. Graph's sendMail returns 202 with no id, and
 * neither API offers an idempotency key, so the caller must not retry a send that may have succeeded.
 */
export async function sendConnected(
  provider: ConnectedMailProvider,
  accessToken: string,
  message: MailMessage,
  opts: { from: string; fetchImpl?: FetchLike },
): Promise<ConnectedSendResult> {
  if (!accessToken) throw new Error('missing access token');
  const fetchImpl = opts.fetchImpl ?? (fetch as FetchLike);
  const common = {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
  if (provider === 'outlook') {
    const res = await fetchImpl(GRAPH_SEND_URL, {
      method: 'POST',
      headers: common,
      body: JSON.stringify(graphSendBody(message)),
    });
    if (!res.ok) throw new Error(`outlook send failed (HTTP ${res.status})`);
    return { providerMessageId: null };
  }
  const res = await fetchImpl(GMAIL_SEND_URL, {
    method: 'POST',
    headers: common,
    body: JSON.stringify(gmailSendBody(message, opts.from)),
  });
  if (!res.ok) throw new Error(`gmail send failed (HTTP ${res.status})`);
  const json = (await res.json()) as { id?: unknown };
  return { providerMessageId: typeof json.id === 'string' ? json.id : null };
}
