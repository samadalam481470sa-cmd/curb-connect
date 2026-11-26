CREATE TABLE enterprise_suite.purchase_variance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  order_id uuid NOT NULL,
  order_revision integer NOT NULL CHECK (order_revision > 0),
  budget_id uuid NOT NULL,
  budget_version integer NOT NULL CHECK (budget_version > 0),
  approved_allocation_minor numeric(30, 0) NOT NULL CHECK (approved_allocation_minor >= 0),
  committed_minor numeric(30, 0) NOT NULL CHECK (committed_minor >= 0),
  requested_order_minor bigint NOT NULL CHECK (requested_order_minor BETWEEN 1 AND 1000000000000),
  overrun_minor numeric(30, 0) GENERATED ALWAYS AS
    (committed_minor + requested_order_minor - approved_allocation_minor) STORED,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  requested_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (overrun_minor > 0),
  UNIQUE (org_id, project_id, order_id, id),
  UNIQUE (org_id, project_id, order_id, client_request_id),
  FOREIGN KEY (org_id, project_id, order_id)
    REFERENCES enterprise_suite.purchase_orders(org_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, budget_id)
    REFERENCES enterprise_suite.finance_budget_baselines(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX enterprise_purchase_variance_order_idx
  ON enterprise_suite.purchase_variance_requests(org_id, project_id, order_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE TABLE enterprise_suite.purchase_variance_decisions (
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  order_id uuid NOT NULL,
  variance_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('approved', 'rejected')),
  authorized_delta_minor bigint NOT NULL CHECK (authorized_delta_minor BETWEEN 0 AND 9007199254740991),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  decided_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((outcome = 'approved') = (authorized_delta_minor > 0)),
  PRIMARY KEY (org_id, project_id, order_id, variance_id),
  UNIQUE (org_id, project_id, order_id, client_request_id),
  FOREIGN KEY (org_id, project_id, order_id, variance_id)
    REFERENCES enterprise_suite.purchase_variance_requests(org_id, project_id, order_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.purchase_variance_requests'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.purchase_variance_decisions'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.purchase_variance_requests, enterprise_suite.purchase_variance_decisions
  TO fieldline_app, fieldline_platform;
