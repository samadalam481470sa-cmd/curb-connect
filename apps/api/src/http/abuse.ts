// Automated-abuse guard (FBI FLASH on ARTEX agentic intrusion frameworks, November 2026).
//
// AI-driven attack tools enumerate fast: hundreds of sequential record lookups, IDOR probing
// (walking ids until something answers 200), and credential retries in compressed bursts. This
// guard watches each actor (the signed-in session, or the client IP when signed out) and:
//
//   - blocks the actor for a cool-down period once it collects too many failed lookups
//     (401 / 403 / 404) inside one minute, answering 429 problem+json with Retry-After;
//   - logs a `security.bulk_read_suspected` event when an actor reads an unusually high number
//     of distinct records inside one minute (the FBI's "sequential lookups and unusually high
//     numbers of records accessed per session" signal), so it shows up in the logs for review.
//
// State is in memory. The API runs as a single instance; a restart clears the counters, which
// is acceptable because the baseline rate limit still applies.
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { problem } from './problem';

const WINDOW_MS = 60_000;
const MAX_TRACKED_ACTORS = 50_000;
const FAILURE_STATUSES = new Set([401, 403, 404]);
const EXEMPT_PREFIXES = ['/v1/health'];

interface ActorState {
  windowStart: number;
  failures: number;
  records: Set<string>;
  bulkReadLogged: boolean;
  blockedUntil: number;
}

export interface AbuseGuardOptions {
  failureThreshold: number;
  readAlertThreshold: number;
  blockMinutes: number;
  /** Test seam. */
  now?: () => number;
}

/** Stable, non-reversible key so raw session tokens never sit in memory maps or logs. */
function hashKey(value: string): string {
  return createHash('sha256').update(value).digest('base64url').slice(0, 22);
}

const SESSION_COOKIE_RE = /(?:^|;\s*)fl_session=([^;]+)/;

/** The session cookie (hashed) when present, otherwise the client IP. */
export function actorKey(request: FastifyRequest): string {
  const cookieHeader = request.headers.cookie;
  const session = typeof cookieHeader === 'string' ? SESSION_COOKIE_RE.exec(cookieHeader) : null;
  if (session?.[1]) return `s:${hashKey(session[1])}`;
  return `ip:${request.ip}`;
}

function isExempt(url: string): boolean {
  return EXEMPT_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/** Route + parameter values identify one record ("/v1/jobs/:id" + "42"). */
function recordKey(request: FastifyRequest): string | null {
  const params = request.params;
  if (!params || typeof params !== 'object') return null;
  const values = Object.values(params as Record<string, unknown>).filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  if (values.length === 0) return null;
  return `${request.routeOptions.url ?? ''}|${values.join('|')}`;
}

export class AbuseGuard {
  private readonly actors = new Map<string, ActorState>();
  private readonly now: () => number;

  constructor(private readonly options: AbuseGuardOptions) {
    this.now = options.now ?? Date.now;
  }

  private state(key: string): ActorState {
    const now = this.now();
    let state = this.actors.get(key);
    if (!state) {
      if (this.actors.size >= MAX_TRACKED_ACTORS) this.prune();
      state = {
        windowStart: now,
        failures: 0,
        records: new Set(),
        bulkReadLogged: false,
        blockedUntil: 0,
      };
      this.actors.set(key, state);
    } else if (now - state.windowStart >= WINDOW_MS) {
      state.windowStart = now;
      state.failures = 0;
      state.records = new Set();
      state.bulkReadLogged = false;
    }
    return state;
  }

  /** Drops actors whose window and block have both expired. */
  prune(): void {
    const now = this.now();
    for (const [key, state] of this.actors) {
      if (now - state.windowStart >= WINDOW_MS && state.blockedUntil <= now)
        this.actors.delete(key);
    }
  }

  /** Seconds left on the actor's block, or 0. */
  blockedFor(key: string): number {
    const state = this.actors.get(key);
    if (!state) return 0;
    const remaining = state.blockedUntil - this.now();
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }

  /** Returns 'blocked' when this failure pushed the actor over the threshold. */
  recordFailure(key: string): 'blocked' | 'counted' {
    const state = this.state(key);
    state.failures += 1;
    if (state.failures >= this.options.failureThreshold && state.blockedUntil <= this.now()) {
      state.blockedUntil = this.now() + this.options.blockMinutes * 60_000;
      return 'blocked';
    }
    return 'counted';
  }

  /** Returns 'alert' the first time an actor crosses the distinct-record threshold in a window. */
  recordRead(key: string, record: string): 'alert' | 'counted' {
    const state = this.state(key);
    state.records.add(record);
    if (state.records.size >= this.options.readAlertThreshold && !state.bulkReadLogged) {
      state.bulkReadLogged = true;
      return 'alert';
    }
    return 'counted';
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    abuseGuard: AbuseGuard;
  }
}

export function registerAbuseGuard(app: FastifyInstance, options: AbuseGuardOptions): void {
  const guard = new AbuseGuard(options);
  app.decorate('abuseGuard', guard);

  app.addHook('onRequest', async (request, reply) => {
    if (isExempt(request.url)) return;
    const retryAfter = guard.blockedFor(actorKey(request));
    if (retryAfter > 0) {
      reply.header('retry-after', String(retryAfter));
      throw problem('rate_limited', 'Too many failed requests. Try again later.', {
        retryAfterSeconds: retryAfter,
      });
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    if (isExempt(request.url)) return;
    const key = actorKey(request);
    const status = reply.statusCode;
    const userId = request.auth?.userId;
    // A signed-out visitor getting 401 from /v1/me is normal, so 401 only counts for requests
    // that presented a session (expired or forged session spraying).
    const countsAsFailure =
      FAILURE_STATUSES.has(status) && (status !== 401 || key.startsWith('s:'));
    if (countsAsFailure) {
      if (guard.recordFailure(key) === 'blocked') {
        request.log.warn(
          {
            securityEvent: 'security.actor_blocked',
            actor: key,
            userId,
            ip: request.ip,
            blockMinutes: options.blockMinutes,
          },
          'actor blocked after repeated failed lookups (possible automated enumeration)',
        );
      }
      return;
    }
    if (request.method === 'GET' && status >= 200 && status < 300) {
      const record = recordKey(request);
      if (record && guard.recordRead(key, record) === 'alert') {
        request.log.warn(
          {
            securityEvent: 'security.bulk_read_suspected',
            actor: key,
            userId,
            ip: request.ip,
            route: request.routeOptions.url,
            threshold: options.readAlertThreshold,
          },
          'unusually high number of distinct records read in one minute',
        );
      }
    }
  });
}
