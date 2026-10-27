// Installs the durable job queue next to the Drizzle migrations (run by `npm run db:migrate` and
// the integration-test global setup, always with the OWNER connection):
//   1. graphile-worker's own schema migrations (graphile_worker.*),
//   2. least-privilege grants: only fieldline_platform (the worker role) can use the queue tables,
//   3. fieldline_enqueue_job(): the one narrow, SECURITY DEFINER entry point the restricted app role
//      may call to enqueue a job inside its own transaction (transactional outbox). It refuses
//      unknown tasks and any payload whose orgId differs from the transaction's app.org_id.
//   4. fieldline_job_dead_letters: view of jobs that exhausted their attempts (BE-076 B).
// Idempotent: safe to run on every deploy.
import { runMigrations as runGraphileMigrations } from 'graphile-worker';
import postgres from 'postgres';
import { JOB_TASKS } from './outbox';

const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function jobQueueSql(): string {
  const allowed = Object.keys(JOB_TASKS).map(quoteLiteral).join(', ');
  return `
GRANT USAGE ON SCHEMA graphile_worker TO fieldline_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA graphile_worker TO fieldline_platform;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA graphile_worker TO fieldline_platform;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA graphile_worker TO fieldline_platform;
REVOKE ALL ON SCHEMA graphile_worker FROM fieldline_app;

CREATE OR REPLACE FUNCTION public.fieldline_enqueue_job(
  task text, payload json, max_attempts int, job_key text DEFAULT NULL, run_at timestamptz DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE
  org uuid := public.fieldline_current_org_id();
  new_id bigint;
BEGIN
  IF org IS NULL THEN
    RAISE EXCEPTION 'fieldline_enqueue_job requires app.org_id' USING ERRCODE = '42501';
  END IF;
  IF (payload ->> 'orgId') IS DISTINCT FROM org::text THEN
    RAISE EXCEPTION 'job payload orgId does not match app.org_id' USING ERRCODE = '42501';
  END IF;
  IF task NOT IN (${allowed}) THEN
    RAISE EXCEPTION 'unknown job task %', task USING ERRCODE = '22023';
  END IF;
  SELECT (graphile_worker.add_job(task, payload, max_attempts => least(greatest(max_attempts, 1), 25),
          job_key => job_key, run_at => run_at)).id INTO new_id;
  RETURN new_id;
END
$fn$;
REVOKE ALL ON FUNCTION public.fieldline_enqueue_job(text, json, int, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fieldline_enqueue_job(text, json, int, text, timestamptz)
  TO fieldline_app, fieldline_platform;

DO $do$
BEGIN
  -- Prefer running the definer function as the non-superuser worker role.
  ALTER FUNCTION public.fieldline_enqueue_job(text, json, int, text, timestamptz) OWNER TO fieldline_platform;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'fieldline_enqueue_job stays owned by %: %', current_user, SQLERRM;
END
$do$;

CREATE OR REPLACE VIEW public.fieldline_job_dead_letters AS
SELECT j.id, t.identifier AS task, (j.payload ->> 'orgId') AS org_id,
       (j.payload ->> 'eventId') AS event_id, j.attempts, j.max_attempts, j.last_error,
       j.created_at, j.updated_at
FROM graphile_worker._private_jobs j
JOIN graphile_worker._private_tasks t ON t.id = j.task_id
WHERE j.attempts >= j.max_attempts AND j.locked_at IS NULL;
REVOKE ALL ON public.fieldline_job_dead_letters FROM PUBLIC, fieldline_app;
GRANT SELECT ON public.fieldline_job_dead_letters TO fieldline_platform;
`;
}

export async function installJobQueue(ownerUrl: string): Promise<void> {
  await runGraphileMigrations({ connectionString: ownerUrl, logger: undefined });
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(jobQueueSql());
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Connection string for graphile-worker: the owner login, but every session runs as
 * fieldline_platform (`options=-c role=...`), so the worker is never a superuser at runtime.
 */
export function workerConnectionString(ownerUrl: string): string {
  const url = new URL(ownerUrl);
  url.searchParams.set('options', '-c role=fieldline_platform');
  return url.toString();
}
