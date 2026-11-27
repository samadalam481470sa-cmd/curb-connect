import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { createDatabase } from './client';

type Sql = ReturnType<typeof createDatabase>['client'];
const varianceTimestamp = 1796601600051;
const wipTimestamp = 1796601600052;
const builderTimestamp = 1796601600053;

export async function reconcileFinanceMigrationHistory(sql: Sql, migrationsFolder: string) {
  const [metadata] = await sql<{ present: boolean }[]>`
    select to_regclass('drizzle.__drizzle_migrations') is not null as present
  `;
  if (!metadata?.present) return;

  const files = readMigrationFiles({ migrationsFolder });
  const variance = files.find(({ folderMillis }) => folderMillis === varianceTimestamp);
  const wip = files.find(({ folderMillis }) => folderMillis === wipTimestamp);
  const builder = files.find(({ folderMillis }) => folderMillis === builderTimestamp);
  if (!variance || !wip || !builder) return;

  // Both branches shipped a version of 0084 at the same timestamp. Drizzle uses
  // the latest timestamp as its cutoff, so replay skipped finance SQL by its file
  // hash before normal migration and move the already-applied Builder receipt.
  await sql.begin(async (tx) => {
    await tx`lock table drizzle.__drizzle_migrations in share row exclusive mode`;
    const [oldBuilder] = await tx<{ id: number }[]>`
      select id from drizzle.__drizzle_migrations
      where hash = ${builder.hash} and created_at = ${varianceTimestamp}
    `;
    if (!oldBuilder) return;

    for (const migration of [variance, wip]) {
      const [applied] = await tx`
        select 1 from drizzle.__drizzle_migrations where hash = ${migration.hash}
      `;
      if (applied) continue;
      for (const statement of migration.sql) await tx.unsafe(statement);
      await tx`
        insert into drizzle.__drizzle_migrations (hash, created_at)
        values (${migration.hash}, ${migration.folderMillis})
      `;
    }
    await tx`
      update drizzle.__drizzle_migrations set created_at = ${builder.folderMillis}
      where id = ${oldBuilder.id}
    `;
  });
}
