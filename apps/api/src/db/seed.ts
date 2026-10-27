// CLI: `npm run db:seed` runs every step in ./seeds against DATABASE_URL. Never in production.
import { loadEnvFiles } from '../env';
import { createDatabase } from './client';
import { seedSteps } from './seeds';
import { describeDatabaseUrl } from './url';

loadEnvFiles();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (see apps/api/.env.example).');
  process.exit(1);
}
if (process.env.NODE_ENV === 'production') {
  console.error('[seed] refusing to seed demo data with NODE_ENV=production');
  process.exit(1);
}

console.info(`[seed] seeding ${describeDatabaseUrl(url)}`);
const database = createDatabase(url, { max: 1, applicationName: 'seed' });
try {
  if (seedSteps.length === 0) {
    console.info('[seed] no seed steps are defined yet; nothing to do');
  }
  for (const step of seedSteps) {
    console.info(`[seed] ${step.name}`);
    await step.run(database.db);
  }
} catch (error) {
  console.error('[seed] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await database.close();
}
