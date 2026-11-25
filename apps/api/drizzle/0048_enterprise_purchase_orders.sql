CREATE TABLE enterprise_suite.purchase_cost_codes (
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  code varchar(24) NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9 .-]*$'),
  label varchar(160) NOT NULL CHECK (length(trim(label)) BETWEEN 2 AND 160),
  PRIMARY KEY (org_id, project_id, code),
  FOREIGN KEY (org_id, project_id) REFERENCES enterprise_suite.projects(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE enterprise_suite.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  project_id uuid NOT NULL,
  bid_package_id uuid NOT NULL,
  quote_id uuid NOT NULL,
  award_revision integer NOT NULL CHECK (award_revision > 0),
  title varchar(180) NOT NULL,
  scope text NOT NULL,
  vendor_name varchar(180) NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 1000000000000),
  quote_valid_through date NOT NULL,
  cost_code varchar(24) NOT NULL,
  delivery_address text NOT NULL CHECK (length(trim(delivery_address)) BETWEEN 5 AND 1000),
  requested_delivery_on date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'issued')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  issued_by_user_id uuid,
  issued_at timestamptz,
  CHECK (
    (status = 'draft' AND issued_at IS NULL AND issued_by_user_id IS NULL)
    OR (status = 'issued' AND issued_at IS NOT NULL AND issued_by_user_id IS NOT NULL)
  ),
  UNIQUE (org_id, project_id, bid_package_id),
  FOREIGN KEY (org_id, project_id, bid_package_id, quote_id)
    REFERENCES enterprise_suite.bid_quotes(org_id, project_id, package_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (org_id, project_id, cost_code)
    REFERENCES enterprise_suite.purchase_cost_codes(org_id, project_id, code) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX enterprise_purchase_orders_project_idx ON enterprise_suite.purchase_orders(org_id, project_id, created_at DESC, id DESC);
--> statement-breakpoint
CREATE FUNCTION enterprise_suite.prevent_issued_purchase_order_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'issued' THEN
    RAISE EXCEPTION 'issued purchase orders are immutable' USING ERRCODE = 'FL001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER issued_purchase_order_is_immutable
  BEFORE UPDATE OR DELETE ON enterprise_suite.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION enterprise_suite.prevent_issued_purchase_order_changes();
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.purchase_cost_codes'::regclass);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('enterprise_suite.purchase_orders'::regclass);
--> statement-breakpoint
GRANT SELECT, INSERT ON enterprise_suite.purchase_cost_codes TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON enterprise_suite.purchase_orders TO fieldline_app, fieldline_platform;
