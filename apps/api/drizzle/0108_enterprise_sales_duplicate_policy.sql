CREATE TABLE enterprise_suite.sales_duplicate_policy_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  enabled boolean NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  updated_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  client_request_id uuid NOT NULL,
  UNIQUE (org_id, revision),
  UNIQUE (org_id, client_request_id)
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_duplicate_policy_revisions'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.sales_duplicate_policy_revisions TO fieldline_app, fieldline_platform;
