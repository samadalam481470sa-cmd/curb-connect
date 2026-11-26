CREATE TABLE enterprise_suite.wip_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  period_id uuid NOT NULL,
  month_start date NOT NULL CHECK (extract(day from month_start) = 1),
  project_ids uuid[] NOT NULL CHECK (cardinality(project_ids) > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'ready', 'failed')),
  csv_text text,
  digest varchar(64) CHECK (digest ~ '^[a-f0-9]{64}$'),
  completed_at timestamptz,
  error_code text CHECK (error_code = 'report_generation_failed'),
  requested_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((csv_text IS NOT NULL) = (status = 'ready')),
  CHECK ((digest IS NOT NULL) = (status = 'ready')),
  CHECK ((completed_at IS NOT NULL) = (status IN ('ready', 'failed'))),
  CHECK ((error_code IS NOT NULL) = (status = 'failed')),
  UNIQUE (org_id, id),
  UNIQUE (org_id, client_request_id),
  FOREIGN KEY (org_id, month_start, period_id)
    REFERENCES enterprise_suite.cost_period_revisions(org_id, period_start, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX enterprise_wip_reports_author_idx
  ON enterprise_suite.wip_reports(org_id, requested_by_user_id, created_at DESC, id DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.wip_reports'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.wip_reports TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT UPDATE (status, csv_text, digest, completed_at, error_code) ON enterprise_suite.wip_reports TO fieldline_platform;
