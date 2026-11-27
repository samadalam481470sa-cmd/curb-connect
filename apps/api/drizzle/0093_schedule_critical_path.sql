-- 0093: critical-path scheduling (blueprint gap 1).
--   * schedule_dependencies: extra finish-to-start links between PM schedule
--     tasks with a whole-day lag. The legacy single predecessor_task_id on
--     schedule_tasks still counts as a lag-0 link in the CPM computation.
--   * schedule_baselines + schedule_baseline_tasks: an immutable, dated
--     snapshot of a job's entered task dates for baseline variance reporting.
CREATE TABLE public.schedule_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  job_id uuid NOT NULL,
  predecessor_task_id uuid NOT NULL,
  successor_task_id uuid NOT NULL,
  lag_days integer NOT NULL DEFAULT 0 CHECK (lag_days >= 0 AND lag_days <= 3650),
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_dependencies_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT schedule_dependencies_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT schedule_dependencies_job_id_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT schedule_dependencies_predecessor_task_id_fk FOREIGN KEY (org_id, predecessor_task_id) REFERENCES public.schedule_tasks(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT schedule_dependencies_successor_task_id_fk FOREIGN KEY (org_id, successor_task_id) REFERENCES public.schedule_tasks(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT schedule_dependencies_org_id_predecessor_task_id_successor_task_id_uq UNIQUE (org_id, predecessor_task_id, successor_task_id),
  CONSTRAINT schedule_dependencies_no_self_link CHECK (predecessor_task_id <> successor_task_id)
);
--> statement-breakpoint
CREATE INDEX schedule_dependencies_org_id_idx ON public.schedule_dependencies(org_id);
--> statement-breakpoint
CREATE INDEX schedule_dependencies_org_id_job_id_idx ON public.schedule_dependencies(org_id, job_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.schedule_dependencies');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_dependencies TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.schedule_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  job_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_baselines_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT schedule_baselines_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT schedule_baselines_job_id_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX schedule_baselines_org_id_idx ON public.schedule_baselines(org_id);
--> statement-breakpoint
CREATE INDEX schedule_baselines_org_id_job_id_captured_at_idx ON public.schedule_baselines(org_id, job_id, captured_at);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.schedule_baselines');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_baselines TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.schedule_baseline_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  baseline_id uuid NOT NULL,
  task_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) <= 300),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  progress_percent integer NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_baseline_tasks_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT schedule_baseline_tasks_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT schedule_baseline_tasks_baseline_id_fk FOREIGN KEY (org_id, baseline_id) REFERENCES public.schedule_baselines(org_id, id) ON DELETE CASCADE,
  CONSTRAINT schedule_baseline_tasks_org_id_baseline_id_task_id_uq UNIQUE (org_id, baseline_id, task_id)
);
--> statement-breakpoint
CREATE INDEX schedule_baseline_tasks_org_id_idx ON public.schedule_baseline_tasks(org_id);
--> statement-breakpoint
CREATE INDEX schedule_baseline_tasks_org_id_baseline_id_idx ON public.schedule_baseline_tasks(org_id, baseline_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.schedule_baseline_tasks');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_baseline_tasks TO fieldline_app, fieldline_platform;
