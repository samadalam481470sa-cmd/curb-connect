// Starts the mail server. Reads `.env` from this folder when it exists.
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { createApp } from './app';
import { loadConfig } from './config';
import { Store } from './db';

if (existsSync('.env')) process.loadEnvFile('.env');

const config = loadConfig();
const store = new Store(config.databasePath);
const server = createServer(createApp({ config, store }));
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;

const loopback =
  config.host === '127.0.0.1' || config.host === '::1' || config.host === 'localhost';
if (!loopback && !config.secureCookies) {
  console.warn(
    '[mail-connect] Listening beyond this computer without HTTPS. Put it behind HTTPS first.',
  );
}

const purge = setInterval(() => store.purgeExpired(), 60 * 60 * 1000);
purge.unref();

server.listen(config.port, config.host, () => {
  console.log(
    `[mail-connect] Open ${config.publicUrl} (listening on ${config.host}:${config.port})`,
  );
  console.log(
    `[mail-connect] Google: ${config.google ? 'on' : 'off'}, Microsoft: ${config.microsoft ? 'on' : 'off'}, database: ${config.databasePath}`,
  );
});

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
