ALTER TABLE enterprise_suite.sales_leads
  ADD COLUMN pipeline_stage text NOT NULL DEFAULT 'new'
    CHECK (pipeline_stage IN ('new','attempting_contact','qualified','consultation','estimating','proposal_sent','negotiation','contract_sent','contract_signed','lost','nurture','project_created')),
  ADD COLUMN stage_entered_at timestamptz;
--> statement-breakpoint
CREATE INDEX sales_leads_pipeline_stage ON enterprise_suite.sales_leads(org_id, pipeline_stage, created_at DESC, id DESC);
--> statement-breakpoint
GRANT UPDATE (pipeline_stage, stage_entered_at) ON enterprise_suite.sales_leads TO fieldline_app;
--> statement-breakpoint
CREATE TABLE enterprise_suite.sales_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  from_stage text NOT NULL CHECK (from_stage IN ('new','attempting_contact','qualified','consultation','estimating','proposal_sent','negotiation','contract_sent','contract_signed','lost','nurture','project_created')),
  to_stage text NOT NULL CHECK (to_stage IN ('new','attempting_contact','qualified','consultation','estimating','proposal_sent','negotiation','contract_sent','contract_signed','lost','nurture','project_created')),
  reason text CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  previous_stage_duration_ms bigint NOT NULL CHECK (previous_stage_duration_ms >= 0),
  revision integer NOT NULL CHECK (revision > 1),
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_stage <> to_stage),
  UNIQUE (org_id, lead_id, revision),
  UNIQUE (org_id, lead_id, client_request_id),
  FOREIGN KEY (org_id, lead_id) REFERENCES enterprise_suite.sales_leads(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_stage_events'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.sales_stage_events TO fieldline_app, fieldline_platform;
