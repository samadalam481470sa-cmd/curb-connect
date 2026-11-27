CREATE TABLE enterprise_suite.sales_lead_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  created_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX sales_lead_sources_org_name ON enterprise_suite.sales_lead_sources(org_id, lower(name));
--> statement-breakpoint
CREATE TABLE enterprise_suite.sales_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  source_id uuid NOT NULL,
  community_id uuid,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  email text,
  phone text CHECK (phone ~ '^[0-9]{7,15}$'),
  contact_method text NOT NULL CHECK (contact_method IN ('none', 'email', 'phone')),
  consent jsonb NOT NULL,
  possible_duplicate boolean NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  inbound_event_id text,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, client_request_id),
  UNIQUE (org_id, source_id, inbound_event_id),
  FOREIGN KEY (org_id, source_id) REFERENCES enterprise_suite.sales_lead_sources(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, community_id) REFERENCES public.land_communities(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX sales_leads_email_match ON enterprise_suite.sales_leads(org_id, email) WHERE email IS NOT NULL;
--> statement-breakpoint
CREATE INDEX sales_leads_phone_match ON enterprise_suite.sales_leads(org_id, phone) WHERE phone IS NOT NULL;
--> statement-breakpoint
CREATE INDEX sales_leads_created_by ON enterprise_suite.sales_leads(org_id, created_by_user_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE TABLE enterprise_suite.sales_lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind = 'created'),
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, lead_id, kind),
  FOREIGN KEY (org_id, lead_id) REFERENCES enterprise_suite.sales_leads(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_lead_sources'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_leads'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_lead_activities'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.sales_lead_sources, enterprise_suite.sales_leads,
  enterprise_suite.sales_lead_activities TO fieldline_app, fieldline_platform;
