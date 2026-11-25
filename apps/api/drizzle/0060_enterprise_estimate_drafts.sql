CREATE TABLE enterprise_suite.project_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 180),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  client_request_id uuid NOT NULL,
  UNIQUE (org_id, project_id, id),
  UNIQUE (org_id, project_id, client_request_id),
  FOREIGN KEY (org_id, project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.project_estimate_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  estimate_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  quantity_precision smallint NOT NULL CHECK (quantity_precision BETWEEN 0 AND 8),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by_user_id uuid,
  approved_at timestamptz,
  approval_reason text CHECK (approval_reason IS NULL OR length(trim(approval_reason)) BETWEEN 3 AND 1000),
  CHECK (
    (status = 'draft' AND approved_by_user_id IS NULL AND approved_at IS NULL AND approval_reason IS NULL)
    OR (status = 'approved' AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL AND approval_reason IS NOT NULL)
  ),
  UNIQUE (org_id, project_id, id),
  UNIQUE (org_id, project_id, estimate_id, revision_number),
  FOREIGN KEY (org_id, project_id, estimate_id) REFERENCES enterprise_suite.project_estimates(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.project_estimate_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  estimate_revision_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 2 AND 300),
  unit text NOT NULL CHECK (unit IN ('ft', 'in', 'yd', 'm', 'cm', 'mm', 'sq_ft', 'sq_in', 'sq_yd', 'sq_m', 'sq_cm', 'sq_mm', 'ea')),
  quantity numeric CHECK (quantity >= 0 AND quantity < 'Infinity'::numeric),
  request_hash varchar(64) NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  client_request_id uuid NOT NULL,
  UNIQUE (org_id, project_id, estimate_revision_id, id),
  UNIQUE (org_id, project_id, estimate_revision_id, ordinal),
  UNIQUE (org_id, project_id, estimate_revision_id, client_request_id),
  FOREIGN KEY (org_id, project_id, estimate_revision_id) REFERENCES enterprise_suite.project_estimate_revisions(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX enterprise_estimate_revisions_project_idx ON enterprise_suite.project_estimate_revisions
  (org_id, project_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE FUNCTION enterprise_suite.guard_approved_estimate_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'approved' THEN
    RAISE EXCEPTION 'Approved estimate revisions are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER guard_approved_estimate_revision BEFORE UPDATE ON enterprise_suite.project_estimate_revisions
  FOR EACH ROW EXECUTE FUNCTION enterprise_suite.guard_approved_estimate_revision();
--> statement-breakpoint
CREATE FUNCTION enterprise_suite.guard_approved_estimate_lines() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  revision_status text;
BEGIN
  SELECT status INTO revision_status FROM enterprise_suite.project_estimate_revisions
    WHERE org_id = NEW.org_id AND project_id = NEW.project_id AND id = NEW.estimate_revision_id
    FOR UPDATE;
  IF revision_status = 'approved' THEN
    RAISE EXCEPTION 'Approved estimate lines are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER guard_approved_estimate_lines BEFORE INSERT OR UPDATE ON enterprise_suite.project_estimate_lines
  FOR EACH ROW EXECUTE FUNCTION enterprise_suite.guard_approved_estimate_lines();
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.project_estimates'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.project_estimate_revisions'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.project_estimate_lines'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.project_estimates, enterprise_suite.project_estimate_revisions,
  enterprise_suite.project_estimate_lines TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT UPDATE (revision, status, approved_by_user_id, approved_at, approval_reason)
  ON enterprise_suite.project_estimate_revisions TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT UPDATE (quantity) ON enterprise_suite.project_estimate_lines TO fieldline_app, fieldline_platform;
