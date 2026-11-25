CREATE TABLE enterprise_suite.takeoff_calibration_lock_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  sheet_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  mode text NOT NULL CHECK (mode IN ('after_review', 'locked', 'unlocked')),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, plan_id, sheet_id, revision),
  UNIQUE (org_id, project_id, plan_id, sheet_id, client_request_id),
  FOREIGN KEY (org_id, project_id, plan_id, sheet_id)
    REFERENCES enterprise_suite.takeoff_plan_sheets(org_id, project_id, plan_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.takeoff_calibration_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  sheet_id uuid NOT NULL,
  base_calibration_id uuid NOT NULL,
  applied_calibration_id uuid,
  input jsonb NOT NULL,
  computed_result jsonb NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision IN (1, 2)),
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  submitted_by_user_id uuid NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decision_reason text CHECK (length(trim(decision_reason)) BETWEEN 3 AND 1000),
  decided_by_user_id uuid,
  decided_at timestamptz,
  UNIQUE (org_id, project_id, plan_id, sheet_id, client_request_id),
  FOREIGN KEY (org_id, project_id, plan_id, sheet_id, base_calibration_id)
    REFERENCES enterprise_suite.takeoff_calibrations(org_id, project_id, plan_id, sheet_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, plan_id, sheet_id, applied_calibration_id)
    REFERENCES enterprise_suite.takeoff_calibrations(org_id, project_id, plan_id, sheet_id, id) ON DELETE RESTRICT,
  CHECK (
    (status = 'pending' AND revision = 1 AND decision_reason IS NULL AND decided_by_user_id IS NULL AND decided_at IS NULL) OR
    (status IN ('approved', 'declined') AND revision = 2 AND decision_reason IS NOT NULL AND decided_by_user_id IS NOT NULL AND decided_at IS NOT NULL)
  ),
  CHECK ((applied_calibration_id IS NOT NULL) = (status = 'approved'))
);
--> statement-breakpoint
CREATE INDEX takeoff_calibration_change_requests_history_idx
  ON enterprise_suite.takeoff_calibration_change_requests (org_id, project_id, plan_id, sheet_id, submitted_at DESC, id DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.takeoff_calibration_lock_revisions'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.takeoff_calibration_change_requests'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.takeoff_calibration_lock_revisions TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON enterprise_suite.takeoff_calibration_change_requests TO fieldline_app, fieldline_platform;
