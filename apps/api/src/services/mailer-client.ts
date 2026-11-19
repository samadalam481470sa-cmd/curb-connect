// Client for the separate mail server (apps/mailer). The mail server holds every Gmail / Outlook
// token; this API only signs short-lived requests for the signed-in member and relays outcomes.
//   - connect tickets: one-time, 10 minutes, carried by the browser to /connect/:provider;
//   - service tokens: 2 minutes, bound to one method + route, on every /internal/* call.
import { randomUUID } from 'node:crypto';
import {
  MAILER_CONNECT_AUDIENCE,
  MAILER_ISSUER,
  MAILER_SERVICE_AUDIENCE,
  MailerErrorSchema,
  MailerMailboxListSchema,
  MailerSendResultSchema,
  type MailboxList,
  type MailboxProvider,
  type MailerErrorCode,
  type MailerSendRequest,
  type MailerSendResult,
} from '@fieldline/contracts';
import { SignJWT } from 'jose';
import type { z } from 'zod';
import type { AppConfig } from '../config';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface Owner {
  orgId: string;
  userId: string;
}

export class MailerError extends Error {
  constructor(
    readonly code: MailerErrorCode | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'MailerError';
  }
}

export interface MailerClient {
  readonly available: boolean;
  connectUrl(owner: Owner, provider: MailboxProvider, returnTo: string): Promise<string>;
  list(owner: Owner): Promise<MailboxList>;
  confirm(owner: Owner, pendingId: string): Promise<MailboxList>;
  setDefault(owner: Owner, provider: MailboxProvider): Promise<MailboxList>;
  disconnect(owner: Owner, provider: MailboxProvider): Promise<MailboxList>;
  send(owner: Owner, message: MailerSendRequest): Promise<MailerSendResult>;
}

export const UNAVAILABLE_LIST: MailboxList = {
  available: false,
  providers: { gmail: false, outlook: false },
  defaultProvider: null,
  items: [],
};

class DisabledMailer implements MailerClient {
  readonly available = false;
  private fail(): never {
    throw new MailerError(
      'unavailable',
      'Email sending is not set up on this server (MAILER_URL and MAILER_SHARED_SECRET).',
    );
  }
  async connectUrl(): Promise<string> {
    this.fail();
  }
  async list() {
    return UNAVAILABLE_LIST;
  }
  async confirm(): Promise<MailboxList> {
    this.fail();
  }
  async setDefault(): Promise<MailboxList> {
    this.fail();
  }
  async disconnect(): Promise<MailboxList> {
    this.fail();
  }
  async send(): Promise<MailerSendResult> {
    this.fail();
  }
}

export function createMailerClient(
  settings: NonNullable<AppConfig['mailer']> | null,
  fetchImpl: FetchLike = fetch,
): MailerClient {
  if (!settings) return new DisabledMailer();
  const key = new TextEncoder().encode(settings.sharedSecret);

  const serviceToken = (owner: Owner, method: string, route: string) =>
    new SignJWT({ org: owner.orgId, usr: owner.userId, req: `${method} ${route}` })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(MAILER_ISSUER)
      .setAudience(MAILER_SERVICE_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(key);

  async function call<T>(
    owner: Owner,
    method: 'GET' | 'PUT' | 'DELETE' | 'POST',
    route: string,
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    timeoutMs = 20_000,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${settings!.url}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${await serviceToken(owner, method, route)}`,
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // For a send this is ambiguous: the request may have reached the mail server. The mail
      // server's idempotency key makes a retry with the same key safe either way.
      throw new MailerError('retry', 'The mail server did not answer.');
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // no body
    }
    if (!res.ok) {
      const parsed = MailerErrorSchema.safeParse(json);
      if (parsed.success) throw new MailerError(parsed.data.code, parsed.data.message);
      if (res.status === 401)
        throw new MailerError(
          'unavailable',
          'The mail server rejected this server (check MAILER_SHARED_SECRET).',
        );
      throw new MailerError(
        res.status >= 500 ? 'retry' : 'rejected',
        `The mail server answered HTTP ${res.status}.`,
      );
    }
    return schema.parse(json);
  }

  const withAvailable = (list: z.infer<typeof MailerMailboxListSchema>): MailboxList => ({
    available: true,
    ...list,
  });

  return {
    available: true,
    async connectUrl(owner, provider, returnTo) {
      const ticket = await new SignJWT({
        org: owner.orgId,
        usr: owner.userId,
        prv: provider,
        ret: returnTo,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(MAILER_ISSUER)
        .setAudience(MAILER_CONNECT_AUDIENCE)
        .setJti(randomUUID())
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(key);
      return `${settings.publicOrigin}/connect/${provider}?ticket=${encodeURIComponent(ticket)}`;
    },
    async list(owner) {
      return withAvailable(
        await call(
          owner,
          'GET',
          '/internal/mailboxes',
          '/internal/mailboxes',
          MailerMailboxListSchema,
        ),
      );
    },
    async confirm(owner, pendingId) {
      return withAvailable(
        await call(
          owner,
          'POST',
          '/internal/mailboxes/confirm',
          '/internal/mailboxes/confirm',
          MailerMailboxListSchema,
          { pending: pendingId },
        ),
      );
    },
    async setDefault(owner, provider) {
      return withAvailable(
        await call(
          owner,
          'PUT',
          '/internal/mailboxes/default',
          '/internal/mailboxes/default',
          MailerMailboxListSchema,
          { provider },
        ),
      );
    },
    async disconnect(owner, provider) {
      return withAvailable(
        await call(
          owner,
          'DELETE',
          '/internal/mailboxes/:provider',
          `/internal/mailboxes/${provider}`,
          MailerMailboxListSchema,
        ),
      );
    },
    async send(owner, message) {
      return call(
        owner,
        'POST',
        '/internal/send',
        '/internal/send',
        MailerSendResultSchema,
        message,
        90_000,
      );
    },
  };
}
