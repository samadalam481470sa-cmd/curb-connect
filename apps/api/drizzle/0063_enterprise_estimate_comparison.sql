ALTER TABLE enterprise_suite.project_estimate_lines
  ADD COLUMN unit_price_minor bigint CHECK (unit_price_minor BETWEEN 0 AND 9007199254740991),
  ADD COLUMN last_change_reason text CHECK (last_change_reason IS NULL OR length(trim(last_change_reason)) BETWEEN 3 AND 1000);
--> statement-breakpoint
GRANT UPDATE (description, unit, unit_price_minor, last_change_reason)
  ON enterprise_suite.project_estimate_lines TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE enterprise_suite.project_estimate_line_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  estimate_revision_id uuid NOT NULL,
  estimate_line_id uuid NOT NULL,
  resulting_revision integer NOT NULL CHECK (resulting_revision > 1),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  actor_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  before_line jsonb NOT NULL,
  after_line jsonb NOT NULL,
  UNIQUE (org_id, project_id, estimate_revision_id, client_request_id),
  FOREIGN KEY (org_id, project_id, estimate_revision_id, estimate_line_id)
    REFERENCES enterprise_suite.project_estimate_lines(org_id, project_id, estimate_revision_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.project_estimate_line_edits'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.project_estimate_line_edits TO fieldline_app, fieldline_platform;
