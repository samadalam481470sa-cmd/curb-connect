CREATE TABLE enterprise_suite.bid_quote_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  package_id uuid NOT NULL,
  quote_id uuid NOT NULL,
  package_revision integer NOT NULL CHECK (package_revision > 1),
  outcome text NOT NULL CHECK (outcome IN ('responsive', 'nonresponsive')),
  checklist jsonb NOT NULL CHECK (
    CASE WHEN jsonb_typeof(checklist) = 'array' THEN jsonb_array_length(checklist) = 3 ELSE false END
  ),
  rationale text NOT NULL CHECK (length(trim(rationale)) BETWEEN 3 AND 1000),
  exception_note text CHECK (exception_note IS NULL OR length(trim(exception_note)) BETWEEN 3 AND 1000),
  client_request_id uuid NOT NULL,
  reviewed_by_user_id uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, package_id, quote_id, client_request_id),
  FOREIGN KEY (org_id, project_id, package_id, quote_id)
    REFERENCES enterprise_suite.bid_quotes(org_id, project_id, package_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX enterprise_bid_quote_review_revision_idx
  ON enterprise_suite.bid_quote_reviews(org_id, project_id, package_id, quote_id, package_revision DESC);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.bid_quote_reviews'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.bid_quote_reviews TO fieldline_app, fieldline_platform;
