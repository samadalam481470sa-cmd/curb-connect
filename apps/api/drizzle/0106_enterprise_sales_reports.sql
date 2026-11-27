CREATE TABLE enterprise_suite.sales_report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  requested_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  requested_by_membership_id uuid NOT NULL,
  pipeline_id uuid NOT NULL CHECK (pipeline_id = '8d6659d1-ec6c-4243-96c2-730e849a0001'),
  filters jsonb NOT NULL,
  format text NOT NULL CHECK (format IN ('csv', 'json')),
  columns jsonb NOT NULL,
  omitted_columns jsonb NOT NULL,
  contact_purpose text CHECK (contact_purpose IN ('inquiry', 'marketing')),
  snapshot jsonb NOT NULL,
  row_count integer NOT NULL CHECK (row_count >= 0),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'ready', 'failed')),
  file_text text,
  sha256 varchar(64) CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (org_id, requested_by_user_id, client_request_id),
  FOREIGN KEY (org_id, requested_by_membership_id) REFERENCES public.memberships(org_id, id) ON DELETE RESTRICT,
  CHECK ((status = 'ready' AND file_text IS NOT NULL AND sha256 IS NOT NULL)
    OR (status <> 'ready' AND file_text IS NULL AND sha256 IS NULL))
);
--> statement-breakpoint
CREATE INDEX sales_report_runs_owner ON enterprise_suite.sales_report_runs(org_id, requested_by_user_id, created_at DESC, id DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_report_runs'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.sales_report_runs TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT UPDATE (status, file_text, sha256, completed_at, snapshot) ON enterprise_suite.sales_report_runs TO fieldline_platform;
