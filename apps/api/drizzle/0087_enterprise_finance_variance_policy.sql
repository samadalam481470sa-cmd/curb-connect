CREATE TABLE enterprise_suite.finance_variance_rule_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  kind text NOT NULL CHECK (kind IN ('off', 'amount', 'percent')),
  amount_minor bigint CHECK (amount_minor BETWEEN 1 AND 9007199254740991),
  percent_bps integer CHECK (percent_bps BETWEEN 1 AND 1000000),
  owner_membership_id uuid,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 500),
  created_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid NOT NULL,
  request_hash varchar(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, revision),
  UNIQUE (org_id, client_request_id),
  CHECK ((kind = 'amount') = (amount_minor IS NOT NULL)),
  CHECK ((kind = 'percent') = (percent_bps IS NOT NULL)),
  CHECK (kind = 'off' OR owner_membership_id IS NOT NULL),
  FOREIGN KEY (org_id, owner_membership_id) REFERENCES public.memberships(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.finance_variance_rule_revisions'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.finance_variance_rule_revisions TO fieldline_app, fieldline_platform;
