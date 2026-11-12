import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDatabase } from './client';

/**
 * Finds apps/api/drizzle by walking up from this file, so the same code works from src/db (tsx,
 * vitest) and from the bundled dist/ output. MIGRATIONS_DIR overrides it on deploy targets.
 */
export function findMigrationsFolder(): string {
  if (process.env.MIGRATIONS_DIR) return resolve(process.env.MIGRATIONS_DIR);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = join(dir, 'drizzle');
    if (existsSync(join(candidate, 'meta', '_journal.json'))) return candidate;
    dir = dirname(dir);
  }
  throw new Error('Could not find the drizzle/ migrations folder; set MIGRATIONS_DIR.');
}

/** Name of the per-table policy that stands in for BYPASSRLS on managed Postgres. */
export const PLATFORM_POLICY = 'fieldline_platform_all';

/**
 * Applies all pending SQL migrations in drizzle/ (idempotent; tracked in drizzle.__drizzle_migrations).
 *
 * Managed Postgres (Render, most hosted providers) does not give the database owner superuser,
 * and only a superuser or a BYPASSRLS role may create a BYPASSRLS role. On such a database the
 * platform role is created without BYPASSRLS before migration 0002 runs (its IF NOT EXISTS then
 * skips the BYPASSRLS create), and afterwards every RLS table gets one permissive policy for
 * fieldline_platform only. All tenant policies are permissive, so the platform path sees exactly
 * what BYPASSRLS would give it, while fieldline_app stays restricted. Where the role does have
 * BYPASSRLS (local, CI) neither step changes anything.
 */
export async function runMigrations(url: string): Promise<void> {
  const database = createDatabase(url, { max: 1, applicationName: 'migrate' });
  try {
    await preparePlatformRole(database.client);
    await migrate(database.db, { migrationsFolder: findMigrationsFolder() });
    await ensurePlatformPolicies(database.client);
  } finally {
    await database.close();
  }
}

type Sql = ReturnType<typeof createDatabase>['client'];

async function preparePlatformRole(sql: Sql): Promise<void> {
  const [me] = await sql<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
    select rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
  const [existing] = await sql`select 1 from pg_roles where rolname = 'fieldline_platform'`;
  if (existing || me?.rolsuper || me?.rolbypassrls) return;
  await sql.unsafe('CREATE ROLE fieldline_platform NOLOGIN NOSUPERUSER NOBYPASSRLS');
  console.info(
    '[migrate] database user cannot grant BYPASSRLS; fieldline_platform will use explicit RLS policies',
  );
}

/** Idempotent: adds the platform policy to every RLS-enabled table that lacks it. */
export async function ensurePlatformPolicies(sql: Sql): Promise<number> {
  const [role] = await sql<{ rolbypassrls: boolean }[]>`
    select rolbypassrls from pg_roles where rolname = 'fieldline_platform'`;
  if (!role || role.rolbypassrls) return 0;
  const tables = await sql<{ name: string }[]>`
    select quote_ident(n.nspname) || '.' || quote_ident(c.relname) as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and c.relrowsecurity and n.nspname = 'public'
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = n.nspname and p.tablename = c.relname and p.policyname = ${PLATFORM_POLICY}
      )`;
  for (const t of tables) {
    await sql.unsafe(
      `CREATE POLICY ${PLATFORM_POLICY} ON ${t.name} AS PERMISSIVE FOR ALL TO fieldline_platform USING (true) WITH CHECK (true)`,
    );
  }
  if (tables.length > 0) {
    console.info(`[migrate] platform policy added to ${tables.length} table(s)`);
  }
  return tables.length;
}
