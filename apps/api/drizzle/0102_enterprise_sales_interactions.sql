CREATE TABLE enterprise_suite.sales_lead_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  opened_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, lead_id, id),
  FOREIGN KEY (org_id, lead_id) REFERENCES enterprise_suite.sales_leads(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.sales_lead_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('call', 'email', 'meeting')),
  occurred_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('attempted', 'contacted', 'follow_up_requested', 'no_further_contact')),
  notes text NOT NULL CHECK (length(trim(notes)) BETWEEN 1 AND 4000),
  conversation_id uuid,
  lead_revision integer NOT NULL CHECK (lead_revision > 1),
  recorded_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, lead_id, id),
  UNIQUE (org_id, lead_id, client_request_id),
  UNIQUE (org_id, lead_id, lead_revision),
  FOREIGN KEY (org_id, lead_id) REFERENCES enterprise_suite.sales_leads(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, lead_id, conversation_id)
    REFERENCES enterprise_suite.sales_lead_conversations(org_id, lead_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX sales_lead_interactions_order ON enterprise_suite.sales_lead_interactions
  (org_id, lead_id, occurred_at DESC, id DESC);
--> statement-breakpoint
CREATE TABLE enterprise_suite.sales_lead_follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  interaction_id uuid NOT NULL,
  due_at timestamptz NOT NULL,
  reminder_scheduled boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, lead_id, interaction_id),
  FOREIGN KEY (org_id, lead_id, interaction_id)
    REFERENCES enterprise_suite.sales_lead_interactions(org_id, lead_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.sales_follow_up_policy_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  pipeline_key text NOT NULL CHECK (pipeline_key = 'home_sales'),
  enabled boolean NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, pipeline_key, revision),
  UNIQUE (org_id, pipeline_key, client_request_id)
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_lead_conversations'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_lead_interactions'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_lead_follow_ups'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_follow_up_policy_revisions'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.sales_lead_conversations, enterprise_suite.sales_lead_interactions,
  enterprise_suite.sales_lead_follow_ups, enterprise_suite.sales_follow_up_policy_revisions
  TO fieldline_app, fieldline_platform;
