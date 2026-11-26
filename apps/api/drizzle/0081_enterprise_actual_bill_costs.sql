CREATE TABLE enterprise_suite.cost_period_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  period_start date NOT NULL CHECK (extract(day from period_start) = 1),
  version integer NOT NULL CHECK (version IN (1, 2)),
  state text NOT NULL CHECK (state IN ('open', 'closed')),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((version = 1 AND state = 'open') OR (version = 2 AND state = 'closed')),
  UNIQUE (org_id, period_start, version),
  UNIQUE (org_id, period_start, id),
  UNIQUE (org_id, client_request_id)
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.actual_bill_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  bill_id uuid NOT NULL,
  approval_event_id uuid NOT NULL,
  bill_number text NOT NULL,
  issuer_name text NOT NULL,
  posting_on date NOT NULL,
  period_start date NOT NULL CHECK (
    extract(day from period_start) = 1 AND
    posting_on >= period_start AND posting_on < (period_start + interval '1 month')::date
  ),
  period_revision_id uuid NOT NULL,
  currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  total_minor bigint NOT NULL CHECK (total_minor BETWEEN 1 AND 9007199254740991),
  posted_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, bill_id),
  UNIQUE (org_id, client_request_id),
  UNIQUE (org_id, project_id, id),
  FOREIGN KEY (org_id, project_id)
    REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, bill_id)
    REFERENCES public.network_bills(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, approval_event_id)
    REFERENCES public.audit_events(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, period_start, period_revision_id)
    REFERENCES enterprise_suite.cost_period_revisions(org_id, period_start, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX enterprise_actual_bill_postings_project_date_idx
  ON enterprise_suite.actual_bill_postings(org_id, project_id, posting_on DESC, id DESC);
--> statement-breakpoint
CREATE TABLE enterprise_suite.actual_bill_allocations (
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  posting_id uuid NOT NULL,
  cost_code_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  PRIMARY KEY (org_id, project_id, posting_id, cost_code_id),
  FOREIGN KEY (org_id, project_id, posting_id)
    REFERENCES enterprise_suite.actual_bill_postings(org_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, cost_code_id)
    REFERENCES enterprise_suite.purchase_cost_codes(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.cost_period_revisions'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.actual_bill_postings'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.actual_bill_allocations'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.cost_period_revisions,
  enterprise_suite.actual_bill_postings, enterprise_suite.actual_bill_allocations
  TO fieldline_app, fieldline_platform;
