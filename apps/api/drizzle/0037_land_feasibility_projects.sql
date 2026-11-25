-- Saved land-feasibility projects (additive): a named snapshot of one feasibility run — the
-- inputs the builder entered (parcel, zoning rules, costs incl. sewer depth, timeline,
-- revenue, land price, home price) plus the client-computed summary (acres, lot count,
-- profit) — so the builder can flip between saved projects instead of re-entering a parcel.
-- The summary is stored exactly as the client computed it and labeled 'client-computed' in
-- the API response; the server never recomputes it (runFeasibility lives in the web app).
-- Separate from Land Scout's saved buy boxes (different feature, different table); only the
-- persistence pattern (org-scoped, tenant RLS, grants) is reused. No existing tables change.
CREATE TABLE public.land_feasibility_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) <= 120),
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT land_feasibility_projects_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT land_feasibility_projects_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX land_feasibility_projects_org_id_idx ON public.land_feasibility_projects(org_id);
--> statement-breakpoint
CREATE INDEX land_feasibility_projects_created_idx ON public.land_feasibility_projects(org_id, created_at);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.land_feasibility_projects');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.land_feasibility_projects TO fieldline_app, fieldline_platform;
