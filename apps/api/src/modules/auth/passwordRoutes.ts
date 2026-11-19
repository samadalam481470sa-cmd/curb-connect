// Username and password sign-in (registered by the auth module under /v1/auth/password):
//   POST /auth/password/sign-up   create a user with a username, email and password, then sign in
//   POST /auth/password/sign-in   sign in with a username (or email) and password
//   GET  /auth/password           does the signed-in user have a password, and which username
//   PUT  /auth/password           set a first password (Microsoft / Google users) or change it
// Sessions are the same server-side sessions the OIDC sign-in creates (identityId stays null).
// Wrong credentials answer 400 with one message for "no such user" and "wrong password", after the
// same amount of hashing work, so the reply does not reveal which usernames exist.
import {
  PasswordSignInRequestSchema,
  PasswordSignInResponseSchema,
  PasswordSignUpRequestSchema,
  PasswordStatusSchema,
  PUBLIC_PATHS,
  SetPasswordRequestSchema,
  passwordProblem,
} from '@fieldline/contracts';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { withTenant } from '../../db/runtime';
import { passwordCredentials, sessions, users } from '../../db/schema';
import { requireUser } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { defaultActiveOrg, membershipsForUser } from '../../services/memberships';
import {
  createSession,
  hashIp,
  hashToken,
  SESSION_COOKIE,
  setSessionCookie,
} from '../../services/sessions';
import { safeReturnTo } from './index';
import {
  DEFAULT_SCRYPT_COST,
  dummyHash,
  hashPassword,
  LOCK_MINUTES,
  MAX_FAILED_ATTEMPTS,
  verifyPassword,
  type ScryptCost,
} from './password';

const WRONG_CREDENTIALS = 'Wrong username or password.';

const passwordRoutes: FastifyPluginAsyncZod<{ scryptCost?: ScryptCost }> = async (app, opts) => {
  // Tests run with a cheap cost; production and development use the full cost.
  const cost =
    opts.scryptCost ?? (app.config.env === 'test' ? { N: 1024, r: 8, p: 1 } : DEFAULT_SCRYPT_COST);
  // Per address: sign-in follows AUTH_RATE_LIMIT_PER_MINUTE (default 30); creating accounts and
  // changing passwords get a third of it (default 10). The per-account lock-out stops guessing.
  const rateLimit = { max: app.config.auth.rateLimitPerMinute, timeWindow: '1 minute' };
  const strictLimit = {
    max: Math.max(1, Math.floor(app.config.auth.rateLimitPerMinute / 3)),
    timeWindow: '1 minute',
  };

  /** Creates the session, writes the cookie and works out where the browser goes next. */
  async function signInAs(
    request: FastifyRequest,
    reply: FastifyReply,
    userId: string,
    remember: boolean,
    returnTo: string | undefined,
    method: 'password_sign_up' | 'password',
  ): Promise<{ redirectTo: string }> {
    const list = await membershipsForUser(app.db, userId);
    const activeOrgId = defaultActiveOrg(list);
    const previous = request.cookies[SESSION_COOKIE];
    const session = await createSession(app.db, app.config, {
      userId,
      identityId: null,
      activeOrgId,
      userAgent: request.headers['user-agent'],
      ipHash: hashIp(app.config.session.secret, request.ip),
      rotateFromTokenHash: previous ? hashToken(previous) : null,
    });
    if (activeOrgId) {
      await withTenant(app.db, { orgId: activeOrgId, userId }, (t) =>
        auditRequest(request, t, {
          orgId: activeOrgId,
          action: 'auth.signed_in',
          resourceType: 'session',
          resourceId: session.id,
          after: { provider: method },
          actorLabel: null,
        }),
      );
    }
    setSessionCookie(reply, app.config, session, { persistent: remember });
    const target = safeReturnTo(returnTo, app.config.appOrigin, app.config.auth.returnToOrigins);
    return {
      redirectTo:
        activeOrgId || list.length === 0
          ? target
          : `${PUBLIC_PATHS.selectWorkspace}?returnTo=${encodeURIComponent(target)}`,
    };
  }

  app.post(
    '/auth/password/sign-up',
    {
      config: { auth: 'none', rateLimit: strictLimit },
      schema: {
        tags: ['auth'],
        summary: 'Create an account with a username, email and password, then sign in',
        body: PasswordSignUpRequestSchema,
        response: { 200: PasswordSignInResponseSchema },
      },
    },
    async (request, reply) => {
      const body = request.body;
      const problemText = passwordProblem(body.password, body.username);
      if (problemText) throw problem('validation_failed', problemText);
      const email = body.email.toLowerCase();
      const passwordHash = await hashPassword(body.password, cost);

      const created = await app.db.transaction(async (tx) => {
        const [taken] = await tx
          .select({ userId: passwordCredentials.userId })
          .from(passwordCredentials)
          .where(sql`lower(${passwordCredentials.username}) = lower(${body.username})`)
          .limit(1);
        if (taken) return { kind: 'username_taken' as const };
        // An address already used by another account (for example a Microsoft or Google sign-in)
        // is not taken over by a new password account: that person signs in and adds a password.
        const [sameEmail] = await tx
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.email}) = ${email}`)
          .limit(1);
        if (sameEmail) return { kind: 'email_taken' as const };
        const [user] = await tx
          .insert(users)
          .values({
            displayName: body.displayName,
            email,
            phone: body.phone || null,
            lastLoginAt: new Date(),
          })
          .returning({ id: users.id });
        await tx
          .insert(passwordCredentials)
          .values({ userId: user!.id, username: body.username, passwordHash });
        return { kind: 'created' as const, userId: user!.id };
      });
      if (created.kind === 'username_taken') {
        throw problem('duplicate', 'That username is taken. Pick another.');
      }
      if (created.kind === 'email_taken') {
        throw problem(
          'duplicate',
          'An account with this email already exists. Sign in with it (Microsoft, Google or your username), then add a password in Settings.',
        );
      }
      request.log.info('password account created');
      return signInAs(
        request,
        reply,
        created.userId,
        body.remember,
        body.returnTo,
        'password_sign_up',
      );
    },
  );

  app.post(
    '/auth/password/sign-in',
    {
      config: { auth: 'none', rateLimit },
      schema: {
        tags: ['auth'],
        summary: 'Sign in with a username (or email) and password',
        body: PasswordSignInRequestSchema,
        response: { 200: PasswordSignInResponseSchema },
      },
    },
    async (request, reply) => {
      const login = request.body.login.toLowerCase();
      const find = (where: ReturnType<typeof sql>, limit: number) =>
        app.db
          .select({
            userId: passwordCredentials.userId,
            passwordHash: passwordCredentials.passwordHash,
            failedAttempts: passwordCredentials.failedAttempts,
            lockedUntil: passwordCredentials.lockedUntil,
            status: users.status,
          })
          .from(passwordCredentials)
          .innerJoin(users, eq(users.id, passwordCredentials.userId))
          .where(where)
          .limit(limit);
      let rows = login.includes('@')
        ? await find(sql`lower(${users.email}) = ${login}`, 2)
        : await find(sql`lower(${passwordCredentials.username}) = ${login}`, 1);
      // An email shared by two accounts is ambiguous: those people sign in with the username.
      if (rows.length > 1) rows = [];
      const row = rows[0];
      const now = new Date();
      if (row?.lockedUntil && row.lockedUntil > now) {
        const minutes = Math.max(
          1,
          Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 60_000),
        );
        throw problem(
          'rate_limited',
          `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        );
      }
      const ok = row
        ? await verifyPassword(request.body.password, row.passwordHash)
        : (await verifyPassword(request.body.password, await dummyHash(cost)), false);
      if (!row || !ok) {
        if (row) {
          const failures = row.failedAttempts + 1;
          await app.db
            .update(passwordCredentials)
            .set(
              failures >= MAX_FAILED_ATTEMPTS
                ? {
                    failedAttempts: 0,
                    lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000),
                  }
                : { failedAttempts: failures },
            )
            .where(eq(passwordCredentials.userId, row.userId));
          request.log.warn({ failures }, 'password sign-in failed');
        }
        throw problem('validation_failed', WRONG_CREDENTIALS);
      }
      if (row.status !== 'active') {
        throw problem('forbidden', 'This account is deactivated. Ask your company administrator.');
      }
      await app.db
        .update(passwordCredentials)
        .set({ failedAttempts: 0, lockedUntil: null })
        .where(eq(passwordCredentials.userId, row.userId));
      await app.db.update(users).set({ lastLoginAt: now }).where(eq(users.id, row.userId));
      return signInAs(
        request,
        reply,
        row.userId,
        request.body.remember,
        request.body.returnTo,
        'password',
      );
    },
  );

  async function status(userId: string) {
    const [row] = await app.db
      .select({ username: passwordCredentials.username })
      .from(passwordCredentials)
      .where(eq(passwordCredentials.userId, userId))
      .limit(1);
    return { hasPassword: Boolean(row), username: row?.username ?? null };
  }

  app.get(
    '/auth/password',
    {
      config: { auth: 'user' },
      schema: {
        tags: ['auth'],
        summary: 'Whether you can sign in with a username and password',
        response: { 200: PasswordStatusSchema },
      },
    },
    async (request, reply) => {
      reply.header('cache-control', 'private, no-store');
      return status(requireUser(request).userId);
    },
  );

  app.put(
    '/auth/password',
    {
      config: { auth: 'user', rateLimit: strictLimit },
      schema: {
        tags: ['auth'],
        summary: 'Add a password to your account, or change it (signs out your other devices)',
        body: SetPasswordRequestSchema,
        response: { 200: PasswordStatusSchema },
      },
    },
    async (request) => {
      const auth = requireUser(request);
      const body = request.body;
      const [existing] = await app.db
        .select()
        .from(passwordCredentials)
        .where(eq(passwordCredentials.userId, auth.userId))
        .limit(1);
      const username = existing?.username ?? body.username;
      if (!username) throw problem('validation_failed', 'Choose a username.');
      const problemText = passwordProblem(body.newPassword, username);
      if (problemText) throw problem('validation_failed', problemText);
      if (existing && !(await verifyPassword(body.currentPassword ?? '', existing.passwordHash))) {
        throw problem('validation_failed', 'The current password is wrong.');
      }
      const passwordHash = await hashPassword(body.newPassword, cost);
      const now = new Date();
      const outcome = await app.db.transaction(async (tx) => {
        if (existing) {
          await tx
            .update(passwordCredentials)
            .set({ passwordHash, passwordChangedAt: now, failedAttempts: 0, lockedUntil: null })
            .where(eq(passwordCredentials.userId, auth.userId));
        } else {
          const [taken] = await tx
            .select({ userId: passwordCredentials.userId })
            .from(passwordCredentials)
            .where(sql`lower(${passwordCredentials.username}) = lower(${username})`)
            .limit(1);
          if (taken) return 'username_taken' as const;
          await tx
            .insert(passwordCredentials)
            .values({ userId: auth.userId, username, passwordHash });
        }
        // A changed password ends every other session of this user; this one stays signed in.
        await tx
          .update(sessions)
          .set({ revokedAt: now })
          .where(
            and(
              eq(sessions.userId, auth.userId),
              sql`${sessions.id} <> ${auth.sessionId}`,
              sql`${sessions.revokedAt} is null`,
            ),
          );
        return 'saved' as const;
      });
      if (outcome === 'username_taken') {
        throw problem('duplicate', 'That username is taken. Pick another.');
      }
      if (auth.org) {
        const { orgId } = auth.org;
        await withTenant(app.db, { orgId, userId: auth.userId }, (t) =>
          auditRequest(request, t, {
            orgId,
            action: existing ? 'auth.password_changed' : 'auth.password_added',
            resourceType: 'user',
            resourceId: auth.userId,
          }),
        );
      }
      return status(auth.userId);
    },
  );
};

export default passwordRoutes;
