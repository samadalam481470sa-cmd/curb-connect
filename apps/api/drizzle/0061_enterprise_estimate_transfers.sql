ALTER TABLE enterprise_suite.takeoff_measurement_reviews
  ADD CONSTRAINT takeoff_reviews_project_id_unique UNIQUE (org_id, project_id, id);
--> statement-breakpoint
ALTER TABLE enterprise_suite.project_estimate_lines
  ADD COLUMN source_review_id uuid,
  ADD CONSTRAINT estimate_line_source_review_fk FOREIGN KEY (org_id, project_id, source_review_id)
    REFERENCES enterprise_suite.takeoff_measurement_reviews(org_id, project_id, id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE TABLE enterprise_suite.project_estimate_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  estimate_revision_id uuid NOT NULL,
  source_review_id uuid NOT NULL,
  applied_revision integer NOT NULL CHECK (applied_revision > 1),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  receipt jsonb NOT NULL,
  UNIQUE (org_id, project_id, estimate_revision_id, id),
  UNIQUE (org_id, project_id, estimate_revision_id, client_request_id),
  FOREIGN KEY (org_id, project_id, estimate_revision_id)
    REFERENCES enterprise_suite.project_estimate_revisions(org_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, source_review_id)
    REFERENCES enterprise_suite.takeoff_measurement_reviews(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.project_estimate_transfer_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  estimate_revision_id uuid NOT NULL,
  transfer_id uuid NOT NULL,
  estimate_line_id uuid NOT NULL,
  old_quantity numeric,
  old_source_review_id uuid,
  new_quantity numeric NOT NULL CHECK (new_quantity >= 0 AND new_quantity < 'Infinity'::numeric),
  unrounded_quantity numeric NOT NULL CHECK (unrounded_quantity >= 0 AND unrounded_quantity < 'Infinity'::numeric),
  replacement_reason text CHECK (replacement_reason IS NULL OR length(trim(replacement_reason)) BETWEEN 3 AND 1000),
  UNIQUE (org_id, project_id, estimate_revision_id, transfer_id, estimate_line_id),
  FOREIGN KEY (org_id, project_id, estimate_revision_id, estimate_line_id)
    REFERENCES enterprise_suite.project_estimate_lines(org_id, project_id, estimate_revision_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, estimate_revision_id, transfer_id)
    REFERENCES enterprise_suite.project_estimate_transfers(org_id, project_id, estimate_revision_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, old_source_review_id)
    REFERENCES enterprise_suite.takeoff_measurement_reviews(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.project_estimate_transfers'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.project_estimate_transfer_mappings'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.project_estimate_transfers, enterprise_suite.project_estimate_transfer_mappings
  TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT UPDATE (source_review_id) ON enterprise_suite.project_estimate_lines TO fieldline_app, fieldline_platform;
