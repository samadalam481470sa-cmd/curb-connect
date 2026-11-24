-- Gov Opportunities scan results (additive): one stored row per (seed .gov page, outbound link),
-- refreshed daily by the graphile-worker job `gov_opportunities_refresh`
-- (apps/api/src/jobs/govOpportunities.ts) and read by GET /v1/gov-opportunities and
-- GET /v1/gov-opportunities/status. Platform-owned, not tenant data: a re-run overwrites the
-- same row (key is the deterministic page+link key), so a daily refresh never duplicates rows.
-- No RLS: no tenant rows exist; the API reads it through the named platform operation
-- `gov.opportunities` and the worker writes it as fieldline_platform.
-- NOTE: written by hand in the style of 0033. `drizzle-kit generate` currently emits the whole
-- schema (46 tables) because the meta snapshot drifted from the hand-edited migrations, so the
-- snapshot was left untouched rather than regenerated.
CREATE TABLE public.gov_link_checks (
  key text PRIMARY KEY,
  page_id text NOT NULL,
  page_name text NOT NULL,
  page_city text NOT NULL,
  page_url text NOT NULL,
  link_url text NOT NULL,
  link_text text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'unknown',
  http_status integer,
  checked_at timestamptz NOT NULL,
  note text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gov_link_checks TO fieldline_app, fieldline_platform;
