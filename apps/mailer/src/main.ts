import { buildMailer } from './app';
import { loadConfig, loadEnvFiles } from './config';
import { createProviders } from './providers';
import { openStore } from './store';

loadEnvFiles();

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error((error as Error).message);
  console.error(
    'Copy apps/mailer/.env.example to apps/mailer/.env.local and fill it in (see docs/email-sending.md).',
  );
  process.exit(1);
}

const store = await openStore(config);
const providers = createProviders(config);
const app = await buildMailer({ config, store, providers, logger: { level: config.logLevel } });

const missing = [
  !providers.gmail && 'Gmail (GOOGLE_MAIL_CLIENT_ID/SECRET)',
  !providers.outlook && 'Outlook (MICROSOFT_MAIL_CLIENT_ID/SECRET)',
].filter(Boolean);
if (missing.length) app.log.warn(`Not configured yet, shown as unavailable: ${missing.join(', ')}`);
app.log.info(
  `Mailbox storage: ${config.databaseUrl ? 'PostgreSQL (schema "mailer")' : config.dataFile}`,
);

const shutdown = async () => {
  await app.close();
  await store.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await app.listen({ host: config.host, port: config.port });
