ALTER TABLE enterprise_suite.sales_leads ADD COLUMN owner_membership_id uuid;
--> statement-breakpoint
ALTER TABLE enterprise_suite.sales_leads ADD CONSTRAINT sales_leads_owner_membership_fk
  FOREIGN KEY (org_id, owner_membership_id) REFERENCES public.memberships(org_id, id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX sales_leads_current_owner ON enterprise_suite.sales_leads(org_id, owner_membership_id)
  WHERE owner_membership_id IS NOT NULL;
--> statement-breakpoint
GRANT UPDATE (owner_membership_id, revision) ON enterprise_suite.sales_leads TO fieldline_app;
--> statement-breakpoint
CREATE TABLE enterprise_suite.sales_territory_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL,
  community_id uuid,
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 1000),
  active boolean NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, client_request_id),
  UNIQUE (org_id, id),
  UNIQUE NULLS NOT DISTINCT (org_id, membership_id, community_id, revision),
  FOREIGN KEY (org_id, membership_id) REFERENCES public.memberships(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, community_id) REFERENCES public.land_communities(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.sales_assignment_policy_revisions (
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
CREATE TABLE enterprise_suite.sales_lead_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  owner_membership_id uuid NOT NULL,
  previous_owner_membership_id uuid,
  territory_revision_id uuid NOT NULL,
  mode text NOT NULL CHECK (mode IN ('direct', 'round_robin')),
  revision integer NOT NULL CHECK (revision > 1),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  actor_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, lead_id, revision),
  UNIQUE (org_id, lead_id, client_request_id),
  FOREIGN KEY (org_id, lead_id) REFERENCES enterprise_suite.sales_leads(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, territory_revision_id) REFERENCES enterprise_suite.sales_territory_revisions(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, owner_membership_id) REFERENCES public.memberships(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, previous_owner_membership_id) REFERENCES public.memberships(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX sales_lead_round_robin_order ON enterprise_suite.sales_lead_assignments
  (org_id, owner_membership_id, created_at DESC, id DESC) WHERE mode = 'round_robin';
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_territory_revisions'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_assignment_policy_revisions'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_lead_assignments'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.sales_territory_revisions,
  enterprise_suite.sales_assignment_policy_revisions, enterprise_suite.sales_lead_assignments
  TO fieldline_app, fieldline_platform;
