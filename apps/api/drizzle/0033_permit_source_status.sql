-- Permit source freshness (additive): one stored row per live permit source, refreshed daily by
-- the graphile-worker job `permit_sources_refresh` (apps/api/src/jobs/permitSources.ts) and read
-- by GET /v1/permit-leads/sources/status. Platform-owned, not tenant data: a re-run overwrites
-- the same row (source_id is the primary key), so a daily refresh never duplicates rows.
-- No RLS: no tenant rows exist; the API reads it through the named platform operation
-- `permit.sources_status` and the worker writes it as fieldline_platform.
-- NOTE: written by hand in the style of 0032. `drizzle-kit generate` currently emits the whole
-- schema (46 tables) because the meta snapshot drifted from the hand-edited migrations, so the
-- snapshot was left untouched rather than regenerated.
CREATE TABLE public.permit_source_statuses (
  source_id text PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'unknown',
  newest_permit_date timestamptz,
  count_30d integer NOT NULL DEFAULT 0,
  field_health jsonb,
  source_updated_at timestamptz,
  last_checked_at timestamptz NOT NULL,
  message text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permit_source_statuses TO fieldline_app, fieldline_platform;
