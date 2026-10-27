// API entry point: `npm run dev -w @fieldline/api` (tsx watch) or `node dist/main.js` (bundle).
import { buildApp } from './app';
import { type AppConfig, ConfigError, loadConfig } from './config';
import { createDatabase } from './db/client';
import { assertRestrictedRuntimeRole } from './db/runtime';
import { loadEnvFiles } from './env';
import { startTelemetry } from './telemetry-sdk';

loadEnvFiles();

let config: AppConfig;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    console.error('See apps/api/.env.example for every supported variable.');
    process.exit(1);
  }
  throw error;
}

const telemetry = await startTelemetry(config, 'api');

if (!config.database.appUrl) {
  console.error(
    'APP_DATABASE_URL is not set. The API must run as the restricted fieldline_app role so Row-Level ' +
      'Security applies (see apps/api/.env.example).',
  );
  process.exit(1);
}
const database = createDatabase(config.database.appUrl, { max: config.database.poolMax });
// BINDING DB ROLE RULE: refuse to serve requests on a role that bypasses RLS.
try {
  await assertRestrictedRuntimeRole(database);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  await database.close();
  process.exit(1);
}
// Owner connection for the narrow platform path only (every transaction: SET LOCAL ROLE
// fieldline_platform). Small pool on purpose.
const platformDatabase = createDatabase(config.database.url, { max: 2, applicationName: 'api-platform' });
const app = await buildApp({ config, database, platformDatabase });

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
  } finally {
    await database.close();
    await platformDatabase.close();
    await telemetry.shutdown().catch(() => undefined);
  }
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.server.host, port: config.server.port });
} catch (error) {
  app.log.error({ err: error }, 'failed to start');
  await database.close();
  await platformDatabase.close();
  process.exit(1);
}
