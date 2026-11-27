CREATE TABLE enterprise_suite.homeowner_finance_contract_links (
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  accepted_proposal_version_id uuid NOT NULL,
  PRIMARY KEY (org_id, project_id, accepted_proposal_version_id),
  UNIQUE (org_id, accepted_proposal_version_id),
  FOREIGN KEY (org_id, project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, accepted_proposal_version_id) REFERENCES public.proposal_versions(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.homeowner_finance_visibility_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  enabled boolean NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  contact_id uuid,
  recipient_grant_id uuid,
  accepted_proposal_id uuid,
  accepted_proposal_version_id uuid,
  forecast_id uuid,
  disclosure jsonb,
  token_hash varchar(64) UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  token_sealed text,
  expires_at timestamptz,
  approved_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, revision),
  UNIQUE (org_id, project_id, client_request_id),
  FOREIGN KEY (org_id, project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, contact_id) REFERENCES public.contacts(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, contact_id, recipient_grant_id)
    REFERENCES enterprise_suite.media_homeowner_recipients(org_id, project_id, contact_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, accepted_proposal_id) REFERENCES public.proposals(org_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, accepted_proposal_version_id)
    REFERENCES enterprise_suite.homeowner_finance_contract_links(org_id, project_id, accepted_proposal_version_id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, forecast_id)
    REFERENCES enterprise_suite.cost_forecast_snapshots(org_id, project_id, id) ON DELETE RESTRICT,
  CHECK (
    (enabled AND contact_id IS NOT NULL AND recipient_grant_id IS NOT NULL AND accepted_proposal_id IS NOT NULL
      AND accepted_proposal_version_id IS NOT NULL AND disclosure IS NOT NULL AND token_hash IS NOT NULL
      AND token_sealed IS NOT NULL AND expires_at IS NOT NULL)
    OR
    (NOT enabled AND contact_id IS NULL AND recipient_grant_id IS NULL AND accepted_proposal_id IS NULL
      AND accepted_proposal_version_id IS NULL AND forecast_id IS NULL AND disclosure IS NULL AND token_hash IS NULL
      AND token_sealed IS NULL AND expires_at IS NULL)
  )
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.homeowner_finance_contract_links'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.homeowner_finance_visibility_revisions'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.homeowner_finance_contract_links,
  enterprise_suite.homeowner_finance_visibility_revisions TO fieldline_app, fieldline_platform;
