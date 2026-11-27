CREATE TABLE enterprise_suite.sales_revenue_preferences (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, membership_id),
  FOREIGN KEY (org_id, membership_id) REFERENCES public.memberships(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.sales_opportunity_probabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  basis_points integer NOT NULL CHECK (basis_points BETWEEN 0 AND 10000),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  changed_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  client_request_id uuid NOT NULL,
  UNIQUE (org_id, lead_id, revision),
  UNIQUE (org_id, lead_id, client_request_id),
  FOREIGN KEY (org_id, lead_id) REFERENCES enterprise_suite.sales_leads(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_revenue_preferences'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_opportunity_probabilities'::regclass);
--> statement-breakpoint
CREATE POLICY sales_revenue_preference_owner ON enterprise_suite.sales_revenue_preferences AS RESTRICTIVE
  FOR ALL TO fieldline_app USING (user_id = fieldline_current_user_id())
  WITH CHECK (user_id = fieldline_current_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.sales_revenue_preferences, enterprise_suite.sales_opportunity_probabilities TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT UPDATE (enabled, revision, changed_at) ON enterprise_suite.sales_revenue_preferences TO fieldline_app;
