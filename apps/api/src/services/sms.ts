// SMS adapter for the Roofing Storm Response feature.
//
// Provider interface + a Twilio-shaped implementation. Credentials come only
// from the environment (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN /
// TWILIO_FROM_NUMBER); nothing is hardcoded and no key or from-number ever
// appears in code, logs or responses. When any variable is missing the provider
// reports `not_configured` and send attempts fail honestly instead of
// pretending a text went out.
//
// This adapter is intentionally standalone: the notifications service
// (apps/api/src/services/notifications.ts) records SMS as suppressed for every
// category because it has no adapter, and wiring storm SMS into it would change
// the SMS path for all notification categories. Storm texts go through this
// adapter only, from the roof-storms routes.

export type SmsProviderState = 'configured' | 'not_configured';

export interface SmsStatus {
  provider: 'twilio';
  state: SmsProviderState;
  configured: boolean;
  /** Env vars that are missing; empty when configured. Never includes values. */
  missing: string[];
  /** The sender number is reported only as present/absent, never the number itself. */
  fromNumberPresent: boolean;
  message: string;
}

export interface SmsSendResult {
  ok: boolean;
  to: string;
  providerMessageId: string | null;
  error: string | null;
}

export interface SmsProvider {
  status(): SmsStatus;
  send(to: string, body: string): Promise<SmsSendResult>;
}

export const TWILIO_ENV_VARS = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_FROM_NUMBER',
] as const;

type FetchLike = typeof fetch;

function missingVars(env: NodeJS.ProcessEnv): string[] {
  return TWILIO_ENV_VARS.filter((key) => !env[key]?.trim());
}

/** Provider status from the environment without ever exposing a secret. */
export function smsStatusFromEnv(env: NodeJS.ProcessEnv = process.env): SmsStatus {
  const missing = missingVars(env);
  return {
    provider: 'twilio',
    state: missing.length === 0 ? 'configured' : 'not_configured',
    configured: missing.length === 0,
    missing,
    fromNumberPresent: Boolean(env.TWILIO_FROM_NUMBER?.trim()),
    message:
      missing.length === 0
        ? 'Twilio SMS is connected. Storm texts can be sent to opted-in customers.'
        : `SMS provider not connected — set ${missing.join(', ')} on the API service to enable storm texts. Drafts still work; nothing is sent until then.`,
  };
}

export class TwilioSmsProvider implements SmsProvider {
  private readonly accountSid: string | undefined;
  private readonly authToken: string | undefined;
  private readonly fromNumber: string | undefined;
  private readonly fetchFn: FetchLike;

  constructor(env: NodeJS.ProcessEnv = process.env, fetchFn: FetchLike = fetch) {
    this.accountSid = env.TWILIO_ACCOUNT_SID?.trim() || undefined;
    this.authToken = env.TWILIO_AUTH_TOKEN?.trim() || undefined;
    this.fromNumber = env.TWILIO_FROM_NUMBER?.trim() || undefined;
    this.fetchFn = fetchFn;
  }

  status(): SmsStatus {
    return smsStatusFromEnv({
      TWILIO_ACCOUNT_SID: this.accountSid,
      TWILIO_AUTH_TOKEN: this.authToken,
      TWILIO_FROM_NUMBER: this.fromNumber,
    } as NodeJS.ProcessEnv);
  }

  async send(to: string, body: string): Promise<SmsSendResult> {
    const fail = (error: string): SmsSendResult => ({
      ok: false,
      to,
      providerMessageId: null,
      error,
    });
    if (!this.accountSid || !this.authToken || !this.fromNumber) {
      return fail('SMS provider not connected: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER.');
    }
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`;
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: this.fromNumber, Body: body }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return fail('SMS provider could not be reached. No text was sent.');
    }
    if (!res.ok) return fail(`SMS provider rejected the send (HTTP ${res.status}). No text was sent.`);
    const data = (await res.json().catch(() => null)) as { sid?: unknown } | null;
    const sid = typeof data?.sid === 'string' ? data.sid : null;
    return { ok: true, to, providerMessageId: sid, error: null };
  }
}

/** The single SMS provider for storm response, configured from the environment. */
export function getSmsProvider(
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: FetchLike = fetch,
): SmsProvider {
  return new TwilioSmsProvider(env, fetchFn);
}
