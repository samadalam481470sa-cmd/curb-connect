ALTER TABLE enterprise_suite.change_orders ADD CONSTRAINT enterprise_change_order_project_identity UNIQUE (org_id, project_id, id);
--> statement-breakpoint
CREATE TABLE enterprise_suite.change_pricing_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  change_order_id uuid NOT NULL,
  order_revision integer NOT NULL CHECK (order_revision > 0),
  scope text NOT NULL CHECK (length(trim(scope)) BETWEEN 3 AND 10000),
  schedule_impact_days integer NOT NULL CHECK (schedule_impact_days BETWEEN -3650 AND 3650),
  total_minor bigint NOT NULL CHECK (total_minor BETWEEN -1000000000000 AND 1000000000000),
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array' AND jsonb_array_length(lines) BETWEEN 1 AND 50),
  revision_note text NOT NULL CHECK (length(trim(revision_note)) BETWEEN 3 AND 1000),
  evidence_version_id uuid,
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, change_order_id, order_revision),
  UNIQUE (org_id, change_order_id, client_request_id),
  FOREIGN KEY (org_id, project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, change_order_id) REFERENCES enterprise_suite.change_orders(org_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, evidence_version_id) REFERENCES enterprise_suite.documents(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.change_pricing_revisions'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.change_pricing_revisions TO fieldline_app, fieldline_platform;
