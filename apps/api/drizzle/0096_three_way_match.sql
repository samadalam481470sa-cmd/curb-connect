-- 0096: three-way match (blueprint gap 4).
--   * po_receipts / po_receipt_lines: minimal receiving against supplier
--     orders (PO lines are supplier_orders.lines jsonb, referenced by index).
--   * ap_invoice_matches: one match record per AP invoice — linked PO,
--     invoice-side figures entered from the supplier's invoice, computed
--     status (matched / price_variance / quantity_variance / unmatched),
--     and the variance decision. When a match record exists, AP approval is
--     blocked until matched or variance-approved (jobCost decide handler).
CREATE TABLE public.po_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  supplier_order_id uuid NOT NULL,
  received_on date NOT NULL,
  received_by_user_id uuid,
  note text CHECK (note IS NULL OR length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT po_receipts_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT po_receipts_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT po_receipts_supplier_order_id_fk FOREIGN KEY (org_id, supplier_order_id) REFERENCES public.supplier_orders(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX po_receipts_org_id_idx ON public.po_receipts(org_id);
--> statement-breakpoint
CREATE INDEX po_receipts_org_id_supplier_order_id_idx ON public.po_receipts(org_id, supplier_order_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.po_receipts');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.po_receipts TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.po_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  line_index integer NOT NULL CHECK (line_index >= 0),
  qty_received numeric(18,6) NOT NULL CHECK (qty_received >= 0),
  condition text NOT NULL DEFAULT 'ok' CHECK (condition IN ('ok','short','damaged')),
  note text CHECK (note IS NULL OR length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT po_receipt_lines_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT po_receipt_lines_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT po_receipt_lines_receipt_id_fk FOREIGN KEY (org_id, receipt_id) REFERENCES public.po_receipts(org_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX po_receipt_lines_org_id_idx ON public.po_receipt_lines(org_id);
--> statement-breakpoint
CREATE INDEX po_receipt_lines_org_id_receipt_id_idx ON public.po_receipt_lines(org_id, receipt_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.po_receipt_lines');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.po_receipt_lines TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.ap_invoice_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  ap_invoice_id uuid NOT NULL,
  supplier_order_id uuid,
  status text NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','matched','price_variance','quantity_variance','variance_approved','variance_rejected')),
  billed_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  billed_tax_minor bigint NOT NULL DEFAULT 0 CHECK (billed_tax_minor >= 0),
  billed_freight_minor bigint NOT NULL DEFAULT 0 CHECK (billed_freight_minor >= 0),
  billed_vendor_name text NOT NULL DEFAULT '' CHECK (length(billed_vendor_name) <= 200),
  billed_cost_code text CHECK (billed_cost_code IS NULL OR length(billed_cost_code) <= 60),
  computed_billed_total_minor bigint NOT NULL DEFAULT 0,
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  variance_reason text CHECK (variance_reason IS NULL OR length(variance_reason) <= 2000),
  decided_by_user_id uuid,
  decided_at timestamptz,
  matched_at timestamptz,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ap_invoice_matches_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT ap_invoice_matches_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT ap_invoice_matches_ap_invoice_id_fk FOREIGN KEY (org_id, ap_invoice_id) REFERENCES public.ap_invoices(org_id, id) ON DELETE CASCADE,
  CONSTRAINT ap_invoice_matches_supplier_order_id_fk FOREIGN KEY (org_id, supplier_order_id) REFERENCES public.supplier_orders(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT ap_invoice_matches_org_id_ap_invoice_id_uq UNIQUE (org_id, ap_invoice_id)
);
--> statement-breakpoint
CREATE INDEX ap_invoice_matches_org_id_idx ON public.ap_invoice_matches(org_id);
--> statement-breakpoint
CREATE INDEX ap_invoice_matches_org_id_status_idx ON public.ap_invoice_matches(org_id, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.ap_invoice_matches');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ap_invoice_matches TO fieldline_app, fieldline_platform;
