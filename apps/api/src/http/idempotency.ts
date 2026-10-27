// BE-076 / BE-073 D: Idempotency-Key handling for mutating requests.
//   - Stored per org + key, together with the route (method + route template) and a SHA-256 of
//     the canonical request body.
//   - First request: an `in_progress` row is committed (short lock), the handler runs in its own
//     tenant transaction, and the response is stored in that SAME transaction, so the business
//     write and the replay record commit or roll back together.
//   - Replay with the same body: the stored status + body is returned (Idempotent-Replayed: true).
//   - Same key, different body or route: 422 idempotency_key_reused.
//   - Same key while the first request is still running: 409 idempotency_in_progress + Retry-After.
//   - A failed attempt releases its key so the client can retry with it.
import { createHash } from 'node:crypto';
import { IdempotencyKeySchema } from '@fieldline/contracts';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { idempotencyKeys } from '../db/schema';
import { type Tx, withTenant } from '../db/runtime';
import { requireOrg } from './context';
import { problem } from './problem';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const LOCK_SECONDS = 30;
const RETAIN_HOURS = 24;
export const IN_PROGRESS_RETRY_AFTER_SECONDS = 2;

/** Stable JSON: object keys sorted recursively, so key order never changes the hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function requestFingerprint(method: string, route: string, body: unknown): string {
  return createHash('sha256').update(`${method}\n${route}\n${canonicalJson(body)}`).digest('hex');
}

export function readIdempotencyKey(request: FastifyRequest, required: boolean): string | null {
  const raw = request.headers[IDEMPOTENCY_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    if (required) throw problem('idempotency_key_required');
    return null;
  }
  const parsed = IdempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw problem('validation_failed', 'Idempotency-Key must be 8-128 visible ASCII characters.');
  }
  return parsed.data;
}

export interface HandlerResult<T> {
  status: number;
  body: T;
}

export interface IdempotentOptions {
  /** Reject requests without the header (billing, orders, estimates...). */
  required?: boolean;
}

type Claim =
  | { kind: 'claimed' }
  | { kind: 'replay'; status: number; body: unknown }
  | { kind: 'mismatch' }
  | { kind: 'in_progress' };

/**
 * Runs `handler` at most once per Idempotency-Key in the active org. `handler` receives the tenant
 * transaction; return the HTTP status and JSON body to send (and to store for replays).
 */
export async function idempotent<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  options: IdempotentOptions,
  handler: (tx: Tx) => Promise<HandlerResult<T>>,
): Promise<T> {
  const org = requireOrg(request);
  const db = request.server.db;
  const scope = { orgId: org.orgId, userId: org.userId };
  const key = readIdempotencyKey(request, options.required ?? false);
  if (!key) {
    const result = await withTenant(db, scope, handler);
    reply.status(result.status);
    return result.body;
  }
  const route = request.routeOptions.url ?? request.url.split('?')[0] ?? '';
  const hash = requestFingerprint(request.method, route, request.body);
  const now = new Date();

  const claim = await withTenant(db, scope, async (tx): Promise<Claim> => {
    const inserted = await tx
      .insert(idempotencyKeys)
      .values({
        orgId: org.orgId,
        key,
        method: request.method,
        path: route,
        requestHash: hash,
        status: 'in_progress',
        actorUserId: org.userId,
        lockedUntil: new Date(now.getTime() + LOCK_SECONDS * 1000),
        expiresAt: new Date(now.getTime() + RETAIN_HOURS * 3_600_000),
      })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });
    if (inserted.length > 0) return { kind: 'claimed' };
    const [existing] = await tx
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.orgId, org.orgId), eq(idempotencyKeys.key, key)))
      .for('update');
    if (!existing) return { kind: 'in_progress' };
    if (existing.requestHash !== hash || existing.method !== request.method || existing.path !== route) {
      return { kind: 'mismatch' };
    }
    if (existing.status === 'completed') {
      return { kind: 'replay', status: existing.responseStatus ?? 200, body: existing.responseBody };
    }
    if (existing.lockedUntil && existing.lockedUntil > now) return { kind: 'in_progress' };
    // The previous holder died without finishing (its lock expired): take over the key.
    await tx
      .update(idempotencyKeys)
      .set({ lockedUntil: new Date(now.getTime() + LOCK_SECONDS * 1000) })
      .where(eq(idempotencyKeys.id, existing.id));
    return { kind: 'claimed' };
  });

  if (claim.kind === 'mismatch') throw problem('idempotency_key_reused');
  if (claim.kind === 'in_progress') {
    throw problem('idempotency_in_progress', undefined, {
      retryAfterSeconds: IN_PROGRESS_RETRY_AFTER_SECONDS,
    });
  }
  if (claim.kind === 'replay') {
    reply.header('idempotent-replayed', 'true');
    reply.status(claim.status);
    return claim.body as T;
  }

  try {
    const result = await withTenant(db, scope, async (tx) => {
      const out = await handler(tx);
      await tx
        .update(idempotencyKeys)
        .set({
          status: 'completed',
          responseStatus: out.status,
          responseBody: sql`${JSON.stringify(out.body)}::jsonb`,
          lockedUntil: null,
        })
        .where(and(eq(idempotencyKeys.orgId, org.orgId), eq(idempotencyKeys.key, key)));
      return out;
    });
    reply.status(result.status);
    return result.body;
  } catch (error) {
    // Release the key: the business transaction rolled back, so a retry must be allowed to run.
    await withTenant(db, scope, (tx) =>
      tx
        .delete(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.orgId, org.orgId),
            eq(idempotencyKeys.key, key),
            eq(idempotencyKeys.status, 'in_progress'),
          ),
        ),
    ).catch((releaseError: unknown) => request.log.warn({ err: releaseError }, 'could not release idempotency key'));
    throw error;
  }
}
