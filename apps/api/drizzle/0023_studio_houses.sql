-- House Studio saved houses: several per company, tenant-scoped with RLS like home_projects.
-- spec/settings are validated by @fieldline/contracts before insert; CHECKs only guard shape/size.
CREATE TABLE public.studio_houses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  source text NOT NULL CHECK (source IN ('ai','rules','plan','manual')),
  brief text NOT NULL DEFAULT '' CHECK (length(brief) <= 4000),
  spec jsonb NOT NULL CHECK (jsonb_typeof(spec) = 'object' AND pg_column_size(spec) <= 8192),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(settings) = 'object' AND pg_column_size(settings) <= 262144),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by_user_id uuid,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT studio_houses_org_id_id_uq UNIQUE (org_id,id)
);
--> statement-breakpoint
CREATE INDEX studio_houses_org_id_idx ON public.studio_houses(org_id);
--> statement-breakpoint
CREATE INDEX studio_houses_org_id_updated_at_idx ON public.studio_houses(org_id,updated_at);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.studio_houses');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.studio_houses TO fieldline_app, fieldline_platform;
