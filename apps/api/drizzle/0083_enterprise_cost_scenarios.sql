CREATE TABLE enterprise_suite.cost_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  forecast_id uuid NOT NULL,
  name varchar(140) NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 140),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, id),
  UNIQUE (org_id, project_id, client_request_id),
  FOREIGN KEY (org_id, project_id, forecast_id)
    REFERENCES enterprise_suite.cost_forecast_snapshots(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX enterprise_cost_scenarios_history_idx
  ON enterprise_suite.cost_scenarios(org_id, project_id, created_at DESC, id DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.cost_scenarios'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.cost_scenarios TO fieldline_app, fieldline_platform;
