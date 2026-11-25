CREATE TABLE enterprise_suite.schedule_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  title varchar(180) NOT NULL CHECK (length(trim(title)) >= 2),
  phase varchar(80) NOT NULL CHECK (length(trim(phase)) > 0),
  starts_on date NOT NULL,
  ends_on date NOT NULL CHECK (ends_on >= starts_on),
  predecessor_id uuid CHECK (predecessor_id <> id),
  lag_days integer NOT NULL DEFAULT 0 CHECK (lag_days BETWEEN 0 AND 365 AND (predecessor_id IS NOT NULL OR lag_days = 0)),
  progress_percent integer NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  actual_start_on date,
  actual_finish_on date CHECK (actual_finish_on >= actual_start_on),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, id),
  UNIQUE (org_id, project_id, client_request_id),
  FOREIGN KEY (org_id, project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, predecessor_id) REFERENCES enterprise_suite.schedule_tasks(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.schedule_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  label varchar(160) NOT NULL CHECK (length(trim(label)) >= 2),
  tasks jsonb NOT NULL CHECK (jsonb_typeof(tasks) = 'array'),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, client_request_id),
  FOREIGN KEY (org_id, project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX enterprise_schedule_baselines_history_idx ON enterprise_suite.schedule_baselines(org_id, project_id, created_at DESC, id DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.schedule_tasks'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.schedule_baselines'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON enterprise_suite.schedule_tasks TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.schedule_baselines TO fieldline_app, fieldline_platform;
