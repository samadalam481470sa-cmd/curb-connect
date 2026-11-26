ALTER TABLE enterprise_suite.purchase_orders
  ADD CONSTRAINT enterprise_purchase_orders_tenant_project_id_unique UNIQUE (org_id, project_id, id);
--> statement-breakpoint
CREATE TABLE enterprise_suite.purchase_commitment_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  order_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('issuance', 'amendment')),
  base_version integer NOT NULL CHECK (base_version >= 0),
  total_minor bigint NOT NULL CHECK (total_minor BETWEEN 1 AND 1000000000000),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  requested_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid,
  request_hash varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kind = 'issuance' AND base_version = 0 AND client_request_id IS NULL AND request_hash IS NULL)
    OR (kind = 'amendment' AND base_version > 0 AND client_request_id IS NOT NULL
      AND request_hash IS NOT NULL AND request_hash ~ '^[a-f0-9]{64}$')
  ),
  UNIQUE (org_id, project_id, order_id, id),
  UNIQUE (org_id, project_id, order_id, client_request_id),
  FOREIGN KEY (org_id, project_id, order_id)
    REFERENCES enterprise_suite.purchase_orders(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX enterprise_purchase_commitment_initial_revision_idx
  ON enterprise_suite.purchase_commitment_revisions(org_id, project_id, order_id)
  WHERE kind = 'issuance';
--> statement-breakpoint
CREATE INDEX enterprise_purchase_commitment_revision_history_idx
  ON enterprise_suite.purchase_commitment_revisions(org_id, project_id, order_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE TABLE enterprise_suite.purchase_commitment_allocations (
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  order_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  cost_code_id uuid NOT NULL,
  prior_minor bigint NOT NULL CHECK (prior_minor BETWEEN 0 AND 1000000000000),
  revised_minor bigint NOT NULL CHECK (revised_minor BETWEEN 0 AND 1000000000000),
  delta_minor bigint GENERATED ALWAYS AS (revised_minor - prior_minor) STORED,
  CHECK (prior_minor > 0 OR revised_minor > 0),
  PRIMARY KEY (org_id, project_id, order_id, revision_id, cost_code_id),
  FOREIGN KEY (org_id, project_id, order_id, revision_id)
    REFERENCES enterprise_suite.purchase_commitment_revisions(org_id, project_id, order_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, cost_code_id)
    REFERENCES enterprise_suite.purchase_cost_codes(org_id, project_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.purchase_commitment_decisions (
  org_id uuid NOT NULL,
  project_id uuid NOT NULL,
  order_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('approved', 'rejected')),
  activated_version integer CHECK (activated_version > 0),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 1000),
  decided_by_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  client_request_id uuid,
  request_hash varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((outcome = 'approved') = (activated_version IS NOT NULL)),
  CHECK (
    (activated_version = 1 AND client_request_id IS NULL AND request_hash IS NULL)
    OR (client_request_id IS NOT NULL AND request_hash IS NOT NULL AND request_hash ~ '^[a-f0-9]{64}$')
  ),
  PRIMARY KEY (org_id, project_id, order_id, revision_id),
  UNIQUE (org_id, project_id, order_id, client_request_id),
  FOREIGN KEY (org_id, project_id, order_id, revision_id)
    REFERENCES enterprise_suite.purchase_commitment_revisions(org_id, project_id, order_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE UNIQUE INDEX enterprise_purchase_commitment_active_version_idx
  ON enterprise_suite.purchase_commitment_decisions(org_id, project_id, order_id, activated_version DESC)
  WHERE activated_version IS NOT NULL;
--> statement-breakpoint
INSERT INTO enterprise_suite.purchase_commitment_revisions (
  org_id, project_id, order_id, kind, base_version, total_minor, reason, requested_by_user_id, created_at
)
SELECT org_id, project_id, id, 'issuance', 0, amount_minor, 'Original purchase order issuance', issued_by_user_id, issued_at
FROM enterprise_suite.purchase_orders
WHERE status = 'issued';
--> statement-breakpoint
INSERT INTO enterprise_suite.purchase_commitment_allocations (
  org_id, project_id, order_id, revision_id, cost_code_id, prior_minor, revised_minor
)
SELECT revisions.org_id, revisions.project_id, revisions.order_id, revisions.id, codes.id, 0, revisions.total_minor
FROM enterprise_suite.purchase_commitment_revisions AS revisions
JOIN enterprise_suite.purchase_orders AS orders
  ON orders.org_id = revisions.org_id AND orders.project_id = revisions.project_id AND orders.id = revisions.order_id
JOIN enterprise_suite.purchase_cost_codes AS codes
  ON codes.org_id = orders.org_id AND codes.project_id = orders.project_id AND codes.code = orders.cost_code;
--> statement-breakpoint
INSERT INTO enterprise_suite.purchase_commitment_decisions (
  org_id, project_id, order_id, revision_id, outcome, activated_version, reason, decided_by_user_id, created_at
)
SELECT org_id, project_id, order_id, id, 'approved', 1, reason, requested_by_user_id, created_at
FROM enterprise_suite.purchase_commitment_revisions;
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.purchase_commitment_revisions'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.purchase_commitment_allocations'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.purchase_commitment_decisions'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.purchase_commitment_revisions,
  enterprise_suite.purchase_commitment_allocations, enterprise_suite.purchase_commitment_decisions
  TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE FUNCTION enterprise_suite.record_original_purchase_commitment() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  commitment_id uuid;
BEGIN
  INSERT INTO enterprise_suite.purchase_commitment_revisions (
    org_id, project_id, order_id, kind, base_version, total_minor, reason, requested_by_user_id, created_at
  )
  VALUES (
    NEW.org_id, NEW.project_id, NEW.id, 'issuance', 0, NEW.amount_minor,
    'Original purchase order issuance', NEW.issued_by_user_id, NEW.issued_at
  )
  RETURNING id INTO commitment_id;

  INSERT INTO enterprise_suite.purchase_commitment_allocations (
    org_id, project_id, order_id, revision_id, cost_code_id, prior_minor, revised_minor
  )
  VALUES (
    NEW.org_id, NEW.project_id, NEW.id, commitment_id,
    (
      SELECT codes.id FROM enterprise_suite.purchase_cost_codes AS codes
      WHERE codes.org_id = NEW.org_id AND codes.project_id = NEW.project_id AND codes.code = NEW.cost_code
    ),
    0, NEW.amount_minor
  );

  INSERT INTO enterprise_suite.purchase_commitment_decisions (
    org_id, project_id, order_id, revision_id, outcome, activated_version, reason, decided_by_user_id, created_at
  )
  VALUES (
    NEW.org_id, NEW.project_id, NEW.id, commitment_id, 'approved', 1,
    'Original purchase order issuance', NEW.issued_by_user_id, NEW.issued_at
  );

  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER issued_purchase_order_records_commitment
  AFTER UPDATE OF status ON enterprise_suite.purchase_orders
  FOR EACH ROW
  WHEN (OLD.status = 'draft' AND NEW.status = 'issued')
  EXECUTE FUNCTION enterprise_suite.record_original_purchase_commitment();
