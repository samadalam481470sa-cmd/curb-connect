// Audit helper (PLT-015 D, AIQ-088 D): one append-only audit_events row per state change, written in
// the SAME transaction as the change so the log can never disagree with the data. Values in
// before/after must be DTO-shaped: never tokens, token hashes or restricted EXIF.
import type { ActorType } from '@fieldline/contracts';
import { auditEvents } from '../db/schema';
import type { Tx } from '../db/runtime';
import type { FastifyRequest } from 'fastify';
import { type RequestMeta, requestMeta } from '../http/context';
import { hashIp } from './sessions';

export interface AuditEntry {
  orgId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  actorType?: ActorType;
  actorLabel?: string | null;
}

const SECRET_KEYS = /token|secret|password|hash|exif|signature/i;

/** Drops secret-looking keys defensively (shallow + one level deep). */
export function scrubForAudit(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(scrubForAudit);
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEYS.test(key)) continue;
    out[key] =
      inner instanceof Date
        ? inner.toISOString()
        : inner && typeof inner === 'object' && !Array.isArray(inner)
          ? Object.fromEntries(
              Object.entries(inner as Record<string, unknown>).filter(([k]) => !SECRET_KEYS.test(k)),
            )
          : inner;
  }
  return out;
}

export async function writeAudit(
  tx: Tx,
  meta: RequestMeta & { ipSecret: string },
  entry: AuditEntry,
): Promise<void> {
  await tx.insert(auditEvents).values({
    orgId: entry.orgId,
    actorType: entry.actorType ?? (meta.actorUserId ? 'user' : 'system'),
    actorUserId: meta.actorUserId,
    actorLabel: entry.actorLabel ?? null,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    before: scrubForAudit(entry.before),
    after: scrubForAudit(entry.after),
    reason: entry.reason ?? null,
    correlationId: meta.correlationId,
    ipHash: hashIp(meta.ipSecret, meta.ip),
    userAgent: meta.userAgent ?? null,
  });
}

/** writeAudit() with the actor, correlation id, IP hash and user agent taken from the request. */
export function auditRequest(request: FastifyRequest, tx: Tx, entry: AuditEntry): Promise<void> {
  return writeAudit(tx, { ...requestMeta(request), ipSecret: request.server.config.session.secret }, entry);
}
