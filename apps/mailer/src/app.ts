// HTTP surface of the mail server.
//
// Browser-facing (no API session needed; each step is protected by a signed ticket or cookie):
//   GET /connect/:provider?ticket=...        start Google / Microsoft sign-in for one member
//   GET /oauth/:provider/callback            finish it and park the result as a pending connection
//
// Service-facing (Bearer service token from apps/api, see tickets.ts):
//   POST   /internal/mailboxes/confirm       activate a pending connection, only for the member who
//                                            started it (a forwarded connect link connects nothing)
//   GET    /internal/mailboxes               the member's connected mailboxes
//   PUT    /internal/mailboxes/default       choose the mailbox invoices go out from
//   DELETE /internal/mailboxes/:mailbox      disconnect one address (revoked at Google when no
//                                            other company of the same member still uses it)
//   POST   /internal/send                    send one message, at most once per idempotency key
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import {
  MAILBOX_LIMIT,
  MAILBOX_PROVIDER_LABEL,
  MAILER_MAX_ATTACHMENT_BYTES,
  MailboxProviderSchema,
  MailboxRefSchema,
  MailerSendRequestSchema,
  mailboxId,
  parseMailboxRef,
  type MailboxProvider,
  type MailerErrorCode,
  type MailerMailboxListSchema,
  type MailerSendResult,
} from '@fieldline/contracts';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { MailerConfig } from './config';
import { deriveKey, pkceChallenge, randomToken, seal, unseal } from './crypto';
import type { OutboundMessage } from './mime';
import {
  hasScope,
  ProviderError,
  type ProviderAdapter,
  type ProviderSet,
  type TokenSet,
} from './providers';
import type { MailboxRecord, MailerStore } from './store';
import { TicketLedger, verifyConnectTicket, verifyServiceToken, type Caller } from './tickets';

export const STATE_COOKIE = 'fl_mailer_oauth';
const STATE_TTL_SECONDS = 600;
/** How long a finished sign-in waits for the member's Field Pro session to confirm it. */
const PENDING_TTL_MS = 10 * 60 * 1000;
/** A `sending` claim this old was interrupted: report it as possibly sent, never send it again. */
const STALE_SEND_MS = 2 * 60 * 1000;

export interface MailerDeps {
  config: MailerConfig;
  store: MailerStore;
  providers: ProviderSet;
  logger?: boolean | { level: string };
}

interface PendingSignIn {
  state: string;
  verifier: string;
  orgId: string;
  userId: string;
  provider: MailboxProvider;
  returnTo: string;
  exp: number;
}

type MailboxList = z.infer<typeof MailerMailboxListSchema>;

const idOf = (r: MailboxRecord) => mailboxId(r.provider, r.email);
const newest = (rows: MailboxRecord[]) =>
  [...rows].sort((a, b) => b.connectedAt.localeCompare(a.connectedAt))[0] ?? null;

/**
 * Picks the mailbox to use. `preferred` is the stored default (a mailbox id, or a bare provider
 * saved before several mailboxes existed). `ref` is what the caller asked for: a mailbox id, a
 * provider ("my default there, else the newest there"), or null ("my default").
 */
export function pickMailbox(
  rows: MailboxRecord[],
  preferred: string | null,
  ref: string | null,
): MailboxRecord | null {
  const byId = (id: string) => rows.find((r) => idOf(r) === id.toLowerCase()) ?? null;
  let fallback: MailboxRecord | null = null;
  if (preferred) {
    fallback = preferred.includes(':')
      ? byId(preferred)
      : newest(rows.filter((r) => r.provider === preferred));
  }
  if (!ref) return fallback ?? newest(rows);
  const { provider, email } = parseMailboxRef(ref);
  if (email) return byId(ref);
  if (fallback?.provider === provider) return fallback;
  return newest(rows.filter((r) => r.provider === provider));
}

class MailerFailure extends Error {
  constructor(
    readonly code: MailerErrorCode,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
  }
}

const HTTP_FOR: Record<MailerErrorCode, number> = {
  not_connected: 409,
  reconnect_required: 409,
  in_progress: 409,
  rejected: 422,
  retry: 503,
  unknown: 502,
};

function failure(code: MailerErrorCode, message: string) {
  return new MailerFailure(code, message, HTTP_FOR[code]);
}

/** Strip query strings from logged URLs: they carry one-time tickets and authorization codes. */
function pathOnly(url: string | undefined) {
  return (url ?? '').split('?')[0];
}

export async function buildMailer(deps: MailerDeps): Promise<FastifyInstance> {
  const { config, store, providers } = deps;
  const tokenKey = deriveKey(config.tokenKey, 'refresh-token');
  const stateKey = deriveKey(config.tokenKey, 'oauth-state');
  const pendingKey = deriveKey(config.tokenKey, 'pending-connection');
  const tickets = new TicketLedger();
  const accessCache = new Map<string, { token: string; expiresAt: number }>();

  const app = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: Math.ceil(MAILER_MAX_ATTACHMENT_BYTES * 1.4) + 200_000,
    logger:
      deps.logger === false
        ? false
        : {
            level: config.logLevel,
            serializers: {
              req: (req: FastifyRequest) => ({ method: req.method, url: pathOnly(req.url) }),
            },
            redact: ['req.headers.authorization', 'req.headers.cookie'],
          },
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

  const redirectUri = (provider: MailboxProvider) =>
    `${config.publicOrigin}/oauth/${provider}/callback`;
  const backToApp = (reply: FastifyReply, returnTo: string, params: Record<string, string>) => {
    const target = new URL(returnTo, config.appOrigin);
    for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v);
    return reply.redirect(target.toString(), 303);
  };
  // The seal binds a refresh token to its owner; it stays per provider so existing rows still open.
  const sealAad = (m: { orgId: string; userId: string; provider: string }) =>
    `${m.provider}:${m.orgId}:${m.userId}`;
  const cacheKey = (m: MailboxRecord) => `${sealAad(m)}:${m.email.toLowerCase()}`;

  // ---------------------------------------------------------------- health
  app.get('/health', async () => ({
    status: 'ok',
    providers: { gmail: Boolean(providers.gmail), outlook: Boolean(providers.outlook) },
  }));

  // ---------------------------------------------------------------- connect: start
  app.get('/connect/:provider', async (request, reply) => {
    const params = z.object({ provider: MailboxProviderSchema }).safeParse(request.params);
    const query = z.object({ ticket: z.string().min(20).max(4000) }).safeParse(request.query);
    if (!params.success || !query.success) {
      return backToApp(reply, '/settings/email', { mailbox: 'error', reason: 'bad_link' });
    }
    let ticket;
    try {
      ticket = await verifyConnectTicket(config.sharedSecret, query.data.ticket);
    } catch {
      return backToApp(reply, '/settings/email', { mailbox: 'error', reason: 'expired' });
    }
    if (ticket.provider !== params.data.provider || !tickets.consume(ticket.jti, ticket.exp)) {
      return backToApp(reply, ticket.returnTo, { mailbox: 'error', reason: 'expired' });
    }
    const adapter = providers[ticket.provider];
    if (!adapter) {
      return backToApp(reply, ticket.returnTo, {
        mailbox: 'error',
        reason: 'not_configured',
        provider: ticket.provider,
      });
    }
    const pending: PendingSignIn = {
      state: randomToken(),
      verifier: randomToken(48),
      orgId: ticket.orgId,
      userId: ticket.userId,
      provider: ticket.provider,
      returnTo: ticket.returnTo,
      exp: Date.now() + STATE_TTL_SECONDS * 1000,
    };
    reply.setCookie(STATE_COOKIE, seal(stateKey, JSON.stringify(pending), 'oauth-state'), {
      path: '/oauth',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.publicOrigin.startsWith('https://'),
      maxAge: STATE_TTL_SECONDS,
    });
    reply.header('cache-control', 'no-store');
    return reply.redirect(
      adapter.authorizeUrl({
        state: pending.state,
        codeChallenge: pkceChallenge(pending.verifier),
        redirectUri: redirectUri(ticket.provider),
        loginHint: ticket.loginHint,
      }),
      303,
    );
  });

  // ---------------------------------------------------------------- connect: callback
  app.get('/oauth/:provider/callback', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const provider = MailboxProviderSchema.safeParse(
      (request.params as { provider?: unknown }).provider,
    );
    const q = request.query as Record<string, unknown>;
    const raw = request.cookies[STATE_COOKIE];
    reply.clearCookie(STATE_COOKIE, { path: '/oauth' });

    let pending: PendingSignIn | null = null;
    if (raw) {
      try {
        pending = JSON.parse(unseal(stateKey, raw, 'oauth-state')) as PendingSignIn;
      } catch {
        pending = null;
      }
    }
    if (
      !pending ||
      !provider.success ||
      pending.provider !== provider.data ||
      pending.exp < Date.now()
    ) {
      return backToApp(reply, '/settings/email', { mailbox: 'error', reason: 'expired' });
    }
    if (typeof q.state !== 'string' || q.state !== pending.state) {
      return backToApp(reply, pending.returnTo, { mailbox: 'error', reason: 'state_mismatch' });
    }
    if (typeof q.error === 'string') {
      const reason = q.error === 'access_denied' ? 'declined' : 'provider_error';
      return backToApp(reply, pending.returnTo, {
        mailbox: 'error',
        reason,
        provider: pending.provider,
      });
    }
    const adapter = providers[pending.provider];
    if (!adapter || typeof q.code !== 'string' || q.code.length > 4096) {
      return backToApp(reply, pending.returnTo, { mailbox: 'error', reason: 'provider_error' });
    }

    let tokens: TokenSet;
    let profile;
    try {
      tokens = await adapter.exchangeCode(q.code, pending.verifier, redirectUri(pending.provider));
      if (!tokens.refreshToken) throw new ProviderError('rejected', 'no refresh token returned');
      if (!hasScope(tokens.scopes, adapter.requiredScope)) {
        await adapter.revoke(tokens.refreshToken).catch(() => undefined);
        return backToApp(reply, pending.returnTo, {
          mailbox: 'error',
          reason: 'missing_permission',
          provider: pending.provider,
        });
      }
      profile = await adapter.profile(tokens.accessToken);
    } catch (error) {
      request.log.warn(
        { provider: pending.provider, err: (error as Error).message },
        'mailbox sign-in failed',
      );
      return backToApp(reply, pending.returnTo, {
        mailbox: 'error',
        reason: 'provider_error',
        provider: pending.provider,
      });
    }

    // Not active yet. Whoever finished the Google / Microsoft step might not be the member who
    // started it (a connect link can be forwarded), so the member's own Field Pro session must
    // confirm it: /internal/mailboxes/confirm checks that the signed-in member matches.
    const owner = { orgId: pending.orgId, userId: pending.userId, provider: pending.provider };
    const stamp = new Date().toISOString();
    const record: MailboxRecord = {
      ...owner,
      email: profile.email.trim().toLowerCase(),
      displayName: profile.displayName,
      sealedRefreshToken: seal(tokenKey, tokens.refreshToken, sealAad(owner)),
      scopes: tokens.scopes,
      connectedAt: stamp,
      updatedAt: stamp,
    };
    const pendingId = randomToken();
    await store.putPending(
      pendingId,
      seal(pendingKey, JSON.stringify(record), `pending:${pendingId}`),
      new Date(Date.now() + PENDING_TTL_MS),
    );
    return backToApp(reply, pending.returnTo, {
      mailbox: 'confirm',
      provider: owner.provider,
      pending: pendingId,
    });
  });

  // ---------------------------------------------------------------- internal (service token)
  const caller = async (request: FastifyRequest): Promise<Caller> => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    try {
      return await verifyServiceToken(config.sharedSecret, token, {
        method: request.method,
        path: request.routeOptions.url ?? '',
      });
    } catch {
      throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
    }
  };

  async function listFor(who: Caller): Promise<MailboxList> {
    const [rows, preferred] = await Promise.all([
      store.listMailboxes(who.orgId, who.userId),
      store.getDefault(who.orgId, who.userId),
    ]);
    const chosen = pickMailbox(rows, preferred, null);
    const defaultId = chosen ? idOf(chosen) : null;
    return {
      providers: { gmail: Boolean(providers.gmail), outlook: Boolean(providers.outlook) },
      defaultProvider: chosen?.provider ?? null,
      defaultMailboxId: defaultId,
      items: rows.map((r) => ({
        id: idOf(r),
        provider: r.provider,
        email: r.email,
        displayName: r.displayName,
        connectedAt: r.connectedAt,
        isDefault: idOf(r) === defaultId,
      })),
    };
  }

  app.get('/internal/mailboxes', async (request) => listFor(await caller(request)));

  app.post('/internal/mailboxes/confirm', async (request, reply) => {
    const who = await caller(request);
    const body = z.object({ pending: z.string().min(20).max(200) }).safeParse(request.body);
    const raw = body.success ? await store.takePending(body.data.pending) : null;
    let record: MailboxRecord | null = null;
    if (raw && body.success) {
      try {
        record = JSON.parse(
          unseal(pendingKey, raw, `pending:${body.data.pending}`),
        ) as MailboxRecord;
      } catch {
        record = null;
      }
    }
    if (!record) {
      return reply.code(409).send({
        code: 'not_connected',
        message: 'That sign-in expired or was already used. Connect again.',
      });
    }
    if (record.orgId !== who.orgId || record.userId !== who.userId) {
      request.log.warn(
        { provider: record.provider },
        'pending mailbox confirmed by another member',
      );
      try {
        await providers[record.provider]?.revoke(
          unseal(tokenKey, record.sealedRefreshToken, sealAad(record)),
        );
      } catch {
        // Best effort; the pending record is already deleted.
      }
      return reply.code(422).send({
        code: 'rejected',
        message:
          'This sign-in was started from a different Field Pro account, so it was not connected.',
      });
    }
    const label = MAILBOX_PROVIDER_LABEL[record.provider];
    // One address sends for one person only. The new grant is dropped, not revoked: revoking it
    // could also cut off the member who already has this address connected.
    const owners = await store.findAddressOwners(record.provider, record.email);
    if (owners.some((o) => o.userId !== who.userId)) {
      request.log.warn(
        { provider: record.provider },
        'mailbox already connected by another member',
      );
      return reply.code(409).send({
        code: 'rejected',
        message: `${record.email} is already connected by another Field Pro member. Each ${label} address can send invoices for one person only.`,
      });
    }
    const id = idOf(record);
    const current = await store.listMailboxes(record.orgId, record.userId);
    const previous = current.find((r) => idOf(r) === id) ?? null;
    if (!previous && current.length >= MAILBOX_LIMIT) {
      return reply.code(409).send({
        code: 'rejected',
        message: `You can connect up to ${MAILBOX_LIMIT} mailboxes. Disconnect one first.`,
      });
    }
    await store.upsertMailbox(previous ? { ...record, connectedAt: previous.connectedAt } : record);
    accessCache.delete(cacheKey(record));
    const preferred = await store.getDefault(record.orgId, record.userId);
    if (!pickMailbox(current, preferred, null) || !preferred?.includes(':')) {
      // No default yet (or an old provider-only default): settle on a concrete mailbox id.
      const after = await store.listMailboxes(record.orgId, record.userId);
      await store.setDefault(
        record.orgId,
        record.userId,
        idOf(pickMailbox(after, preferred, null)!),
      );
    }
    request.log.info(
      { provider: record.provider, replaced: Boolean(previous) },
      'mailbox connected',
    );
    return listFor(who);
  });

  app.put('/internal/mailboxes/default', async (request, reply) => {
    const who = await caller(request);
    const body = z.object({ mailbox: MailboxRefSchema }).safeParse(request.body);
    if (!body.success)
      return reply.code(400).send({ code: 'rejected', message: 'Choose a connected mailbox.' });
    const rows = await store.listMailboxes(who.orgId, who.userId);
    const row = pickMailbox(rows, await store.getDefault(who.orgId, who.userId), body.data.mailbox);
    if (!row) {
      return reply
        .code(409)
        .send({ code: 'not_connected', message: 'Connect that mailbox first.' });
    }
    await store.setDefault(who.orgId, who.userId, idOf(row));
    return listFor(who);
  });

  app.delete('/internal/mailboxes/:mailbox', async (request, reply) => {
    const who = await caller(request);
    const ref = MailboxRefSchema.safeParse((request.params as { mailbox?: unknown }).mailbox);
    if (!ref.success)
      return reply.code(400).send({ code: 'rejected', message: 'Unknown mailbox.' });
    const preferred = await store.getDefault(who.orgId, who.userId);
    const row = pickMailbox(await store.listMailboxes(who.orgId, who.userId), preferred, ref.data);
    if (row) {
      const id = idOf(row);
      await store.deleteMailbox(who.orgId, who.userId, id);
      accessCache.delete(cacheKey(row));
      // The same member may use this address in another company; only revoke the last copy.
      const stillUsed = await store.findAddressOwners(row.provider, row.email);
      if (stillUsed.length === 0) {
        try {
          await providers[row.provider]?.revoke(
            unseal(tokenKey, row.sealedRefreshToken, sealAad(row)),
          );
        } catch {
          // Revocation is best effort; the sealed token is deleted either way.
        }
      }
      const rest = await store.listMailboxes(who.orgId, who.userId);
      if (!pickMailbox(rest, preferred, null) || preferred?.toLowerCase() === id) {
        const next = newest(rest);
        await store.setDefault(who.orgId, who.userId, next ? idOf(next) : null);
      }
    }
    return listFor(who);
  });

  async function accessTokenFor(
    row: MailboxRecord,
    adapter: ProviderAdapter,
    force = false,
  ): Promise<string> {
    const cached = accessCache.get(cacheKey(row));
    if (!force && cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
    let refreshToken: string;
    try {
      refreshToken = unseal(tokenKey, row.sealedRefreshToken, sealAad(row));
    } catch {
      throw new ProviderError(
        'auth',
        'stored connection can no longer be opened (encryption key changed)',
      );
    }
    const fresh = await adapter.refresh(refreshToken);
    accessCache.set(cacheKey(row), { token: fresh.accessToken, expiresAt: fresh.expiresAt });
    if (fresh.refreshToken && fresh.refreshToken !== refreshToken) {
      await store.upsertMailbox({
        ...row,
        sealedRefreshToken: seal(tokenKey, fresh.refreshToken, sealAad(row)),
        updatedAt: new Date().toISOString(),
      });
    }
    return fresh.accessToken;
  }

  app.post('/internal/send', async (request, reply) => {
    const who = await caller(request);
    const parsed = MailerSendRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ code: 'rejected', message: parsed.error.issues[0]?.message ?? 'Invalid message.' });
    }
    const body = parsed.data;
    const attachmentBytes = body.attachments.reduce(
      (n, a) => n + Math.floor((a.contentBase64.length * 3) / 4),
      0,
    );
    if (attachmentBytes > MAILER_MAX_ATTACHMENT_BYTES) {
      return reply
        .code(413)
        .send({ code: 'rejected', message: 'Attachments are larger than 3 MB.' });
    }
    try {
      const result = await sendOnce(who, body);
      return result;
    } catch (error) {
      if (error instanceof MailerFailure) {
        return reply.code(error.httpStatus).send({ code: error.code, message: error.message });
      }
      throw error;
    }
  });

  async function sendOnce(
    who: Caller,
    body: z.infer<typeof MailerSendRequestSchema>,
  ): Promise<MailerSendResult> {
    const rows = await store.listMailboxes(who.orgId, who.userId);
    const row = pickMailbox(rows, await store.getDefault(who.orgId, who.userId), body.mailbox);
    const adapter = row ? providers[row.provider] : undefined;
    if (!row || !adapter) {
      const asked = body.mailbox ? parseMailboxRef(body.mailbox) : null;
      throw failure(
        'not_connected',
        asked?.email
          ? `${asked.email} is not connected for this member.`
          : asked
            ? `No ${MAILBOX_PROVIDER_LABEL[asked.provider]} mailbox is connected for this member.`
            : 'No mailbox is connected for this member.',
      );
    }

    // Keys are scoped per company, so one tenant can never collide with another's key.
    const key = `${who.orgId}:${body.idempotencyKey}`;
    const existing = await store.claimSend({
      key,
      orgId: who.orgId,
      userId: who.userId,
      status: 'sending',
      provider: row.provider,
      from: row.email,
      providerMessageId: null,
      errorCode: null,
    });
    if (existing) {
      if (existing.status === 'sent') {
        const provider = existing.provider ?? row.provider;
        const from = existing.from ?? row.email;
        return {
          status: 'sent',
          provider,
          mailboxId: mailboxId(provider, from),
          from,
          providerMessageId: existing.providerMessageId,
        };
      }
      if (existing.status === 'sending') {
        const stale = Date.now() - Date.parse(existing.updatedAt) > STALE_SEND_MS;
        throw stale
          ? failure('unknown', 'An earlier attempt was interrupted; it may already have been sent.')
          : failure('in_progress', 'This message is being sent right now.');
      }
      const code = (existing.errorCode as MailerErrorCode | null) ?? 'rejected';
      throw failure(code, 'This message was already attempted and did not go out.');
    }

    const message: OutboundMessage = {
      to: body.to,
      subject: body.subject,
      text: body.text,
      fromName: body.fromName,
      attachments: body.attachments,
    };
    try {
      let token = await accessTokenFor(row, adapter);
      let sent;
      try {
        sent = await adapter.send(token, row.email, message);
      } catch (error) {
        // A 401 is refused before the provider does anything, so one retry with a fresh token is safe.
        if (!(error instanceof ProviderError) || error.kind !== 'auth') throw error;
        token = await accessTokenFor(row, adapter, true);
        sent = await adapter.send(token, row.email, message);
      }
      await store.finishSend(key, { status: 'sent', providerMessageId: sent.providerMessageId });
      return {
        status: 'sent',
        provider: row.provider,
        mailboxId: idOf(row),
        from: row.email,
        providerMessageId: sent.providerMessageId,
      };
    } catch (error) {
      if (!(error instanceof ProviderError)) {
        await store.finishSend(key, { status: 'failed', errorCode: 'unknown' });
        throw error;
      }
      if (error.kind === 'retry') {
        await store.releaseSend(key);
        throw failure('retry', error.message);
      }
      const code: MailerErrorCode =
        error.kind === 'auth'
          ? 'reconnect_required'
          : error.kind === 'unknown'
            ? 'unknown'
            : 'rejected';
      await store.finishSend(key, { status: 'failed', errorCode: code });
      if (code === 'reconnect_required') accessCache.delete(cacheKey(row));
      throw failure(
        code,
        code === 'reconnect_required'
          ? `${adapter.label} needs to be reconnected: ${error.message}`
          : error.message,
      );
    }
  }

  return app;
}
