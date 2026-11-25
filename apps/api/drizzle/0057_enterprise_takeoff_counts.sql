CREATE TABLE enterprise_suite.takeoff_count_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  sheet_id uuid NOT NULL,
  category_id uuid NOT NULL,
  symbol text NOT NULL CHECK (symbol IN ('circle', 'square', 'triangle', 'cross')),
  active_count integer NOT NULL CHECK (active_count BETWEEN 0 AND 500),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, plan_id, sheet_id, id),
  UNIQUE (org_id, project_id, plan_id, sheet_id, client_request_id),
  FOREIGN KEY (org_id, project_id, plan_id, sheet_id)
    REFERENCES enterprise_suite.takeoff_plan_sheets(org_id, project_id, plan_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, category_id)
    REFERENCES enterprise_suite.takeoff_categories(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.takeoff_count_markers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  sheet_id uuid NOT NULL,
  count_set_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 500),
  x double precision NOT NULL CHECK (x >= 0 AND x < 'Infinity'::float8),
  y double precision NOT NULL CHECK (y >= 0 AND y < 'Infinity'::float8),
  removed_at timestamptz,
  removed_by_user_id uuid,
  CHECK ((removed_at IS NULL) = (removed_by_user_id IS NULL)),
  UNIQUE (org_id, project_id, plan_id, sheet_id, count_set_id, ordinal),
  FOREIGN KEY (org_id, project_id, plan_id, sheet_id, count_set_id)
    REFERENCES enterprise_suite.takeoff_count_sets(org_id, project_id, plan_id, sheet_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX enterprise_takeoff_count_sets_sheet_idx
  ON enterprise_suite.takeoff_count_sets(org_id, project_id, plan_id, sheet_id, created_at DESC, id DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.takeoff_count_sets'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.takeoff_count_markers'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.takeoff_count_sets, enterprise_suite.takeoff_count_markers
  TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT UPDATE (revision, active_count) ON enterprise_suite.takeoff_count_sets TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT UPDATE (removed_at, removed_by_user_id) ON enterprise_suite.takeoff_count_markers
  TO fieldline_app, fieldline_platform;
