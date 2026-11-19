// Sends a plain-text invoice email from the user's own connected Gmail or Outlook account.
import type { Provider } from './db';
import type { FetchLike } from './oauth';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

export const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
export const GRAPH_SEND_URL = 'https://graph.microsoft.com/v1.0/me/sendMail';

const EMAIL_RE = /^[^\s@<>,;:"()[\]\\]+@[^\s@<>,;:"()[\]\\]+\.[^\s@<>,;:"()[\]\\]+$/;

export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

/** Strips CR/LF so a subject cannot add extra headers. */
export function headerSafe(value: string): string {
  return value
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 998);
}

export function encodeSubject(subject: string): string {
  const clean = headerSafe(subject);
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

export function buildRfc822(mail: OutgoingMail, from: string): string {
  if (!isEmail(mail.to)) throw new Error('invalid recipient address');
  if (!isEmail(from)) throw new Error('invalid sender address');
  return [
    `From: ${from}`,
    `To: ${mail.to}`,
    `Subject: ${encodeSubject(mail.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(mail.text.replace(/\r?\n/g, '\r\n'), 'utf8')
      .toString('base64')
      .replace(/.{76}/g, '$&\r\n'),
  ].join('\r\n');
}

export class SendError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * One send attempt. A 401 means the provider refused the token before sending, so the caller may
 * refresh and try again; any other failure must not be retried because the mail may have gone out.
 */
export async function sendOnce(
  provider: Provider,
  fetchImpl: FetchLike,
  accessToken: string,
  mail: OutgoingMail,
  from: string,
): Promise<{ providerMessageId: string | null }> {
  if (!isEmail(mail.to)) throw new SendError('Enter a valid recipient email address.', 400);
  const headers = {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (provider === 'google') {
    const raw = Buffer.from(buildRfc822(mail, from), 'utf8').toString('base64url');
    const res = await fetchImpl(GMAIL_SEND_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ raw }),
    });
    if (!res.ok) throw new SendError(`Gmail refused the message (HTTP ${res.status}).`, res.status);
    const body = (await res.json().catch(() => ({}))) as { id?: unknown };
    return { providerMessageId: typeof body.id === 'string' ? body.id : null };
  }
  const res = await fetchImpl(GRAPH_SEND_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: {
        subject: headerSafe(mail.subject),
        body: { contentType: 'Text', content: mail.text },
        toRecipients: [{ emailAddress: { address: mail.to } }],
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) throw new SendError(`Outlook refused the message (HTTP ${res.status}).`, res.status);
  return { providerMessageId: null };
}
