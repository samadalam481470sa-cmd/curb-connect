// SMS adapter unit tests. No live provider is ever called — fetch is mocked and
// credentials are fake values passed in through a plain env record.
import { describe, expect, it } from 'vitest';
import { getSmsProvider, smsStatusFromEnv, TwilioSmsProvider } from './sms';

const CONFIGURED_ENV = {
  TWILIO_ACCOUNT_SID: 'ACtest',
  TWILIO_AUTH_TOKEN: 'token-test',
  TWILIO_FROM_NUMBER: '+15125550199',
} as unknown as NodeJS.ProcessEnv;

describe('smsStatusFromEnv', () => {
  it('reports not_configured and names the missing vars when nothing is set', () => {
    const status = smsStatusFromEnv({} as NodeJS.ProcessEnv);
    expect(status.state).toBe('not_configured');
    expect(status.configured).toBe(false);
    expect(status.missing).toEqual([
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_FROM_NUMBER',
    ]);
    expect(status.message).toContain('SMS provider not connected');
  });

  it('reports configured when all three vars are present — and never leaks a value', () => {
    const status = smsStatusFromEnv(CONFIGURED_ENV);
    expect(status).toMatchObject({ state: 'configured', configured: true, missing: [] });
    expect(JSON.stringify(status)).not.toContain('token-test');
    expect(JSON.stringify(status)).not.toContain('+15125550199');
  });

  it('names only the vars that are actually missing', () => {
    const status = smsStatusFromEnv({
      TWILIO_ACCOUNT_SID: 'ACtest',
    } as unknown as NodeJS.ProcessEnv);
    expect(status.missing).toEqual(['TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER']);
  });
});

describe('TwilioSmsProvider.send', () => {
  it('fails honestly without sending when the provider is not configured', async () => {
    const provider = new TwilioSmsProvider({} as NodeJS.ProcessEnv);
    const result = await provider.send('+15125550100', 'test');
    expect(result.ok).toBe(false);
    expect(result.providerMessageId).toBeNull();
    expect(result.error).toContain('not connected');
  });

  it('posts to the Twilio Messages API and returns the provider message id', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      seen.push({ url, init: init ?? {} });
      return new Response(JSON.stringify({ sid: 'SM123' }), { status: 201 });
    }) as unknown as typeof fetch;
    const provider = getSmsProvider(CONFIGURED_ENV, fetchFn);
    const result = await provider.send('+15125550100', 'Hail alert');
    expect(result).toEqual({
      ok: true,
      to: '+15125550100',
      providerMessageId: 'SM123',
      error: null,
    });
    expect(seen[0]!.url).toContain('api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json');
    const body = seen[0]!.init.body as URLSearchParams;
    expect(body.get('To')).toBe('+15125550100');
    expect(body.get('Body')).toBe('Hail alert');
    // The auth token must not appear in the URL or the form body.
    expect(seen[0]!.url).not.toContain('token-test');
    expect(body.toString()).not.toContain('token-test');
  });

  it('reports a provider rejection as a failed send, never a fake success', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ message: 'bad number' }), { status: 400 })) as unknown as typeof fetch;
    const provider = getSmsProvider(CONFIGURED_ENV, fetchFn);
    const result = await provider.send('+1', 'Hail alert');
    expect(result.ok).toBe(false);
    expect(result.providerMessageId).toBeNull();
    expect(result.error).toContain('HTTP 400');
  });

  it('reports an unreachable provider as a failed send', async () => {
    const fetchFn = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const provider = getSmsProvider(CONFIGURED_ENV, fetchFn);
    const result = await provider.send('+15125550100', 'Hail alert');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('could not be reached');
  });
});
