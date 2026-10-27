// Server-side sessions (PLT-013 R, BE-078): an opaque random token lives only in the httpOnly
// `fl_session` cookie; the database stores its SHA-256. Idle + absolute expiry, rotation on login,
// revocation on logout. The sessions/users tables are global (no RLS) and are reached only here.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import type { AppConfig } from '../config';
import type { Database } from '../db/client';
import { sessions, users } from '../db/schema';

export const SESSION_COOKIE = 'fl_session';
/** Sliding idle expiry is written at most this often per session, to keep reads cheap. */
const TOUCH_INTERVAL_MS = 60_000;

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Keyed hash so an IP can be correlated across rows without storing it (AIQ-088 D). */
export function hashIp(secret: string, ip: string | undefined): string | null {
  if (!ip) return null;
  return createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32);
}

export interface CreatedSession {
  id: string;
  token: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface CreateSessionInput {
  userId: string;
  identityId: string | null;
  activeOrgId: string | null;
  userAgent: string | undefined;
  ipHash: string | null;
  /** The session being replaced (rotation): it is revoked in the same transaction. */
  rotateFromTokenHash?: string | null;
}

export async function createSession(
  db: Database,
  config: AppConfig,
  input: CreateSessionInput,
  now = new Date(),
): Promise<CreatedSession> {
  const token = newOpaqueToken();
  const absoluteExpiresAt = new Date(now.getTime() + config.session.absoluteTimeoutHours * 3_600_000);
  const idleExpiresAt = new Date(
    Math.min(now.getTime() + config.session.idleTimeoutMinutes * 60_000, absoluteExpiresAt.getTime()),
  );
  return db.transaction(async (tx) => {
    let rotatedFromId: string | null = null;
    if (input.rotateFromTokenHash) {
      const [old] = await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.tokenHash, input.rotateFromTokenHash), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      rotatedFromId = old?.id ?? null;
    }
    const [row] = await tx
      .insert(sessions)
      .values({
        userId: input.userId,
        tokenHash: hashToken(token),
        identityId: input.identityId,
        activeOrgId: input.activeOrgId,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
        ipHash: input.ipHash,
        lastSeenAt: now,
        idleExpiresAt,
        absoluteExpiresAt,
        rotatedFromId,
      })
      .returning({ id: sessions.id });
    return { id: row!.id, token, idleExpiresAt, absoluteExpiresAt };
  });
}

export type SessionLookup =
  | { status: 'missing' }
  | { status: 'expired' }
  | { status: 'user_inactive' }
  | {
      status: 'active';
      session: {
        id: string;
        userId: string;
        activeOrgId: string | null;
        idleExpiresAt: Date;
        absoluteExpiresAt: Date;
      };
      user: { id: string; displayName: string; email: string | null; locale: string };
    };

/** Resolves a cookie token to an active session, sliding the idle expiry. */
export async function resolveSession(
  db: Database,
  config: AppConfig,
  token: string | undefined,
  now = new Date(),
): Promise<SessionLookup> {
  if (!token || token.length > 200) return { status: 'missing' };
  const [row] = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      activeOrgId: sessions.activeOrgId,
      idleExpiresAt: sessions.idleExpiresAt,
      absoluteExpiresAt: sessions.absoluteExpiresAt,
      lastSeenAt: sessions.lastSeenAt,
      revokedAt: sessions.revokedAt,
      displayName: users.displayName,
      email: users.email,
      locale: users.locale,
      userStatus: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);
  if (!row || row.revokedAt) return { status: 'missing' };
  if (row.idleExpiresAt <= now || row.absoluteExpiresAt <= now) {
    await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, row.id));
    return { status: 'expired' };
  }
  if (row.userStatus !== 'active') {
    // PLT-015 / BE-078: a deactivated user loses every session on the next request.
    await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.userId, row.userId));
    return { status: 'user_inactive' };
  }
  let idleExpiresAt = row.idleExpiresAt;
  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    idleExpiresAt = new Date(
      Math.min(now.getTime() + config.session.idleTimeoutMinutes * 60_000, row.absoluteExpiresAt.getTime()),
    );
    await db.update(sessions).set({ lastSeenAt: now, idleExpiresAt }).where(eq(sessions.id, row.id));
  }
  return {
    status: 'active',
    session: {
      id: row.id,
      userId: row.userId,
      activeOrgId: row.activeOrgId,
      idleExpiresAt,
      absoluteExpiresAt: row.absoluteExpiresAt,
    },
    user: { id: row.userId, displayName: row.displayName, email: row.email, locale: row.locale },
  };
}

export async function revokeSessionByToken(db: Database, token: string, now = new Date()): Promise<string | null> {
  const [row] = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id, userId: sessions.userId });
  return row?.userId ?? null;
}

export async function setActiveOrg(db: Database, sessionId: string, orgId: string | null): Promise<void> {
  await db.update(sessions).set({ activeOrgId: orgId }).where(eq(sessions.id, sessionId));
}

export function setSessionCookie(reply: FastifyReply, config: AppConfig, created: CreatedSession): void {
  reply.setCookie(SESSION_COOKIE, created.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    expires: created.absoluteExpiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
  });
}
