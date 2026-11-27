CREATE TABLE enterprise_suite.sales_pipeline_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  owner_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
  filters jsonb NOT NULL,
  columns jsonb NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('private', 'company')),
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, owner_user_id, client_request_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX sales_pipeline_view_owner_name ON enterprise_suite.sales_pipeline_views(org_id, owner_user_id, lower(name));
--> statement-breakpoint
CREATE INDEX sales_pipeline_view_page ON enterprise_suite.sales_pipeline_views(org_id, created_at DESC, id DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_pipeline_views'::regclass);
--> statement-breakpoint
CREATE POLICY sales_pipeline_view_visibility ON enterprise_suite.sales_pipeline_views AS RESTRICTIVE
  FOR SELECT TO fieldline_app USING (owner_user_id = fieldline_current_user_id() OR visibility = 'company');
--> statement-breakpoint
CREATE POLICY sales_pipeline_view_create_own ON enterprise_suite.sales_pipeline_views AS RESTRICTIVE
  FOR INSERT TO fieldline_app WITH CHECK (owner_user_id = fieldline_current_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.sales_pipeline_views TO fieldline_app, fieldline_platform;
