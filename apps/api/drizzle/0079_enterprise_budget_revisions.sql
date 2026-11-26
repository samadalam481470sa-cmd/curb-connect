CREATE TABLE enterprise_suite.finance_budget_revision_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  budget_id uuid NOT NULL,
  base_version integer NOT NULL CHECK (base_version > 1),
  kind text NOT NULL CHECK (kind IN ('allocation_change', 'transfer')),
  reason varchar(1000) NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  reviewer_membership_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id, budget_id) REFERENCES enterprise_suite.finance_budget_baselines(org_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, reviewer_membership_id) REFERENCES public.memberships(org_id, id) ON DELETE RESTRICT,
  UNIQUE (org_id, project_id, budget_id, id),
  UNIQUE (org_id, project_id, budget_id, client_request_id)
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.finance_budget_revision_deltas (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  budget_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  cost_code_id uuid NOT NULL,
  prior_minor bigint NOT NULL CHECK (prior_minor >= 0),
  delta_minor bigint NOT NULL CHECK (delta_minor BETWEEN -1000000000000 AND 1000000000000 AND delta_minor <> 0),
  proposed_minor bigint NOT NULL CHECK (proposed_minor >= 0 AND proposed_minor = prior_minor + delta_minor),
  PRIMARY KEY (org_id, project_id, budget_id, revision_id, cost_code_id),
  FOREIGN KEY (org_id, project_id, budget_id, revision_id) REFERENCES enterprise_suite.finance_budget_revision_requests(org_id, project_id, budget_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, cost_code_id) REFERENCES enterprise_suite.purchase_cost_codes(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.finance_budget_revision_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  budget_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('approved', 'rejected')),
  reason varchar(1000) NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  activated_version integer CHECK (activated_version > 1),
  decided_by_user_id uuid NOT NULL,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id, budget_id, revision_id) REFERENCES enterprise_suite.finance_budget_revision_requests(org_id, project_id, budget_id, id) ON DELETE RESTRICT,
  CHECK ((outcome = 'approved') = (activated_version IS NOT NULL)),
  UNIQUE (org_id, project_id, budget_id, revision_id),
  UNIQUE (org_id, project_id, budget_id, activated_version),
  UNIQUE (org_id, project_id, budget_id, client_request_id)
);
--> statement-breakpoint
CREATE INDEX finance_budget_revision_requests_history_idx
  ON enterprise_suite.finance_budget_revision_requests(org_id, project_id, budget_id, created_at, id);
CREATE INDEX finance_budget_revision_decisions_history_idx
  ON enterprise_suite.finance_budget_revision_decisions(org_id, project_id, budget_id, created_at, id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.finance_budget_revision_requests'::regclass);
SELECT fieldline_enable_tenant_rls('enterprise_suite.finance_budget_revision_deltas'::regclass);
SELECT fieldline_enable_tenant_rls('enterprise_suite.finance_budget_revision_decisions'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.finance_budget_revision_requests TO fieldline_app, fieldline_platform;
GRANT SELECT, INSERT ON enterprise_suite.finance_budget_revision_deltas TO fieldline_app, fieldline_platform;
GRANT SELECT, INSERT ON enterprise_suite.finance_budget_revision_decisions TO fieldline_app, fieldline_platform;
