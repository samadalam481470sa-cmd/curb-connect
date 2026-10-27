// Runtime database access (BINDING DB ROLE RULE, docs: src/db/README.md "Tenancy").
//
// Two connections, never mixed:
//   app       APP_DATABASE_URL as fieldline_app (NOSUPERUSER NOBYPASSRLS). Every request handler
//             runs inside withTenant(), which sets app.org_id / app.user_id transaction-locally so
//             Row-Level Security filters every tenant table.
//   platform  DATABASE_URL (owner) but every transaction starts with SET LOCAL ROLE
//             fieldline_platform (NOSUPERUSER BYPASSRLS). Used ONLY for the cross-tenant operations
//             listed in PLATFORM_OPERATIONS below; each use is named and logged so it can be audited.
import { sql } from 'drizzle-orm';
import type { DatabaseHandle, Database } from './client';

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything that can run a query: the pool or an open transaction. */
export type Queryable = Database | Tx;

/**
 * Every legitimate cross-tenant operation. Adding one is a security review item (BE-078, LCH-091):
 * it runs with BYPASSRLS, so the code inside must scope by org explicitly.
 */
export const PLATFORM_OPERATIONS = [
  /** POST /v1/orgs: the tenant row does not exist yet, so no org context can be set. */
  'org.create',
  /** POST /v1/invitations/accept: the invitee is not a member yet; lookup is by token hash. */
  'invitation.accept',
  /** POST /v1/invitations/preview: read-only lookup by token hash before membership (no writes). */
  'invitation.preview',
  /** graphile-worker tasks: payloads carry orgId and every query in a task filters by it. */
  'worker.task',
  /** /v1/admin: platform support staff (PLATFORM_ADMIN_USER_IDS), read-only views. */
  'admin.read',
] as const;
export type PlatformOperation = (typeof PLATFORM_OPERATIONS)[number];

export interface TenantScope {
  orgId: string | null;
  userId: string | null;
}

/**
 * Runs fn in a transaction on the restricted connection with the RLS context set. orgId null means
 * "no active org": tenant tables then return nothing, which is the safe default.
 */
export async function withTenant<T>(
  db: Database,
  scope: TenantScope,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.org_id', ${scope.orgId ?? ''}, true), set_config('app.user_id', ${scope.userId ?? ''}, true)`,
    );
    return fn(tx);
  });
}

export interface PlatformLogger {
  info: (obj: object, msg: string) => void;
}

/**
 * Runs fn as fieldline_platform (BYPASSRLS) for one named operation. The role switch is
 * transaction-local, so the pooled owner connection is never left elevated or as the owner for
 * request work. Code inside must filter by org itself.
 */
export async function withPlatform<T>(
  db: Database,
  operation: PlatformOperation,
  log: PlatformLogger | null,
  fn: (tx: Tx) => Promise<T>,
  scope: TenantScope = { orgId: null, userId: null },
): Promise<T> {
  log?.info({ platformOperation: operation }, 'platform role transaction');
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role fieldline_platform`);
    await tx.execute(
      sql`select set_config('app.org_id', ${scope.orgId ?? ''}, true), set_config('app.user_id', ${scope.userId ?? ''}, true)`,
    );
    return fn(tx);
  });
}

export interface RoleCheck {
  role: string;
  superuser: boolean;
  bypassRls: boolean;
}

export async function describeRuntimeRole(handle: DatabaseHandle): Promise<RoleCheck> {
  const rows = await handle.client<{ role: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
    select r.rolname as role, r.rolsuper, r.rolbypassrls
    from pg_roles r where r.rolname = current_user`;
  const row = rows[0];
  if (!row) throw new Error('could not read the runtime role from pg_roles');
  return { role: row.role, superuser: row.rolsuper, bypassRls: row.rolbypassrls };
}

/**
 * Fail fast at boot if the runtime connection would bypass Row-Level Security (superuser or
 * BYPASSRLS). The message names the role only, never the connection string.
 */
export async function assertRestrictedRuntimeRole(handle: DatabaseHandle): Promise<RoleCheck> {
  const check = await describeRuntimeRole(handle);
  if (check.superuser || check.bypassRls) {
    throw new Error(
      `Refusing to start: runtime database role "${check.role}" ` +
        `${check.superuser ? 'is a superuser' : 'has BYPASSRLS'}, so Row-Level Security would not ` +
        'apply. Set APP_DATABASE_URL to the restricted fieldline_app role.',
    );
  }
  return check;
}

export interface Databases {
  /** Restricted runtime role. */
  app: DatabaseHandle;
  /** Owner connection, used only through withPlatform(). */
  platform: DatabaseHandle;
}
