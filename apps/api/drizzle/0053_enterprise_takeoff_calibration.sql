ALTER TABLE enterprise_suite.takeoff_plan_sheets
  ADD CONSTRAINT enterprise_takeoff_sheet_identity UNIQUE (org_id, project_id, plan_id, id);
--> statement-breakpoint
CREATE TABLE enterprise_suite.takeoff_calibrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  sheet_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  input jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, plan_id, sheet_id, revision),
  UNIQUE (org_id, project_id, plan_id, sheet_id, client_request_id),
  FOREIGN KEY (org_id, project_id, plan_id, sheet_id)
    REFERENCES enterprise_suite.takeoff_plan_sheets(org_id, project_id, plan_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.takeoff_calibrations'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.takeoff_calibrations TO fieldline_app, fieldline_platform;
