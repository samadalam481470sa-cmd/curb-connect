CREATE TABLE enterprise_suite.takeoff_markup_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  sheet_id uuid NOT NULL,
  calibration_id uuid,
  source_version_id uuid NOT NULL,
  selected_review_ids uuid[] NOT NULL CHECK (cardinality(selected_review_ids) > 0),
  preview jsonb NOT NULL,
  template_version varchar(48) NOT NULL,
  storage_key text NOT NULL UNIQUE,
  sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  UNIQUE (org_id, project_id, client_request_id),
  FOREIGN KEY (org_id, project_id, plan_id, sheet_id)
    REFERENCES enterprise_suite.takeoff_plan_sheets(org_id, project_id, plan_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, plan_id, sheet_id, calibration_id)
    REFERENCES enterprise_suite.takeoff_calibrations(org_id, project_id, plan_id, sheet_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, source_version_id)
    REFERENCES enterprise_suite.documents(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX takeoff_markup_exports_sheet_idx ON enterprise_suite.takeoff_markup_exports
  (org_id, project_id, plan_id, sheet_id, created_at DESC, id DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.takeoff_markup_exports'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.takeoff_markup_exports TO fieldline_app, fieldline_platform;
