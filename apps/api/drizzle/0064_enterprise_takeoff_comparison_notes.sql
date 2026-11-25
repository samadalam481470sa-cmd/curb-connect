CREATE TABLE enterprise_suite.takeoff_comparison_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  old_plan_id uuid NOT NULL,
  old_sheet_id uuid NOT NULL,
  old_calibration_id uuid,
  new_plan_id uuid NOT NULL,
  new_sheet_id uuid NOT NULL,
  new_calibration_id uuid,
  comparison_key varchar(64) NOT NULL CHECK (comparison_key ~ '^[a-f0-9]{64}$'),
  alignment jsonb NOT NULL,
  x double precision NOT NULL CHECK (x BETWEEN 0 AND 1),
  y double precision NOT NULL CHECK (y BETWEEN 0 AND 1),
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 3 AND 1000),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  UNIQUE (org_id, project_id, client_request_id),
  FOREIGN KEY (org_id, project_id, old_plan_id, old_sheet_id)
    REFERENCES enterprise_suite.takeoff_plan_sheets(org_id, project_id, plan_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, new_plan_id, new_sheet_id)
    REFERENCES enterprise_suite.takeoff_plan_sheets(org_id, project_id, plan_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, old_plan_id, old_sheet_id, old_calibration_id)
    REFERENCES enterprise_suite.takeoff_calibrations(org_id, project_id, plan_id, sheet_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, new_plan_id, new_sheet_id, new_calibration_id)
    REFERENCES enterprise_suite.takeoff_calibrations(org_id, project_id, plan_id, sheet_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX takeoff_comparison_notes_page_idx ON enterprise_suite.takeoff_comparison_notes
  (org_id, project_id, comparison_key, created_at DESC, id DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.takeoff_comparison_notes'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.takeoff_comparison_notes TO fieldline_app, fieldline_platform;
