import { describe, expect, it } from 'vitest';
import {
  buildRfc822,
  encodeSubject,
  GMAIL_SEND_URL,
  GRAPH_SEND_URL,
  gmailSendBody,
  graphSendBody,
  sendConnected,
  type FetchLike,
} from './connected-mail';

const message = {
  to: 'owner@example.test',
  subject: 'Invoice INV-100',
  text: 'Line one\nLine two',
  idempotencyKey: 'k1',
};

function fakeFetch(status: number, body: unknown = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  return { fn, calls };
}

describe('connected mail', () => {
  it('builds an RFC 822 message with CRLF and a single header block', () => {
    const raw = buildRfc822(message, 'me@example.test');
    expect(raw).toContain('To: owner@example.test\r\n');
    expect(raw).toContain('Subject: Invoice INV-100\r\n');
    expect(raw).toContain('Line one\r\nLine two');
  });

  it('round-trips a Gmail body through base64url', () => {
    const { raw } = gmailSendBody(message, 'me@example.test');
    expect(raw).not.toMatch(/[+/=]/);
    expect(Buffer.from(raw, 'base64url').toString('utf8')).toContain('Subject: Invoice INV-100');
  });

  it('encodes non-ASCII subjects and strips header injection', () => {
    expect(encodeSubject('Factura — 2026')).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    expect(encodeSubject('a\r\nBcc: x@y.test')).toBe('a Bcc: x@y.test');
  });

  it('rejects malformed addresses', () => {
    expect(() => graphSendBody({ ...message, to: 'a@b' })).toThrow(/invalid recipient/);
    expect(() => buildRfc822(message, 'bad address')).toThrow(/invalid recipient/);
  });

  it('posts Graph sendMail with bearer auth and a text body', async () => {
    const { fn, calls } = fakeFetch(202);
    const result = await sendConnected('outlook', 'tok', message, {
      from: 'me@example.test',
      fetchImpl: fn,
    });
    expect(result.providerMessageId).toBeNull();
    expect(calls[0]?.url).toBe(GRAPH_SEND_URL);
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const sent = JSON.parse(String(calls[0]?.init.body));
    expect(sent.message.toRecipients[0].emailAddress.address).toBe('owner@example.test');
  });

  it('posts Gmail messages.send and returns the message id', async () => {
    const { fn, calls } = fakeFetch(200, { id: 'msg-9' });
    const result = await sendConnected('gmail', 'tok', message, {
      from: 'me@example.test',
      fetchImpl: fn,
    });
    expect(result.providerMessageId).toBe('msg-9');
    expect(calls[0]?.url).toBe(GMAIL_SEND_URL);
  });

  it('reports provider failures without echoing the token', async () => {
    const { fn } = fakeFetch(401, { error: 'expired' });
    await expect(
      sendConnected('gmail', 'secret-token', message, { from: 'me@example.test', fetchImpl: fn }),
    ).rejects.toThrow(/gmail send failed \(HTTP 401\)/);
  });

  it('refuses to send without a token', async () => {
    await expect(
      sendConnected('outlook', '', message, { from: 'me@example.test' }),
    ).rejects.toThrow(/missing access token/);
  });
});
