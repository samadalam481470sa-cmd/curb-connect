-- AI Home Builder: persistent projects and immutable, versioned designs (tenant-scoped, RLS).
-- Designs are validated by @fieldline/building-schema before insert; the CHECKs below only guard shape.
CREATE TABLE public.home_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  brief text NOT NULL DEFAULT '' CHECK (length(brief) <= 4000),
  target_area_sqft integer NOT NULL CHECK (target_area_sqft > 0),
  budget_cents bigint NOT NULL DEFAULT 0 CHECK (budget_cents >= 0),
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT home_projects_org_id_id_uq UNIQUE (org_id,id)
);
--> statement-breakpoint
CREATE INDEX home_projects_org_id_idx ON public.home_projects(org_id);
--> statement-breakpoint
CREATE INDEX home_projects_org_id_created_at_idx ON public.home_projects(org_id,created_at);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.home_projects');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.home_projects TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.home_design_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  design jsonb NOT NULL CHECK (jsonb_typeof(design) = 'object'),
  assumptions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(assumptions) = 'array'),
  issues jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(issues) = 'array'),
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT home_design_versions_org_id_id_uq UNIQUE (org_id,id),
  CONSTRAINT home_design_versions_org_id_project_id_version_number_uq UNIQUE (org_id,project_id,version_number),
  CONSTRAINT home_design_versions_project_fk FOREIGN KEY (org_id,project_id)
    REFERENCES public.home_projects(org_id,id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX home_design_versions_org_id_idx ON public.home_design_versions(org_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.home_design_versions');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.home_design_versions TO fieldline_app, fieldline_platform;
