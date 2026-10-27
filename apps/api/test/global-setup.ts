// Vitest global setup for the `integration` project: runs once before any integration test file.
// Applies the Drizzle migrations and installs the job queue (graphile-worker schema, worker grants,
// fieldline_enqueue_job, dead-letter view) exactly like `npm run db:migrate`, so a fresh CI
// database behaves like a developer's.
import { installJobQueue } from '../src/jobs/install';
import { runMigrations } from '../src/db/migrator';
import { assertTestDatabaseUrl, describeDatabaseUrl } from '../src/db/url';
import { loadEnvFiles } from '../src/env';

export default async function setup(): Promise<void> {
  loadEnvFiles();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Integration tests need the fieldline_test database: ' +
        'see apps/api/.env.example (locally) or the api-integration CI job.',
    );
  }
  assertTestDatabaseUrl(url);
  if (!process.env.TEST_APP_DATABASE_URL) {
    throw new Error(
      'TEST_APP_DATABASE_URL is not set. API integration tests run as the restricted fieldline_app role ' +
        '(NOSUPERUSER NOBYPASSRLS) so Row-Level Security is exercised; see apps/api/.env.example.',
    );
  }
  assertTestDatabaseUrl(process.env.TEST_APP_DATABASE_URL);
  await runMigrations(url);
  await installJobQueue(url);
  console.info(`[integration] migrated ${describeDatabaseUrl(url)} (+ job queue)`);
}
