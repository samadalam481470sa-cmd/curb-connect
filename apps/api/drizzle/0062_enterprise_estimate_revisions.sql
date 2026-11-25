ALTER TABLE enterprise_suite.project_estimate_revisions
  ADD COLUMN source_revision_id uuid,
  ADD COLUMN revision_reason text CHECK (revision_reason IS NULL OR length(trim(revision_reason)) BETWEEN 3 AND 1000),
  ADD COLUMN revision_request_id uuid,
  ADD COLUMN revision_request_hash varchar(64),
  ADD CONSTRAINT commercial_revision_origin_check CHECK (
    (source_revision_id IS NULL AND revision_reason IS NULL AND revision_request_id IS NULL AND revision_request_hash IS NULL)
    OR (source_revision_id IS NOT NULL AND revision_reason IS NOT NULL AND revision_request_id IS NOT NULL AND revision_request_hash IS NOT NULL)
  ),
  ADD CONSTRAINT commercial_revision_scope_key UNIQUE (org_id, project_id, estimate_id, id),
  ADD CONSTRAINT commercial_revision_same_estimate_fk
    FOREIGN KEY (org_id, project_id, estimate_id, source_revision_id)
    REFERENCES enterprise_suite.project_estimate_revisions(org_id, project_id, estimate_id, id) ON DELETE RESTRICT,
  DROP CONSTRAINT project_estimate_revisions_status_check,
  DROP CONSTRAINT project_estimate_revisions_check,
  ADD CONSTRAINT project_estimate_revisions_status_check CHECK (status IN ('draft', 'approved', 'superseded')),
  ADD CONSTRAINT project_estimate_revisions_approval_check CHECK (
    (status = 'approved' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL AND approval_reason IS NOT NULL)
    OR (status <> 'approved' AND approved_by_user_id IS NULL AND approved_at IS NULL AND approval_reason IS NULL)
  );
--> statement-breakpoint
CREATE UNIQUE INDEX estimating_revision_request_idx ON enterprise_suite.project_estimate_revisions
  (org_id, project_id, estimate_id, revision_request_id) WHERE revision_request_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE enterprise_suite.project_estimate_lines ADD COLUMN lineage_id uuid;
--> statement-breakpoint
CREATE UNIQUE INDEX estimating_revision_lineage_idx ON enterprise_suite.project_estimate_lines
  (org_id, project_id, estimate_revision_id, coalesce(lineage_id, id));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enterprise_suite.guard_approved_estimate_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Published or superseded estimate revisions are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enterprise_suite.guard_approved_estimate_lines() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  revision_status text;
BEGIN
  SELECT status INTO revision_status FROM enterprise_suite.project_estimate_revisions
    WHERE org_id = NEW.org_id AND project_id = NEW.project_id AND id = NEW.estimate_revision_id
    FOR UPDATE;
  IF revision_status <> 'draft' THEN
    RAISE EXCEPTION 'Published or superseded estimate lines are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
