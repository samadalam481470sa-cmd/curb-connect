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
  /** POST /v1/billing/activate: redeem an activation code (platform-only table, company clock). */
  'billing.activate',
  /** GET /v1/billing/status: reads whether this person's email has already had its free trial. */
  'billing.status',
  /** POST /v1/auth/email/verify and resend: one-time verification links (platform-only table). */
  'email.verification',
  /** POST /v1/auth/password/forgot and /reset: one-time reset links (platform-only table). */
  'auth.password_reset',
  /** POST /v1/billing/webhook: a verified Stripe event updates the subscription of the company named in its metadata. */
  'billing.webhook',
  /** POST /v1/orgs: the tenant row does not exist yet, so no org context can be set. */
  'org.create',
  /** POST /v1/invitations/accept: the invitee is not a member yet; lookup is by token hash. */
  'invitation.accept',
  /** POST /v1/invitations/preview: read-only lookup by token hash before membership (no writes). */
  'invitation.preview',
  /** graphile-worker tasks: payloads carry orgId and every query in a task filters by it. */
  'worker.task',
  /** GET /v1/permit-leads/sources/status: read-only view of the platform-owned daily
   *  permit-source freshness rows (no tenant data). */
  'permit.sources_status',
  /** GET /v1/roof-storms/swath: read-only view of the platform-owned stored MRMS hail-swath
   *  rows (no tenant data); the swath worker writes them, the API only reads. */
  'roof.swath',
  /** GET /v1/gov-opportunities and /v1/gov-opportunities/status: read-only view of the
   *  platform-owned daily .gov dead-link scan rows (no tenant data). POST
   *  /v1/gov-opportunities/refresh writes the same rows via the manual re-scan. */
  'gov.opportunities',
  /** /v1/admin: platform support staff (PLATFORM_ADMIN_USER_IDS), read-only views. */
  'admin.read',
  /** Opt-in company directory lookup: read-only public company fields, never records. */
  'network.directory',
  /** Connection request/accept/decline/revoke: writes the mirrored row in the partner tenant. */
  'network.connect',
  /** Share a project: writes the partner's mirrored project row. */
  'network.share',
  /** Deliver an issued invoice into the recipient's own bill workflow. */
  'network.invoice_deliver',
  /** Recipient approves or disputes a bill; the issuer's delivery state commits atomically. */
  'network.bill_decide',
  /** Settlement: the issuer's paid invoice and ledger entries commit with the bill's payment. */
  'network.settle',
  /**
   * Supplier order flow: a buyer sends a purchase order to a connected supplier and both
   * sides track status on their mirrored rows. Every write verifies an active connection on
   * BOTH sides first (the connection itself is the mutual consent), then updates only the
   * two rows sharing the order key.
   */
  'network.order',
  /**
   * Work assignment: a builder assigns a job / PO / task / bid invitation to a connected
   * contracting company. Writes the mirrored assignment row in the partner tenant plus
   * in-app notifications for the partner's owner/admin members; email is queued through the
   * outbox only when a mail path is configured, never claimed sent otherwise.
   */
  'network.assignment',
  /** Only authenticated contractor members may inspect explicitly shared bid opportunities. */
  'bidding.read',
  /** Submit a bid into another tenant after ACL and job-open checks. */
  'bidding.submit',
  /**
   * POST /v1/portal/job-status: a customer without an account opens a job-status link. Lookup is
   * by token hash; every later query filters by the token's own org_id and job id, and the only
   * write is the token's last_used_at / use_count.
   */
  'portal.job_status',
  /**
   * POST /v1/portal/selections: the same job-status link lets the buyer add or remove a
   * design selection on their own contract. Lookup is by token hash; every query filters
   * by the token's own org_id and job id; the only write is one sales_selections row for
   * that job's contract, priced from the builder's catalog at pick time.
   */
  'portal.selections',
  /** A bearer grant opens only its current, approved project photo derivatives. */
  'portal.jobsite_gallery',
  /**
   * POST /v1/portal/warranty/*: the same job-status link (scope 'job') lets the homeowner
   * read and file warranty tickets and messages for that one job. Lookup is by token hash;
   * every query filters by the token's own org_id and job id; writes are limited to warranty
   * tickets/messages for that job plus the token's last_used_at / use_count.
   */
  'portal.warranty',
  /**
   * POST /v1/auth/account/delete: the signed-in user deletes their own account. Deletes the
   * user's auth records and memberships, deletes what can be deleted of the workspaces they
   * solely owned and closes those workspaces; shared workspaces only lose the membership.
   * Scoped by the session's user id, never by a client-supplied id.
   */
  'auth.account_delete',
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
