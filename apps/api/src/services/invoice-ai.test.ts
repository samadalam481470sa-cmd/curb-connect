import { describe, expect, it, vi } from 'vitest';
import { invoiceAiStatus, readScannedInvoice } from './invoice-ai';
import type { FetchLike, OpenModelSettings } from './open-model';

const home: OpenModelSettings = {
  baseUrl: 'http://home-ai.test/v1',
  apiKey: undefined,
  model: 'home-model',
};
const open: OpenModelSettings = {
  baseUrl: 'http://open.test/v1',
  apiKey: 'k',
  model: 'open-model',
};
const input = { text: 'read this invoice', image: null };

function okFetch(reply: string): FetchLike {
  return async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
}

describe('invoice AI gate (item 10)', () => {
  it('reports honest status with no URLs or keys', () => {
    expect(invoiceAiStatus({ homeAi: null, openModel: null })).toEqual({
      homeAiServer: 'not_configured',
      backupModel: 'not_configured',
      aiReading: false,
    });
    expect(invoiceAiStatus({ homeAi: home, openModel: null }).aiReading).toBe(true);
  });

  it('sends nothing when no AI server is configured', async () => {
    const fetchImpl = vi.fn(okFetch('{}'));
    await expect(
      readScannedInvoice({ homeAi: null, openModel: null }, input, fetchImpl),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('prefers the always-on home AI server', async () => {
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      urls.push(String(url));
      return okFetch('{"total": 10}')(url);
    };
    const answer = await readScannedInvoice({ homeAi: home, openModel: open }, input, fetchImpl);
    expect(answer).toEqual({ reply: '{"total": 10}', model: 'home-model', source: 'home' });
    expect(urls).toEqual(['http://home-ai.test/v1/chat/completions']);
  });

  it('falls back to the open model when the home server fails', async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (String(url).includes('home-ai')) return new Response('down', { status: 500 });
      return okFetch('{"total": 20}')(url);
    };
    const failures: string[] = [];
    const answer = await readScannedInvoice(
      { homeAi: home, openModel: open },
      input,
      fetchImpl,
      (s) => failures.push(s),
    );
    expect(answer?.source).toBe('open');
    expect(failures).toEqual(['home']);
  });

  it('uses the open model alone when the home server is not connected', async () => {
    const answer = await readScannedInvoice({ homeAi: null, openModel: open }, input, okFetch('x'));
    expect(answer?.source).toBe('open');
  });

  it('returns null when every configured server fails', async () => {
    const fetchImpl: FetchLike = async () => new Response('down', { status: 503 });
    await expect(
      readScannedInvoice({ homeAi: home, openModel: open }, input, fetchImpl),
    ).resolves.toBeNull();
  });
});
