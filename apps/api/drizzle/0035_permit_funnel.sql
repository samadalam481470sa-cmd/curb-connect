-- Active Permits Funnel (additive): per-company pipeline state for funnel leads.
-- The lead itself is never stored — permits are re-fetched live from the city feeds on
-- every funnel open. Only the company's own stage + call log is kept here, keyed by
-- source + permit number (lead_key, e.g. 'collin:2026-12345').
-- Tenant-scoped; RLS follows the same pattern as permit_watches (drizzle/0002_rls_triggers.sql).
-- NOTE: written by hand in the style of 0033. `drizzle-kit generate` currently emits the whole
-- schema because the meta snapshot drifted from the hand-edited migrations, so the snapshot
-- was left untouched rather than regenerated.
CREATE TABLE public.permit_funnel_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  lead_key text NOT NULL,
  stage text NOT NULL DEFAULT 'new',
  call_count integer NOT NULL DEFAULT 0,
  last_call_at timestamptz,
  last_note text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permit_funnel_stages_org_lead_uq UNIQUE (org_id, lead_key)
);
--> statement-breakpoint
CREATE TABLE public.permit_funnel_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE RESTRICT,
  lead_key text NOT NULL,
  outcome text NOT NULL DEFAULT 'answered',
  note text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX permit_funnel_stages_org_id_idx ON public.permit_funnel_stages (org_id);
--> statement-breakpoint
CREATE INDEX permit_funnel_calls_org_lead_idx ON public.permit_funnel_calls (org_id, lead_key, created_at DESC);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permit_funnel_stages TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permit_funnel_calls TO fieldline_app, fieldline_platform;
