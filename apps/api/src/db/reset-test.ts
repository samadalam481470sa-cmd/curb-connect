// CLI: `npm run db:reset:test` wipes everything the app created in the TEST database and re-applies
// migrations. Only TEST_DATABASE_URL is ever touched, and only if its name ends in "_test".
// Extension-owned objects (PostGIS: spatial_ref_sys, functions, types) are preserved, because
// re-creating extensions can require superuser rights the app role may not have.
import { loadEnvFiles } from '../env';
import { createDatabase } from './client';
import { runMigrations } from './migrator';
import { assertTestDatabaseUrl, describeDatabaseUrl } from './url';

const DROP_APP_OBJECTS = `
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname FROM pg_namespace n
    WHERE n.nspname NOT IN ('public', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_namespace'::regclass AND d.objid = n.oid AND d.deptype = 'e')
      AND NOT EXISTS (SELECT 1 FROM pg_extension e WHERE e.extnamespace = n.oid)
  LOOP
    EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', r.nspname);
  END LOOP;

  FOR r IN
    SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('DROP %s IF EXISTS public.%I CASCADE',
      CASE r.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'
                     WHEN 'f' THEN 'FOREIGN TABLE' WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
      r.relname);
  END LOOP;

  FOR r IN
    SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd', 'r', 'c')
      AND (t.typtype <> 'c' OR EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = t.typrelid AND c.relkind = 'c'))
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_type'::regclass AND d.objid = t.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d
                      WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('DROP ROUTINE IF EXISTS %s CASCADE', r.signature);
  END LOOP;
END $$;
`;

loadEnvFiles();

const url = process.env.TEST_DATABASE_URL;
if (!url) {
  console.error('TEST_DATABASE_URL is not set (see apps/api/.env.example).');
  process.exit(1);
}
assertTestDatabaseUrl(url);

console.info(`[reset:test] wiping app objects in ${describeDatabaseUrl(url)}`);
const database = createDatabase(url, { max: 1, applicationName: 'reset-test' });
try {
  await database.client.unsafe(DROP_APP_OBJECTS);
} finally {
  await database.close();
}
await runMigrations(url);
console.info('[reset:test] test database recreated and migrated');
