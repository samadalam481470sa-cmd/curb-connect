-- 0094: progress billing / AR (blueprint gap 2).
--   * schedules_of_values + sov_lines: per-job contract breakdown with a
--     contractor-entered retainage percent.
--   * progress_billing_applications + progress_billing_lines: periodic
--     applications (draft -> submitted -> approved/rejected -> invoiced).
--     Computed totals are frozen onto the application at approval; an
--     approved application generates a regular customer invoice.
CREATE TABLE public.schedules_of_values (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  job_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  contract_minor bigint NOT NULL CHECK (contract_minor >= 0),
  retainage_pct numeric(18,6) NOT NULL DEFAULT 0 CHECK (retainage_pct >= 0 AND retainage_pct <= 100),
  currency char(3) NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','closed')),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedules_of_values_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT schedules_of_values_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT schedules_of_values_job_id_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX schedules_of_values_org_id_idx ON public.schedules_of_values(org_id);
--> statement-breakpoint
CREATE INDEX schedules_of_values_org_id_job_id_status_idx ON public.schedules_of_values(org_id, job_id, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.schedules_of_values');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedules_of_values TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.sov_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  sov_id uuid NOT NULL,
  item_number text NOT NULL DEFAULT '' CHECK (length(item_number) <= 40),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 300),
  cost_code text CHECK (cost_code IS NULL OR length(cost_code) <= 60),
  scheduled_value_minor bigint NOT NULL CHECK (scheduled_value_minor >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sov_lines_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT sov_lines_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT sov_lines_sov_id_fk FOREIGN KEY (org_id, sov_id) REFERENCES public.schedules_of_values(org_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX sov_lines_org_id_idx ON public.sov_lines(org_id);
--> statement-breakpoint
CREATE INDEX sov_lines_org_id_sov_id_sort_order_idx ON public.sov_lines(org_id, sov_id, sort_order);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.sov_lines');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sov_lines TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.progress_billing_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  sov_id uuid NOT NULL,
  job_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  period_start date NOT NULL,
  period_end date NOT NULL CHECK (period_end >= period_start),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','invoiced')),
  invoice_id uuid,
  note text CHECK (note IS NULL OR length(note) <= 2000),
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by_user_id uuid,
  scheduled_total_minor bigint,
  completed_stored_total_minor bigint,
  previous_completed_stored_minor bigint,
  this_period_gross_minor bigint,
  retainage_to_date_minor bigint,
  retainage_this_period_minor bigint,
  current_due_minor bigint,
  balance_to_finish_minor bigint,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT progress_billing_applications_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT progress_billing_applications_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT progress_billing_applications_sov_id_fk FOREIGN KEY (org_id, sov_id) REFERENCES public.schedules_of_values(org_id, id) ON DELETE CASCADE,
  CONSTRAINT progress_billing_applications_job_id_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT progress_billing_applications_invoice_id_fk FOREIGN KEY (org_id, invoice_id) REFERENCES public.invoices(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT progress_billing_applications_org_id_sov_id_number_uq UNIQUE (org_id, sov_id, number)
);
--> statement-breakpoint
CREATE INDEX progress_billing_applications_org_id_idx ON public.progress_billing_applications(org_id);
--> statement-breakpoint
CREATE INDEX progress_billing_applications_org_id_sov_id_status_idx ON public.progress_billing_applications(org_id, sov_id, status);
--> statement-breakpoint
CREATE INDEX progress_billing_applications_org_id_job_id_status_idx ON public.progress_billing_applications(org_id, job_id, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.progress_billing_applications');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.progress_billing_applications TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.progress_billing_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  application_id uuid NOT NULL,
  sov_line_id uuid NOT NULL,
  percent_complete numeric(18,6) NOT NULL DEFAULT 0 CHECK (percent_complete >= 0 AND percent_complete <= 100),
  stored_materials_minor bigint NOT NULL DEFAULT 0 CHECK (stored_materials_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT progress_billing_lines_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT progress_billing_lines_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT progress_billing_lines_application_id_fk FOREIGN KEY (org_id, application_id) REFERENCES public.progress_billing_applications(org_id, id) ON DELETE CASCADE,
  CONSTRAINT progress_billing_lines_sov_line_id_fk FOREIGN KEY (org_id, sov_line_id) REFERENCES public.sov_lines(org_id, id) ON DELETE CASCADE,
  CONSTRAINT progress_billing_lines_org_id_application_id_sov_line_id_uq UNIQUE (org_id, application_id, sov_line_id)
);
--> statement-breakpoint
CREATE INDEX progress_billing_lines_org_id_idx ON public.progress_billing_lines(org_id);
--> statement-breakpoint
CREATE INDEX progress_billing_lines_org_id_application_id_idx ON public.progress_billing_lines(org_id, application_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.progress_billing_lines');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.progress_billing_lines TO fieldline_app, fieldline_platform;
