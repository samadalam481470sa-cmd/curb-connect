import { defineConfig } from 'drizzle-kit';
import { loadEnvFiles } from './src/env';

loadEnvFiles();

// `npm run db:generate -w @fieldline/api` diffs src/db/schema against drizzle/ and writes a new SQL
// migration. Review every generated file: RLS policies, composite tenant FKs and extension objects
// are written by hand in the migration SQL where drizzle-kit cannot express them.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  // PostGIS owns spatial_ref_sys and friends; never diff or drop them.
  extensionsFilters: ['postgis'],
  strict: true,
  verbose: true,
});
