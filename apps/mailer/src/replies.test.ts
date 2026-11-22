import { describe, expect, it } from 'vitest';
import { gmailSearch, graphSearch, htmlToText, parseFromHeader } from './providers';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('reply search helpers', () => {
  it('parses From headers', () => {
    expect(parseFromHeader('"Bid Desk" <Bids@Acme.com>')).toEqual({
      email: 'bids@acme.com',
      name: 'Bid Desk',
    });
    expect(parseFromHeader('ops@acme.com')).toEqual({ email: 'ops@acme.com', name: null });
  });

  it('turns html into text', () => {
    expect(htmlToText('<p>Price is $4,500</p><script>x</script>').trim()).toBe('Price is $4,500');
  });

  it('gmail returns only messages from the asked senders', async () => {
    const urls: string[] = [];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      if (url.includes('?q=') || url.includes('&q=') || url.includes('messages?'))
        return json({ messages: [{ id: 'm1' }, { id: 'm2' }] });
      const id = url.includes('/m1') ? 'm1' : 'm2';
      return json({
        id,
        threadId: 't' + id,
        internalDate: '1795000000000',
        payload: {
          headers: [
            { name: 'From', value: id === 'm1' ? 'Bids <bids@acme.com>' : 'spam@other.com' },
            { name: 'Subject', value: 'Re: concrete work' },
          ],
          mimeType: 'text/plain',
          body: { data: Buffer.from('We can do it for $12,000').toString('base64url') },
        },
      });
    };
    const out = await gmailSearch(fetchImpl, 'tok', 'me@x.com', {
      from: ['bids@acme.com'],
      since: new Date('2026-11-01T00:00:00Z'),
      limit: 10,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toContain('$12,000');
    expect(urls[0]).toContain('from%3A%28bids%40acme.com%29');
  });

  it('outlook builds a sender filter', async () => {
    let seen = '';
    const out = await graphSearch(
      async (url) => {
        seen = decodeURIComponent(url);
        return json({
          value: [
            {
              id: 'a',
              subject: 'Re: hi',
              receivedDateTime: '2026-11-21T10:00:00Z',
              body: { contentType: 'text', content: 'Interested' },
              from: { emailAddress: { address: 'Owner@Co.com', name: 'Owner' } },
            },
          ],
        });
      },
      'tok',
      { from: ["o'neil@co.com"], since: new Date('2026-11-01T00:00:00Z'), limit: 5 },
    );
    expect(seen).toContain("from/emailAddress/address eq 'o''neil@co.com'");
    expect(out[0]!.from).toBe('owner@co.com');
  });
});
