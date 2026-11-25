CREATE TABLE enterprise_suite.schedule_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  source_project_id uuid NOT NULL,
  label varchar(160) NOT NULL CHECK (length(trim(label)) BETWEEN 2 AND 160),
  tasks jsonb NOT NULL CHECK (jsonb_typeof(tasks) = 'array' AND jsonb_array_length(tasks) BETWEEN 1 AND 500),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, client_request_id),
  FOREIGN KEY (org_id, source_project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX enterprise_schedule_templates_org_idx ON enterprise_suite.schedule_templates(org_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE TABLE enterprise_suite.schedule_template_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  template_id uuid NOT NULL,
  starts_on date NOT NULL,
  task_count integer NOT NULL CHECK (task_count BETWEEN 1 AND 500),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  UNIQUE (org_id, project_id, client_request_id),
  FOREIGN KEY (org_id, project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, template_id) REFERENCES enterprise_suite.schedule_templates(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.schedule_templates'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.schedule_template_applications'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.schedule_templates, enterprise_suite.schedule_template_applications TO fieldline_app, fieldline_platform;
