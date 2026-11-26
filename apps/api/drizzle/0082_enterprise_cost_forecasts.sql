CREATE TABLE enterprise_suite.cost_forecast_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  budget_id uuid NOT NULL,
  budget_version integer NOT NULL CHECK (budget_version > 0),
  as_of date NOT NULL,
  currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  assumptions text NOT NULL CHECK (length(trim(assumptions)) BETWEEN 3 AND 4000),
  actual_minor numeric(30, 0) NOT NULL CHECK (actual_minor >= 0),
  known_remaining_minor numeric(30, 0) NOT NULL CHECK (known_remaining_minor >= 0),
  eac_minor numeric(30, 0) CHECK (eac_minor >= 0),
  contract_minor numeric(30, 0),
  margin_minor numeric(30, 0),
  status text NOT NULL CHECK (status IN ('complete', 'incomplete')),
  unconverted_currencies text[] NOT NULL DEFAULT '{}',
  created_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((eac_minor IS NOT NULL) = (status = 'complete')),
  CHECK (eac_minor IS NULL OR eac_minor = actual_minor + known_remaining_minor),
  CHECK (
    (margin_minor IS NULL AND (contract_minor IS NULL OR eac_minor IS NULL))
    OR (margin_minor IS NOT NULL AND contract_minor IS NOT NULL AND eac_minor IS NOT NULL
      AND margin_minor = contract_minor - eac_minor)
  ),
  UNIQUE (org_id, project_id, id),
  UNIQUE (org_id, project_id, client_request_id),
  FOREIGN KEY (org_id, project_id, budget_id)
    REFERENCES enterprise_suite.finance_budget_baselines(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX enterprise_cost_forecast_history_idx
  ON enterprise_suite.cost_forecast_snapshots(org_id, project_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE TABLE enterprise_suite.cost_forecast_lines (
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  forecast_id uuid NOT NULL,
  cost_code_id uuid NOT NULL,
  approved_budget_minor numeric(30, 0) NOT NULL CHECK (approved_budget_minor >= 0),
  actual_minor numeric(30, 0) NOT NULL CHECK (actual_minor >= 0),
  remaining_minor numeric(30, 0) CHECK (remaining_minor >= 0),
  method text NOT NULL CHECK (method IN ('remaining_cost', 'percent_complete', 'missing')),
  percent_complete_bps integer CHECK (percent_complete_bps BETWEEN 0 AND 10000),
  CHECK ((method = 'missing') = (remaining_minor IS NULL)),
  CHECK ((method = 'percent_complete') = (percent_complete_bps IS NOT NULL)),
  PRIMARY KEY (org_id, project_id, forecast_id, cost_code_id),
  FOREIGN KEY (org_id, project_id, forecast_id)
    REFERENCES enterprise_suite.cost_forecast_snapshots(org_id, project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, cost_code_id)
    REFERENCES enterprise_suite.purchase_cost_codes(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.cost_forecast_snapshots'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.cost_forecast_lines'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.cost_forecast_snapshots, enterprise_suite.cost_forecast_lines
  TO fieldline_app, fieldline_platform;
