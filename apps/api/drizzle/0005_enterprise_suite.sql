-- Enterprise Add-On foundation. No ALTERs on existing public tables.
-- All foreign keys are scoped to an enterprise project in the SAME organization.
CREATE SCHEMA IF NOT EXISTS enterprise_suite;
--> statement-breakpoint
CREATE TABLE enterprise_suite.settings (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  updated_by_user_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  name varchar(255) NOT NULL CHECK (length(trim(name)) > 0),
  original_contract_minor bigint NOT NULL DEFAULT 0 CHECK (original_contract_minor >= 0),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id,id)
);
--> statement-breakpoint
CREATE INDEX enterprise_projects_org_idx ON enterprise_suite.projects(org_id,updated_at DESC);
--> statement-breakpoint
CREATE TABLE enterprise_suite.rfis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  rfi_number integer NOT NULL CHECK (rfi_number > 0),
  subject varchar(255) NOT NULL CHECK (length(trim(subject)) > 0),
  question text NOT NULL CHECK (length(trim(question)) > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','answered','closed')),
  ball_in_court varchar(255) NOT NULL,
  official_response text,
  cost_impact boolean NOT NULL DEFAULT false,
  schedule_impact_days integer NOT NULL DEFAULT 0 CHECK (schedule_impact_days BETWEEN -3650 AND 3650),
  answered_at timestamptz,
  created_by_user_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_rfi_project_fk FOREIGN KEY (org_id,project_id) REFERENCES enterprise_suite.projects(org_id,id) ON DELETE RESTRICT,
  UNIQUE(org_id,project_id,rfi_number),
  UNIQUE(org_id,id)
);
--> statement-breakpoint
CREATE INDEX enterprise_rfis_project_idx ON enterprise_suite.rfis(org_id,project_id,status);
--> statement-breakpoint
CREATE TABLE enterprise_suite.submittals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  number varchar(50) NOT NULL,
  title varchar(255) NOT NULL CHECK (length(trim(title)) > 0),
  spec_section varchar(50) NOT NULL DEFAULT '',
  document_reference text,
  reviewer varchar(255) NOT NULL,
  status text NOT NULL DEFAULT 'required' CHECK (status IN ('required','submitted','under_review','approved','approved_as_noted','revise_and_resubmit','rejected')),
  current_revision integer NOT NULL DEFAULT 1,
  created_by_user_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_submittal_project_fk FOREIGN KEY (org_id,project_id) REFERENCES enterprise_suite.projects(org_id,id) ON DELETE RESTRICT,
  UNIQUE(org_id,project_id,number),
  UNIQUE(org_id,id)
);
--> statement-breakpoint
CREATE INDEX enterprise_submittals_project_idx ON enterprise_suite.submittals(org_id,project_id,status);
--> statement-breakpoint
CREATE TABLE enterprise_suite.change_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  number varchar(50) NOT NULL,
  title varchar(255) NOT NULL CHECK (length(trim(title)) > 0),
  description text NOT NULL,
  status text NOT NULL DEFAULT 'pco_draft' CHECK (status IN ('pco_draft','pricing_requested','priced','submitted_to_owner','approved','rejected')),
  amount_delta_minor bigint NOT NULL DEFAULT 0,
  schedule_impact_days integer NOT NULL DEFAULT 0,
  approved_at timestamptz,
  approved_by_user_id uuid,
  created_by_user_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_change_orders_project_fk FOREIGN KEY (org_id,project_id) REFERENCES enterprise_suite.projects(org_id,id) ON DELETE RESTRICT,
  UNIQUE(org_id,project_id,number),
  UNIQUE(org_id,id)
);
--> statement-breakpoint
CREATE INDEX enterprise_change_orders_project_idx ON enterprise_suite.change_orders(org_id,project_id,status);
--> statement-breakpoint
CREATE TABLE enterprise_suite.sov_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  cost_code varchar(20) NOT NULL,
  description text NOT NULL,
  scheduled_minor bigint NOT NULL CHECK (scheduled_minor >= 0),
  previous_minor bigint NOT NULL DEFAULT 0 CHECK (previous_minor >= 0),
  current_minor bigint NOT NULL DEFAULT 0 CHECK (current_minor >= 0),
  stored_minor bigint NOT NULL DEFAULT 0 CHECK (stored_minor >= 0),
  retainage_bps integer NOT NULL DEFAULT 1000 CHECK (retainage_bps BETWEEN 0 AND 10000),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_sov_project_fk FOREIGN KEY (org_id,project_id) REFERENCES enterprise_suite.projects(org_id,id) ON DELETE RESTRICT,
  CONSTRAINT enterprise_sov_total_check CHECK (previous_minor + current_minor + stored_minor <= scheduled_minor),
  UNIQUE(org_id,project_id,line_number)
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  filename text NOT NULL,
  storage_key text NOT NULL,
  sha256_hex varchar(64) NOT NULL CHECK (sha256_hex ~ '^[a-f0-9]{64}$'),
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  version integer NOT NULL DEFAULT 1,
  uploaded_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enterprise_documents_project_fk FOREIGN KEY (org_id,project_id) REFERENCES enterprise_suite.projects(org_id,id) ON DELETE RESTRICT,
  UNIQUE(org_id,storage_key,version),
  UNIQUE(org_id,id)
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL,
  object_type text NOT NULL,
  object_id uuid NOT NULL,
  action text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX enterprise_audit_org_idx ON enterprise_suite.audit_events(org_id,created_at DESC);
--> statement-breakpoint
CREATE FUNCTION enterprise_suite.prevent_audit_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'enterprise audit events are append-only' USING ERRCODE = 'FL001';
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_is_append_only BEFORE UPDATE OR DELETE ON enterprise_suite.audit_events
FOR EACH ROW EXECUTE FUNCTION enterprise_suite.prevent_audit_changes();
--> statement-breakpoint
-- The restricted API role can only touch rows of its verified org, never other tenants.
SELECT fieldline_enable_tenant_rls('enterprise_suite.settings'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.projects'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.rfis'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.submittals'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.change_orders'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sov_lines'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.documents'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.audit_events'::regclass);
--> statement-breakpoint
GRANT USAGE ON SCHEMA enterprise_suite TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA enterprise_suite TO fieldline_app,fieldline_platform;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON enterprise_suite.documents, enterprise_suite.audit_events FROM fieldline_app,fieldline_platform;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION enterprise_suite.prevent_audit_changes() TO fieldline_app,fieldline_platform;
