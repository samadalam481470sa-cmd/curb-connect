// CLI: `npm run db:migrate` (DATABASE_URL) or `npm run db:migrate -- --test` (TEST_DATABASE_URL).
// In production it runs from the bundle: `node dist/migrate.js`.
import { loadEnvFiles } from '../env';
import { installJobQueue } from '../jobs/install';
import { runMigrations } from './migrator';
import { assertTestDatabaseUrl, describeDatabaseUrl } from './url';

loadEnvFiles();

const useTestDatabase = process.argv.includes('--test');
const url = useTestDatabase ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;

if (!url) {
  console.error(
    `${useTestDatabase ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} is not set (see apps/api/.env.example).`,
  );
  process.exit(1);
}
if (useTestDatabase) assertTestDatabaseUrl(url);

console.info(`[migrate] applying migrations to ${describeDatabaseUrl(url)}`);
try {
  await runMigrations(url);
  // graphile-worker schema, worker grants and the outbox enqueue function (src/jobs/install.ts).
  await installJobQueue(url);
  console.info('[migrate] database is up to date');
} catch (error) {
  console.error('[migrate] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}
