// Job worker entry point: `tsx src/worker.ts` (dev) or the bundled equivalent.
// graphile-worker gives durable jobs in Postgres with retries and exponential backoff
// (per-task max attempts in src/jobs/outbox.ts JOB_TASKS); exhausted jobs stay in
// fieldline_job_dead_letters and their outbox rows are marked `dead` (BE-076 B).
// The worker connects with the owner login but runs as fieldline_platform (never superuser at
// runtime): see workerConnectionString().
import { run } from 'graphile-worker';
import { type AppConfig, ConfigError, loadConfig } from './config';
import { createDatabase } from './db/client';
import { describeDatabaseUrl } from './db/url';
import { loadEnvFiles } from './env';
import { installJobQueue, workerConnectionString } from './jobs/install';
import { buildTaskList } from './jobs/tasks';
import { createMailAdapter } from './services/mail';
import { startTelemetry } from './telemetry-sdk';

loadEnvFiles();

let config: AppConfig;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const telemetry = await startTelemetry(config, 'worker');

// Idempotent: makes sure graphile_worker and fieldline_enqueue_job exist before polling.
await installJobQueue(config.database.url);

const platform = createDatabase(config.database.url, { max: 4, applicationName: 'worker' });
const runner = await run({
  connectionString: workerConnectionString(config.database.url),
  concurrency: config.worker.concurrency,
  noHandleSignals: false,
  pollInterval: 2000,
  taskList: buildTaskList({ platformDb: platform.db, mail: createMailAdapter(config), config }),
});
console.info(`[worker] running against ${describeDatabaseUrl(config.database.url)} as fieldline_platform`);

try {
  await runner.promise;
} finally {
  await platform.close();
  await telemetry.shutdown().catch(() => undefined);
}
