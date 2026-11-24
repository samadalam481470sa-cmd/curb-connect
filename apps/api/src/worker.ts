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
import { OUTREACH_CRONTAB } from './jobs/outreach';
import { PERMIT_SOURCES_CRONTAB } from './jobs/permitSources';
import { PERMIT_WATCH_CRONTAB } from './jobs/permitWatch';
import { buildTaskList } from './jobs/tasks';
import { createMailAdapter } from './services/mail';
import { createMailerClient } from './services/mailer-client';
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
  crontab: [OUTREACH_CRONTAB, PERMIT_WATCH_CRONTAB, PERMIT_SOURCES_CRONTAB].join('\n'),
  taskList: buildTaskList({
    platformDb: platform.db,
    mail: createMailAdapter(config),
    mailer: createMailerClient(config.mailer),
    config,
  }),
});
// Run saved permit searches that are out of date every time the server starts or wakes up.
// The job key keeps a restart loop from queueing the same check twice.
await runner
  .addJob('permit_watch_on_start', {}, { jobKey: 'permit_watch_on_start', maxAttempts: 1 })
  .catch((error: unknown) => console.error('[worker] could not queue startup permit check', error));
// Same for the daily permit-source freshness refresh: the task itself skips when the stored
// check is less than 24 hours old.
await runner
  .addJob('permit_sources_refresh_on_start', {}, { jobKey: 'permit_sources_refresh_on_start', maxAttempts: 1 })
  .catch((error: unknown) =>
    console.error('[worker] could not queue startup permit-source refresh', error),
  );
console.info(
  `[worker] running against ${describeDatabaseUrl(config.database.url)} as fieldline_platform`,
);

try {
  await runner.promise;
} finally {
  await platform.close();
  await telemetry.shutdown().catch(() => undefined);
}
