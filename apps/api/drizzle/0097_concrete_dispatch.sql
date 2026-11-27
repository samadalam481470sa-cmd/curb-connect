-- 0097: concrete dispatch (blueprint gap 5).
--   * concrete_mix_designs: contractor-entered mixes (strength/slump/
--     aggregate/admixtures/price per yard).
--   * concrete_orders: pours with requested date/window, pump flag, contact,
--     manual status flow, entered plant/driver/ETA (no GPS provider).
--   * concrete_loads: per-load tickets (truck from fleet_assets, batch time,
--     yards loaded/delivered/returned, ticket number, photo refs, typed-name
--     signature attestation).
CREATE TABLE public.concrete_mix_designs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  strength text CHECK (strength IS NULL OR length(strength) <= 60),
  slump text CHECK (slump IS NULL OR length(slump) <= 60),
  aggregate text CHECK (aggregate IS NULL OR length(aggregate) <= 120),
  admixtures text CHECK (admixtures IS NULL OR length(admixtures) <= 300),
  price_per_yard_minor bigint CHECK (price_per_yard_minor IS NULL OR price_per_yard_minor >= 0),
  active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT concrete_mix_designs_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT concrete_mix_designs_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT concrete_mix_designs_org_id_name_uq UNIQUE (org_id, name)
);
--> statement-breakpoint
CREATE INDEX concrete_mix_designs_org_id_idx ON public.concrete_mix_designs(org_id);
--> statement-breakpoint
CREATE INDEX concrete_mix_designs_org_id_active_idx ON public.concrete_mix_designs(org_id, active);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.concrete_mix_designs');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.concrete_mix_designs TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.concrete_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  job_id uuid NOT NULL,
  mix_design_id uuid NOT NULL,
  pour_location text NOT NULL CHECK (length(pour_location) BETWEEN 1 AND 300),
  volume_yards numeric(18,6) NOT NULL CHECK (volume_yards > 0),
  requested_on date NOT NULL,
  window_start text CHECK (window_start IS NULL OR length(window_start) <= 20),
  window_end text CHECK (window_end IS NULL OR length(window_end) <= 20),
  pump_needed boolean NOT NULL DEFAULT false,
  contact_name text CHECK (contact_name IS NULL OR length(contact_name) <= 120),
  contact_phone text CHECK (contact_phone IS NULL OR length(contact_phone) <= 40),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','batched','en_route','on_site','pouring','complete','cancelled')),
  plant_name text CHECK (plant_name IS NULL OR length(plant_name) <= 120),
  truck_asset_id uuid,
  driver_name text CHECK (driver_name IS NULL OR length(driver_name) <= 120),
  entered_eta text CHECK (entered_eta IS NULL OR length(entered_eta) <= 60),
  invoice_id uuid,
  note text CHECK (note IS NULL OR length(note) <= 1000),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT concrete_orders_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT concrete_orders_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT concrete_orders_job_id_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT concrete_orders_mix_design_id_fk FOREIGN KEY (org_id, mix_design_id) REFERENCES public.concrete_mix_designs(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT concrete_orders_truck_asset_id_fk FOREIGN KEY (org_id, truck_asset_id) REFERENCES public.fleet_assets(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT concrete_orders_invoice_id_fk FOREIGN KEY (org_id, invoice_id) REFERENCES public.invoices(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX concrete_orders_org_id_idx ON public.concrete_orders(org_id);
--> statement-breakpoint
CREATE INDEX concrete_orders_org_id_requested_on_status_idx ON public.concrete_orders(org_id, requested_on, status);
--> statement-breakpoint
CREATE INDEX concrete_orders_org_id_job_id_status_idx ON public.concrete_orders(org_id, job_id, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.concrete_orders');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.concrete_orders TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.concrete_loads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  order_id uuid NOT NULL,
  truck_asset_id uuid,
  driver_name text CHECK (driver_name IS NULL OR length(driver_name) <= 120),
  batch_time timestamptz,
  yards_loaded numeric(18,6) CHECK (yards_loaded IS NULL OR yards_loaded >= 0),
  yards_delivered numeric(18,6) CHECK (yards_delivered IS NULL OR yards_delivered >= 0),
  yards_returned numeric(18,6) CHECK (yards_returned IS NULL OR yards_returned >= 0),
  ticket_number text CHECK (ticket_number IS NULL OR length(ticket_number) <= 60),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','batched','en_route','on_site','pouring','complete','cancelled')),
  photo_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  signature_name text CHECK (signature_name IS NULL OR length(signature_name) <= 120),
  signed_at timestamptz,
  note text CHECK (note IS NULL OR length(note) <= 1000),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT concrete_loads_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT concrete_loads_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT concrete_loads_order_id_fk FOREIGN KEY (org_id, order_id) REFERENCES public.concrete_orders(org_id, id) ON DELETE CASCADE,
  CONSTRAINT concrete_loads_truck_asset_id_fk FOREIGN KEY (org_id, truck_asset_id) REFERENCES public.fleet_assets(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX concrete_loads_org_id_idx ON public.concrete_loads(org_id);
--> statement-breakpoint
CREATE INDEX concrete_loads_org_id_order_id_status_idx ON public.concrete_loads(org_id, order_id, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.concrete_loads');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.concrete_loads TO fieldline_app, fieldline_platform;
