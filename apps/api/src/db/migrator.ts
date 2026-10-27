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

/** Applies all pending SQL migrations in drizzle/ (idempotent; tracked in drizzle.__drizzle_migrations). */
export async function runMigrations(url: string): Promise<void> {
  const database = createDatabase(url, { max: 1, applicationName: 'migrate' });
  try {
    await migrate(database.db, { migrationsFolder: findMigrationsFolder() });
  } finally {
    await database.close();
  }
}
