-- Keep the current purchasing cost-code string references. Budget clients also need
-- stable row IDs for selection and filtering.
ALTER TABLE enterprise_suite.purchase_cost_codes
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD CONSTRAINT purchase_cost_codes_project_uuid_key UNIQUE (org_id, project_id, id);
--> statement-breakpoint
CREATE TABLE enterprise_suite.finance_project_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  active boolean NOT NULL,
  reason varchar(500) NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  revision integer NOT NULL CHECK (revision > 0),
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, membership_id) REFERENCES public.memberships(org_id, id) ON DELETE RESTRICT,
  UNIQUE (org_id, project_id, membership_id, revision),
  UNIQUE (org_id, project_id, client_request_id)
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.finance_budget_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  effective_on date NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by_user_id uuid NOT NULL,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT,
  UNIQUE (org_id, project_id),
  UNIQUE (org_id, project_id, id)
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.finance_budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  budget_id uuid NOT NULL,
  cost_code_id uuid NOT NULL,
  description varchar(200) NOT NULL CHECK (length(trim(description)) BETWEEN 2 AND 200),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 0 AND 1000000000000),
  unit text NOT NULL CHECK (unit IN ('allowance', 'lump_sum', 'each', 'linear_ft', 'square_ft', 'cubic_yd', 'hour')),
  phase varchar(80) NOT NULL CHECK (length(trim(phase)) BETWEEN 2 AND 80),
  funding_source varchar(120) NOT NULL CHECK (length(trim(funding_source)) BETWEEN 2 AND 120),
  revision integer NOT NULL CHECK (revision > 1),
  created_by_user_id uuid NOT NULL,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id, budget_id) REFERENCES enterprise_suite.finance_budget_baselines(org_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, cost_code_id) REFERENCES enterprise_suite.purchase_cost_codes(org_id, project_id, id) ON DELETE RESTRICT,
  UNIQUE (org_id, project_id, budget_id, cost_code_id),
  UNIQUE (org_id, project_id, budget_id, revision),
  UNIQUE (org_id, project_id, budget_id, client_request_id)
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.finance_budget_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  budget_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 1),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  reason varchar(500) NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  approved_by_user_id uuid NOT NULL,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id, budget_id) REFERENCES enterprise_suite.finance_budget_baselines(org_id, project_id, id) ON DELETE RESTRICT,
  UNIQUE (org_id, project_id, budget_id)
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.finance_project_grants'::regclass);
SELECT fieldline_enable_tenant_rls('enterprise_suite.finance_budget_baselines'::regclass);
SELECT fieldline_enable_tenant_rls('enterprise_suite.finance_budget_lines'::regclass);
SELECT fieldline_enable_tenant_rls('enterprise_suite.finance_budget_approvals'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.finance_project_grants TO fieldline_app, fieldline_platform;
GRANT SELECT, INSERT, UPDATE ON enterprise_suite.finance_budget_baselines TO fieldline_app, fieldline_platform;
GRANT SELECT, INSERT ON enterprise_suite.finance_budget_lines TO fieldline_app, fieldline_platform;
GRANT SELECT, INSERT ON enterprise_suite.finance_budget_approvals TO fieldline_app, fieldline_platform;
