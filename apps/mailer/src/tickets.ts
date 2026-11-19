// The API proves who is asking with short HS256 JWTs signed with MAILER_SHARED_SECRET:
//   - service tokens on every /internal/* call, bound to one method + path and valid for 2 minutes;
//   - one-time connect tickets the browser carries to /connect/:provider, valid for 10 minutes.
// The organization and member ids come only from these signed claims, never from a request body.
import {
  MAILER_CONNECT_AUDIENCE,
  MAILER_ISSUER,
  MAILER_SERVICE_AUDIENCE,
  MailboxProviderSchema,
  type MailboxProvider,
} from '@fieldline/contracts';
import { jwtVerify } from 'jose';
import { z } from 'zod';

const Owner = z.object({ org: z.uuid(), usr: z.uuid() });

export interface Caller {
  orgId: string;
  userId: string;
}

export interface ConnectTicket extends Caller {
  provider: MailboxProvider;
  returnTo: string;
  /** Address to pre-select on the Google / Microsoft page, when the API knows it. */
  loginHint: string | null;
  jti: string;
  exp: number;
}

const secretKey = (secret: string) => new TextEncoder().encode(secret);

/** Only same-site paths: no scheme, no protocol-relative "//host", no backslashes. */
export function safeReturnPath(value: unknown, fallback = '/settings/email'): string {
  if (typeof value !== 'string') return fallback;
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.length > 200
  ) {
    return fallback;
  }
  return /^[A-Za-z0-9/_\-.?=&%]*$/.test(value) ? value : fallback;
}

export async function verifyServiceToken(
  secret: string,
  token: string,
  expected: { method: string; path: string },
): Promise<Caller> {
  const { payload } = await jwtVerify(token, secretKey(secret), {
    issuer: MAILER_ISSUER,
    audience: MAILER_SERVICE_AUDIENCE,
    algorithms: ['HS256'],
    maxTokenAge: '2m',
    clockTolerance: 30,
  });
  const claims = Owner.extend({ req: z.string() }).parse(payload);
  if (claims.req !== `${expected.method.toUpperCase()} ${expected.path}`) {
    throw new Error('service token was issued for another request');
  }
  return { orgId: claims.org, userId: claims.usr };
}

export async function verifyConnectTicket(secret: string, ticket: string): Promise<ConnectTicket> {
  const { payload } = await jwtVerify(ticket, secretKey(secret), {
    issuer: MAILER_ISSUER,
    audience: MAILER_CONNECT_AUDIENCE,
    algorithms: ['HS256'],
    maxTokenAge: '10m',
    clockTolerance: 30,
  });
  const claims = Owner.extend({
    prv: MailboxProviderSchema,
    ret: z.string().optional(),
    hint: z.email().max(254).optional(),
    jti: z.string().min(16),
    exp: z.number(),
  }).parse(payload);
  return {
    orgId: claims.org,
    userId: claims.usr,
    provider: claims.prv,
    returnTo: safeReturnPath(claims.ret),
    loginHint: claims.hint ?? null,
    jti: claims.jti,
    exp: claims.exp,
  };
}

/** Remembers used ticket ids until they expire, so a ticket opens one sign-in only. */
export class TicketLedger {
  private readonly used = new Map<string, number>();
  consume(jti: string, expSeconds: number): boolean {
    const nowMs = Date.now();
    for (const [id, exp] of this.used) if (exp * 1000 < nowMs) this.used.delete(id);
    if (this.used.has(jti)) return false;
    this.used.set(jti, expSeconds);
    return true;
  }
}
