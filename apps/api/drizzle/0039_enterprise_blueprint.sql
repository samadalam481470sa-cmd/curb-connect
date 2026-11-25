-- FieldPro Enterprise blueprint records (additive only; no existing table altered).
-- One row per work-package record; fields hold the blueprint-specified inputs. RLS keeps every
-- row inside the verified organization. Records may optionally link to a commercial project.
CREATE TABLE enterprise_suite.work_package_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid,
  package_code varchar(3) NOT NULL CHECK (package_code ~ '^[0-9]{3}$'),
  title varchar(255) NOT NULL CHECK (length(trim(title)) > 0),
  status text NOT NULL CHECK (length(trim(status)) > 0),
  fields jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(fields) = 'object'),
  notes text,
  client_request_id varchar(80),
  created_by_user_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_blueprint_project_fk FOREIGN KEY (org_id, project_id)
    REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT,
  UNIQUE (org_id, client_request_id)
);
--> statement-breakpoint
CREATE INDEX enterprise_blueprint_records_package_idx
  ON enterprise_suite.work_package_records(org_id, package_code, updated_at DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.work_package_records'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON enterprise_suite.work_package_records TO fieldline_app, fieldline_platform;
