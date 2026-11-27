import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { createDatabase } from './client';

type Sql = ReturnType<typeof createDatabase>['client'];

const overlaps = [
  {
    originalTimestamp: 1796601600051,
    canonicalTimestamp: 1796601600053,
    skippedTimestamps: [1796601600051, 1796601600052],
  },
  {
    originalTimestamp: 1796601600054,
    canonicalTimestamp: 1796601600055,
    skippedTimestamps: [1796601600054],
  },
];

export async function reconcileFinanceMigrationHistory(sql: Sql, migrationsFolder: string) {
  const [metadata] = await sql<{ present: boolean }[]>`
    select to_regclass('drizzle.__drizzle_migrations') is not null as present
  `;
  if (!metadata?.present) return;

  const files = new Map(
    readMigrationFiles({ migrationsFolder }).map((migration) => [
      migration.folderMillis,
      migration,
    ]),
  );

  // Builder and Enterprise releases shared migration timestamps. Drizzle uses the
  // latest stamp as its cutoff, so replay skipped finance SQL by exact file hash
  // before normal migration and move the original receipt to its canonical stamp.
  await sql.begin(async (tx) => {
    await tx`lock table drizzle.__drizzle_migrations in share row exclusive mode`;
    for (const { originalTimestamp, canonicalTimestamp, skippedTimestamps } of overlaps) {
      const moved = files.get(canonicalTimestamp);
      const skipped = skippedTimestamps.map((timestamp) => files.get(timestamp));
      if (!moved || skipped.some((migration) => !migration)) continue;

      const [original] = await tx<{ id: number }[]>`
        select id from drizzle.__drizzle_migrations
        where hash = ${moved.hash} and created_at = ${originalTimestamp}
      `;
      if (!original) continue;
      for (const migration of skipped) {
        if (!migration) continue;
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
        update drizzle.__drizzle_migrations set created_at = ${moved.folderMillis}
        where id = ${original.id}
      `;
    }
  });
}
