CREATE TABLE enterprise_suite.takeoff_plan_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  title varchar(180) NOT NULL CHECK (length(trim(title)) >= 2),
  revision_label varchar(60) NOT NULL CHECK (length(trim(revision_label)) >= 1),
  source_count integer NOT NULL CHECK (source_count BETWEEN 1 AND 5),
  sheet_count integer NOT NULL CHECK (sheet_count BETWEEN 1 AND 150),
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, id),
  UNIQUE (org_id, project_id, client_request_id),
  FOREIGN KEY (org_id, project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.takeoff_plan_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 150),
  page_number integer NOT NULL CHECK (page_number BETWEEN 1 AND 150),
  page_label varchar(120) NOT NULL CHECK (length(trim(page_label)) >= 1),
  width_points double precision NOT NULL CHECK (width_points > 0 AND width_points < 'Infinity'::float8),
  height_points double precision NOT NULL CHECK (height_points > 0 AND height_points < 'Infinity'::float8),
  rotation integer NOT NULL CHECK (rotation IN (0, 90, 180, 270)),
  UNIQUE (org_id, project_id, plan_id, ordinal),
  UNIQUE (org_id, project_id, plan_id, source_version_id, page_number),
  FOREIGN KEY (org_id, project_id, plan_id)
    REFERENCES enterprise_suite.takeoff_plan_sets(org_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, source_version_id)
    REFERENCES enterprise_suite.documents(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX enterprise_takeoff_plans_project_idx
  ON enterprise_suite.takeoff_plan_sets(org_id, project_id, created_at DESC, id DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.takeoff_plan_sets'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.takeoff_plan_sheets'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.takeoff_plan_sets, enterprise_suite.takeoff_plan_sheets
  TO fieldline_app, fieldline_platform;
