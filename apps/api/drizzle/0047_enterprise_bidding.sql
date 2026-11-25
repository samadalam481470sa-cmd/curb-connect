CREATE TABLE enterprise_suite.bid_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  title varchar(180) NOT NULL CHECK (length(trim(title)) >= 2),
  scope text NOT NULL CHECK (length(trim(scope)) BETWEEN 3 AND 8000),
  due_on date NOT NULL,
  status text NOT NULL DEFAULT 'collecting' CHECK (status IN ('collecting', 'awarded', 'closed')),
  awarded_quote_id uuid,
  decision_note text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'awarded') = (awarded_quote_id IS NOT NULL)),
  UNIQUE (org_id, project_id, id),
  UNIQUE (org_id, project_id, client_request_id),
  FOREIGN KEY (org_id, project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.bid_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  package_id uuid NOT NULL,
  vendor_name varchar(180) NOT NULL CHECK (length(trim(vendor_name)) >= 2),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 1000000000000),
  lead_days integer NOT NULL CHECK (lead_days BETWEEN 0 AND 3650),
  valid_through date NOT NULL,
  qualifications text NOT NULL DEFAULT '' CHECK (length(qualifications) <= 4000),
  client_request_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, package_id, id),
  UNIQUE (org_id, project_id, package_id, client_request_id),
  FOREIGN KEY (org_id, project_id, package_id) REFERENCES enterprise_suite.bid_packages(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
ALTER TABLE enterprise_suite.bid_packages ADD CONSTRAINT enterprise_package_awarded_quote_fk
  FOREIGN KEY (org_id, project_id, id, awarded_quote_id) REFERENCES enterprise_suite.bid_quotes(org_id, project_id, package_id, id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX enterprise_bid_packages_project_idx ON enterprise_suite.bid_packages(org_id, project_id, created_at DESC, id DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.bid_packages'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.bid_quotes'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON enterprise_suite.bid_packages TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.bid_quotes TO fieldline_app, fieldline_platform;
