-- Phase E project management (additive): job-linked RFIs, submittals, schedule tasks (Gantt),
-- daily logs, drawings with versions/markup, punch items, checklists, fleet registry with
-- manual check-ins. No existing tables are changed. Crew scheduling reuses crews/schedules.
CREATE TABLE public.pm_rfis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  job_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  subject text NOT NULL CHECK (length(subject) <= 300),
  question text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','answered','closed')),
  assigned_to text,
  due_on date,
  official_response text,
  responded_at timestamptz,
  cost_impact boolean NOT NULL DEFAULT false,
  schedule_impact_days integer NOT NULL DEFAULT 0 CHECK (schedule_impact_days >= 0),
  attachment_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pm_rfis_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT pm_rfis_number_uq UNIQUE (org_id, job_id, number),
  CONSTRAINT pm_rfis_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT pm_rfis_job_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE public.pm_submittals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  job_id uuid NOT NULL,
  number text NOT NULL CHECK (length(number) <= 80),
  title text NOT NULL CHECK (length(title) <= 300),
  spec_section text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'required' CHECK (status IN ('required','submitted','under_review','approved','approved_as_noted','revise_and_resubmit','rejected')),
  reviewer text,
  due_on date,
  document_reference text,
  current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision > 0),
  attachment_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pm_submittals_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT pm_submittals_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT pm_submittals_job_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE public.schedule_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  job_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) <= 300),
  starts_on date NOT NULL,
  ends_on date NOT NULL CHECK (ends_on >= starts_on),
  progress_percent integer NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','in_progress','complete','on_hold')),
  predecessor_task_id uuid,
  crew_id uuid,
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_tasks_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT schedule_tasks_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT schedule_tasks_job_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT schedule_tasks_crew_fk FOREIGN KEY (org_id, crew_id) REFERENCES public.crews(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT schedule_tasks_predecessor_fk FOREIGN KEY (org_id, predecessor_task_id) REFERENCES public.schedule_tasks(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE public.daily_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  job_id uuid NOT NULL,
  log_date date NOT NULL,
  crew_id uuid,
  crew_count integer CHECK (crew_count IS NULL OR crew_count >= 0),
  work_done text NOT NULL,
  weather_notes text,
  delays text,
  notes text,
  photo_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_logs_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT daily_logs_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT daily_logs_job_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT daily_logs_crew_fk FOREIGN KEY (org_id, crew_id) REFERENCES public.crews(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE public.drawings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  job_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) <= 300),
  discipline text,
  sheet_number text,
  current_version_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drawings_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT drawings_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT drawings_job_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE public.drawing_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  drawing_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  file_reference text NOT NULL,
  file_name text,
  notes text,
  uploaded_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drawing_versions_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT drawing_versions_number_uq UNIQUE (org_id, drawing_id, version_number),
  CONSTRAINT drawing_versions_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT drawing_versions_drawing_fk FOREIGN KEY (org_id, drawing_id) REFERENCES public.drawings(org_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE public.drawings ADD CONSTRAINT drawings_current_version_fk
  FOREIGN KEY (org_id, current_version_id) REFERENCES public.drawing_versions(org_id, id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE public.drawing_markups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  version_id uuid NOT NULL,
  x_percent numeric(6,3) NOT NULL CHECK (x_percent BETWEEN 0 AND 100),
  y_percent numeric(6,3) NOT NULL CHECK (y_percent BETWEEN 0 AND 100),
  note text NOT NULL,
  author_name text,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drawing_markups_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT drawing_markups_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT drawing_markups_version_fk FOREIGN KEY (org_id, version_id) REFERENCES public.drawing_versions(org_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE public.punch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  job_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) <= 300),
  description text,
  location text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','ready_for_review','verified','rejected')),
  assignee_membership_id uuid,
  assignee_name text,
  due_on date,
  photo_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  verified_by_user_id uuid,
  verified_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT punch_items_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT punch_items_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT punch_items_job_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT punch_items_assignee_fk FOREIGN KEY (org_id, assignee_membership_id) REFERENCES public.memberships(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE public.checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) <= 200),
  kind text NOT NULL DEFAULT 'quality' CHECK (kind IN ('safety','quality','general')),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checklist_templates_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT checklist_templates_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE public.checklist_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  job_id uuid NOT NULL,
  template_id uuid,
  title text NOT NULL CHECK (length(title) <= 200),
  kind text NOT NULL DEFAULT 'quality' CHECK (kind IN ('safety','quality','general')),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed','signed')),
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  run_date date,
  signed_by_name text,
  signed_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checklist_runs_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT checklist_runs_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT checklist_runs_job_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT checklist_runs_template_fk FOREIGN KEY (org_id, template_id) REFERENCES public.checklist_templates(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE public.fleet_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) <= 200),
  kind text NOT NULL DEFAULT 'vehicle' CHECK (kind IN ('vehicle','equipment','trailer','tool')),
  identifier text,
  status text NOT NULL DEFAULT 'in_service' CHECK (status IN ('in_service','maintenance','out_of_service','retired')),
  assigned_job_id uuid,
  maintenance_due_on date,
  maintenance_notes text,
  notes text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fleet_assets_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT fleet_assets_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT fleet_assets_job_fk FOREIGN KEY (org_id, assigned_job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE public.fleet_check_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  location_text text NOT NULL CHECK (length(location_text) <= 300),
  job_id uuid,
  odometer integer CHECK (odometer IS NULL OR odometer >= 0),
  notes text,
  checked_in_by_user_id uuid,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fleet_check_ins_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT fleet_check_ins_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT fleet_check_ins_asset_fk FOREIGN KEY (org_id, asset_id) REFERENCES public.fleet_assets(org_id, id) ON DELETE CASCADE,
  CONSTRAINT fleet_check_ins_job_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX pm_rfis_org_id_idx ON public.pm_rfis(org_id);
--> statement-breakpoint
CREATE INDEX pm_rfis_job_status_idx ON public.pm_rfis(org_id, job_id, status);
--> statement-breakpoint
CREATE INDEX pm_submittals_org_id_idx ON public.pm_submittals(org_id);
--> statement-breakpoint
CREATE INDEX pm_submittals_job_status_idx ON public.pm_submittals(org_id, job_id, status);
--> statement-breakpoint
CREATE INDEX schedule_tasks_org_id_idx ON public.schedule_tasks(org_id);
--> statement-breakpoint
CREATE INDEX schedule_tasks_job_start_idx ON public.schedule_tasks(org_id, job_id, starts_on);
--> statement-breakpoint
CREATE INDEX daily_logs_org_id_idx ON public.daily_logs(org_id);
--> statement-breakpoint
CREATE INDEX daily_logs_job_date_idx ON public.daily_logs(org_id, job_id, log_date);
--> statement-breakpoint
CREATE INDEX drawings_org_id_idx ON public.drawings(org_id);
--> statement-breakpoint
CREATE INDEX drawings_job_idx ON public.drawings(org_id, job_id);
--> statement-breakpoint
CREATE INDEX drawing_versions_org_id_idx ON public.drawing_versions(org_id);
--> statement-breakpoint
CREATE INDEX drawing_versions_drawing_idx ON public.drawing_versions(org_id, drawing_id);
--> statement-breakpoint
CREATE INDEX drawing_markups_org_id_idx ON public.drawing_markups(org_id);
--> statement-breakpoint
CREATE INDEX drawing_markups_version_idx ON public.drawing_markups(org_id, version_id);
--> statement-breakpoint
CREATE INDEX punch_items_org_id_idx ON public.punch_items(org_id);
--> statement-breakpoint
CREATE INDEX punch_items_job_status_idx ON public.punch_items(org_id, job_id, status);
--> statement-breakpoint
CREATE INDEX checklist_templates_org_id_idx ON public.checklist_templates(org_id);
--> statement-breakpoint
CREATE INDEX checklist_templates_kind_idx ON public.checklist_templates(org_id, kind);
--> statement-breakpoint
CREATE INDEX checklist_runs_org_id_idx ON public.checklist_runs(org_id);
--> statement-breakpoint
CREATE INDEX checklist_runs_job_status_idx ON public.checklist_runs(org_id, job_id, status);
--> statement-breakpoint
CREATE INDEX fleet_assets_org_id_idx ON public.fleet_assets(org_id);
--> statement-breakpoint
CREATE INDEX fleet_assets_status_idx ON public.fleet_assets(org_id, status);
--> statement-breakpoint
CREATE INDEX fleet_check_ins_org_id_idx ON public.fleet_check_ins(org_id);
--> statement-breakpoint
CREATE INDEX fleet_check_ins_asset_idx ON public.fleet_check_ins(org_id, asset_id, checked_in_at);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.pm_rfis');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.pm_submittals');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.schedule_tasks');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.daily_logs');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.drawings');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.drawing_versions');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.drawing_markups');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.punch_items');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.checklist_templates');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.checklist_runs');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.fleet_assets');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.fleet_check_ins');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pm_rfis, public.pm_submittals, public.schedule_tasks, public.daily_logs, public.drawings, public.drawing_versions, public.drawing_markups, public.punch_items, public.checklist_templates, public.checklist_runs, public.fleet_assets, public.fleet_check_ins TO fieldline_app, fieldline_platform;
