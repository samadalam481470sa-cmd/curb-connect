CREATE TABLE enterprise_suite.takeoff_symbol_detection_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  enabled boolean NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, revision),
  UNIQUE (org_id, client_request_id)
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.takeoff_symbol_detection_revisions'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.takeoff_symbol_detection_revisions TO fieldline_app, fieldline_platform;
