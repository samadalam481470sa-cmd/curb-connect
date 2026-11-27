CREATE TABLE enterprise_suite.forecast_refresh_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  enabled boolean NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  changed_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT,
  UNIQUE (org_id, project_id, revision),
  UNIQUE (org_id, project_id, client_request_id)
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.forecast_refresh_revisions'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.forecast_refresh_revisions TO fieldline_app, fieldline_platform;
--> statement-breakpoint
ALTER TABLE enterprise_suite.cost_forecast_snapshots
  ADD COLUMN refresh_kind text,
  ADD COLUMN refresh_resource_id uuid,
  ADD COLUMN refresh_event_id uuid REFERENCES public.domain_events(id) ON DELETE RESTRICT,
  ADD COLUMN prior_forecast_id uuid,
  ADD CONSTRAINT enterprise_forecast_refresh_source_check CHECK (
    (refresh_kind IS NULL AND refresh_resource_id IS NULL AND refresh_event_id IS NULL AND prior_forecast_id IS NULL)
    OR
    (refresh_kind IN ('purchase_commitment', 'change_order', 'actual_bill')
      AND refresh_resource_id IS NOT NULL AND refresh_event_id IS NOT NULL AND prior_forecast_id IS NOT NULL)
  ),
  ADD CONSTRAINT enterprise_forecast_prior_source_fk
    FOREIGN KEY (org_id, project_id, prior_forecast_id)
      REFERENCES enterprise_suite.cost_forecast_snapshots(org_id, project_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT enterprise_forecast_refresh_event_uniq UNIQUE (org_id, project_id, refresh_event_id);
