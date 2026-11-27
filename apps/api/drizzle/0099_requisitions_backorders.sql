-- 0099: requisitions + backorders (blueprint gap 7).
--   * purchase_requisitions: material requests with submit/approve flow;
--     conversion creates one draft supplier order (converted_order_id is
--     unique per org, so converting twice cannot create two POs).
--   * po_line_backorders: entered expected date/note per PO line. The
--     backordered quantity is derived (ordered - received), never stored.
CREATE TABLE public.purchase_requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  job_id uuid NOT NULL,
  cost_code text CHECK (cost_code IS NULL OR length(cost_code) <= 60),
  supplier_name text CHECK (supplier_name IS NULL OR length(supplier_name) <= 200),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  needed_by date,
  requester_user_id uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','converted')),
  converted_order_id uuid,
  decided_by_user_id uuid,
  decided_at timestamptz,
  note text CHECK (note IS NULL OR length(note) <= 2000),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_requisitions_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT purchase_requisitions_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT purchase_requisitions_job_id_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_requisitions_converted_order_id_fk FOREIGN KEY (org_id, converted_order_id) REFERENCES public.supplier_orders(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT purchase_requisitions_org_id_converted_order_id_uq UNIQUE (org_id, converted_order_id)
);
--> statement-breakpoint
CREATE INDEX purchase_requisitions_org_id_idx ON public.purchase_requisitions(org_id);
--> statement-breakpoint
CREATE INDEX purchase_requisitions_org_id_status_idx ON public.purchase_requisitions(org_id, status);
--> statement-breakpoint
CREATE INDEX purchase_requisitions_org_id_job_id_status_idx ON public.purchase_requisitions(org_id, job_id, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.purchase_requisitions');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_requisitions TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.po_line_backorders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  supplier_order_id uuid NOT NULL,
  line_index integer NOT NULL CHECK (line_index >= 0),
  expected_on date,
  note text CHECK (note IS NULL OR length(note) <= 1000),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT po_line_backorders_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT po_line_backorders_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT po_line_backorders_supplier_order_id_fk FOREIGN KEY (org_id, supplier_order_id) REFERENCES public.supplier_orders(org_id, id) ON DELETE CASCADE,
  CONSTRAINT po_line_backorders_org_id_supplier_order_id_line_index_uq UNIQUE (org_id, supplier_order_id, line_index)
);
--> statement-breakpoint
CREATE INDEX po_line_backorders_org_id_idx ON public.po_line_backorders(org_id);
--> statement-breakpoint
CREATE INDEX po_line_backorders_org_id_expected_on_idx ON public.po_line_backorders(org_id, expected_on);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.po_line_backorders');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.po_line_backorders TO fieldline_app, fieldline_platform;
