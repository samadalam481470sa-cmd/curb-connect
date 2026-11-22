-- Permit Job Search daily watch: one saved Texas permit search per company, run every morning
-- (or every two hours) by the job worker. Stores the latest ranked result. Tenant RLS.
CREATE TABLE public.permit_watches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  schedule text NOT NULL DEFAULT 'morning' CHECK (schedule IN ('morning','all_day')),
  search jsonb NOT NULL,
  last_run_at timestamptz,
  last_message text NOT NULL DEFAULT '' CHECK (length(last_message) <= 500),
  last_result jsonb,
  seen_keys text[] NOT NULL DEFAULT '{}',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permit_watches_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT permit_watches_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX permit_watches_org_id_idx ON public.permit_watches(org_id);
--> statement-breakpoint
CREATE UNIQUE INDEX permit_watches_org_id_uq ON public.permit_watches(org_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.permit_watches');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permit_watches TO fieldline_app, fieldline_platform;
