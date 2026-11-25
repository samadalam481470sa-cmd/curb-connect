ALTER TABLE enterprise_suite.takeoff_calibrations
  ADD CONSTRAINT enterprise_takeoff_calibration_identity UNIQUE (org_id, project_id, plan_id, sheet_id, id);
--> statement-breakpoint
CREATE TABLE enterprise_suite.takeoff_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  name varchar(100) NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 100),
  name_key text GENERATED ALWAYS AS (lower(trim(name))) STORED,
  created_by_user_id uuid NOT NULL,
  UNIQUE (org_id, project_id, id),
  UNIQUE (org_id, project_id, name_key),
  FOREIGN KEY (org_id, project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.takeoff_lengths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  sheet_id uuid NOT NULL,
  calibration_id uuid NOT NULL,
  category_id uuid NOT NULL,
  vertices jsonb NOT NULL CHECK (
    CASE WHEN jsonb_typeof(vertices) = 'array' THEN jsonb_array_length(vertices) BETWEEN 2 AND 250 ELSE false END
  ),
  drawing_length double precision NOT NULL CHECK (drawing_length > 0 AND drawing_length < 'Infinity'::float8),
  length double precision NOT NULL CHECK (length > 0 AND length < 'Infinity'::float8),
  unit text NOT NULL CHECK (unit IN ('ft', 'in', 'yd', 'm', 'cm', 'mm')),
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, plan_id, sheet_id, client_request_id),
  FOREIGN KEY (org_id, project_id, plan_id, sheet_id, calibration_id)
    REFERENCES enterprise_suite.takeoff_calibrations(org_id, project_id, plan_id, sheet_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, category_id)
    REFERENCES enterprise_suite.takeoff_categories(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX enterprise_takeoff_lengths_sheet_idx
  ON enterprise_suite.takeoff_lengths(org_id, project_id, plan_id, sheet_id, created_at DESC, id DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.takeoff_categories'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.takeoff_lengths'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.takeoff_categories, enterprise_suite.takeoff_lengths
  TO fieldline_app, fieldline_platform;
