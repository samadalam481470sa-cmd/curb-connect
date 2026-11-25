CREATE TABLE enterprise_suite.daily_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  work_date date NOT NULL,
  weather varchar(250) NOT NULL DEFAULT '',
  crew_count integer NOT NULL CHECK (crew_count BETWEEN 0 AND 1000),
  labor_minutes integer NOT NULL CHECK (labor_minutes BETWEEN 0 AND crew_count * 1440),
  work_performed text NOT NULL CHECK (length(trim(work_performed)) BETWEEN 3 AND 6000),
  safety_and_delays text NOT NULL DEFAULT '' CHECK (length(safety_and_delays) <= 6000),
  schedule_task_id uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'changes_requested', 'approved')),
  review_note text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, work_date),
  UNIQUE (org_id, project_id, client_request_id),
  FOREIGN KEY (org_id, project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, schedule_task_id) REFERENCES enterprise_suite.schedule_tasks(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.daily_logs'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON enterprise_suite.daily_logs TO fieldline_app, fieldline_platform;
