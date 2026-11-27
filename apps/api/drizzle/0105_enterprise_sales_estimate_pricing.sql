ALTER TABLE enterprise_suite.sales_estimate_drafts ADD CONSTRAINT sales_estimates_org_opportunity_id_key
  UNIQUE (org_id, opportunity_id, id);
--> statement-breakpoint
CREATE TABLE enterprise_suite.sales_estimate_pricing_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  estimate_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 1),
  approval_snapshot jsonb NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  approved_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, opportunity_id, estimate_id),
  UNIQUE (org_id, opportunity_id, client_request_id),
  FOREIGN KEY (org_id, opportunity_id, estimate_id)
    REFERENCES enterprise_suite.sales_estimate_drafts(org_id, opportunity_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_estimate_pricing_approvals'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.sales_estimate_pricing_approvals TO fieldline_app, fieldline_platform;
--> statement-breakpoint
ALTER TABLE enterprise_suite.sales_estimate_pricing_approvals ADD CONSTRAINT sales_pricing_org_opportunity_id_key
  UNIQUE (org_id, opportunity_id, id);
--> statement-breakpoint
CREATE TABLE enterprise_suite.sales_proposal_template_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 3 AND 200),
  revision integer NOT NULL CHECK (revision > 0),
  terms jsonb NOT NULL,
  payment_terms jsonb NOT NULL,
  tax_treatment text NOT NULL CHECK (length(trim(tax_treatment)) BETWEEN 1 AND 500),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  approved_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, client_request_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX sales_proposal_template_name_revision ON enterprise_suite.sales_proposal_template_revisions(org_id, lower(name), revision);
--> statement-breakpoint
CREATE TABLE enterprise_suite.sales_proposal_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  estimate_revision_id uuid NOT NULL,
  template_revision_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  proposal_version_id uuid NOT NULL,
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  valid_until date NOT NULL,
  pdf_bytes bytea NOT NULL CHECK (octet_length(pdf_bytes) > 0),
  pdf_sha256 varchar(64) NOT NULL CHECK (pdf_sha256 ~ '^[a-f0-9]{64}$'),
  revision integer NOT NULL CHECK (revision > 1),
  created_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, opportunity_id, estimate_revision_id),
  UNIQUE (org_id, opportunity_id, client_request_id),
  UNIQUE (org_id, proposal_id),
  UNIQUE (org_id, proposal_version_id),
  FOREIGN KEY (org_id, opportunity_id, estimate_revision_id)
    REFERENCES enterprise_suite.sales_estimate_pricing_approvals(org_id, opportunity_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, template_revision_id) REFERENCES enterprise_suite.sales_proposal_template_revisions(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, proposal_id) REFERENCES public.proposals(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, proposal_version_id) REFERENCES public.proposal_versions(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_proposal_template_revisions'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_proposal_issues'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.sales_proposal_template_revisions, enterprise_suite.sales_proposal_issues
  TO fieldline_app, fieldline_platform;
