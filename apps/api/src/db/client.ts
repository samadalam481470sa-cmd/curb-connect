import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export interface CreateDatabaseOptions {
  /** Pool size. Migrations and one-off scripts use 1. */
  max?: number;
  /** Shows up in pg_stat_activity, which makes slow-query triage easier. */
  applicationName?: string;
}

/**
 * postgres.js pool + Drizzle. Columns are camelCase in TypeScript and snake_case in SQL.
 * Tenant isolation (docs/adr/0007): request handlers run inside a transaction that first calls
 * set_config('app.org_id', <org>, true) so Row-Level Security policies apply.
 */
export function createDatabase(url: string, options: CreateDatabaseOptions = {}) {
  const client = postgres(url, {
    max: options.max ?? 10,
    onnotice: () => {},
    connection: { application_name: options.applicationName ?? 'api' },
  });
  const db = drizzle({ client, schema, casing: 'snake_case' });
  return {
    db,
    client,
    close: () => client.end({ timeout: 5 }),
  };
}

export type DatabaseHandle = ReturnType<typeof createDatabase>;
export type Database = DatabaseHandle['db'];
