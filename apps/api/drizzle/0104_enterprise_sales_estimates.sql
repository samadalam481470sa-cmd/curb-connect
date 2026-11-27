CREATE TABLE enterprise_suite.sales_estimate_template_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  source_template_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  approved_snapshot jsonb NOT NULL,
  approved_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, source_template_id, revision),
  UNIQUE (org_id, client_request_id),
  FOREIGN KEY (org_id, source_template_id) REFERENCES public.estimate_templates(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.sales_estimate_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  opportunity_id uuid NOT NULL,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 200),
  currency varchar(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  revision integer NOT NULL CHECK (revision > 1),
  lot_id uuid,
  price_book_revision_id uuid,
  template_revision_id uuid,
  snapshot jsonb NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id),
  UNIQUE (org_id, opportunity_id),
  UNIQUE (org_id, opportunity_id, client_request_id),
  FOREIGN KEY (org_id, opportunity_id) REFERENCES enterprise_suite.sales_leads(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, lot_id) REFERENCES public.land_lots(org_id, id) ON DELETE SET NULL (lot_id),
  FOREIGN KEY (org_id, price_book_revision_id) REFERENCES public.price_book_revisions(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, template_revision_id) REFERENCES enterprise_suite.sales_estimate_template_revisions(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_estimate_template_revisions'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.sales_estimate_drafts'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.sales_estimate_template_revisions, enterprise_suite.sales_estimate_drafts
  TO fieldline_app, fieldline_platform;
