-- 0100: portal capture (Renditions-style external-order gathering).
--   * portal_connections: one builder-portal account per row. The portal
--     secret is stored ONLY AES-256-GCM sealed (secret_sealed, key =
--     STORAGE_ENCRYPTION_KEY) and is never returned by any API.
--   * portal_capture_runs: one row per capture attempt (manual/scheduled)
--     with found/new/revised counts, per-order errors, and an honest
--     'no_adapters' result when no adapter is registered for the portal.
--   * external_orders: captured orders normalized into Field Pro lines.
--     Dedupe key (org, connection, builder PO number): a re-capture updates
--     the same row as a revision. Conversion creates ONE draft supplier
--     order (converted_order_id unique per org), human-confirmed only.
-- No live portal adapter ships with this migration; adapters are added per
-- builder portal against real supplier-authorized accounts. Plain authorized
-- login only — no anti-bot evasion (see docs/renditions-capture.md).
CREATE TABLE public.portal_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  portal_key text NOT NULL CHECK (length(portal_key) BETWEEN 1 AND 80),
  portal_name text NOT NULL CHECK (length(portal_name) BETWEEN 1 AND 200),
  login_identifier text NOT NULL CHECK (length(login_identifier) BETWEEN 1 AND 320),
  secret_sealed text NOT NULL CHECK (length(secret_sealed) BETWEEN 1 AND 4000),
  status text NOT NULL DEFAULT 'not_connected' CHECK (status IN ('not_connected','connected','login_failed','portal_changed','blocked')),
  last_checked_at timestamptz,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 2000),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_connections_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT portal_connections_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT portal_connections_org_id_portal_key_login_identifier_uq UNIQUE (org_id, portal_key, login_identifier)
);
--> statement-breakpoint
CREATE INDEX portal_connections_org_id_idx ON public.portal_connections(org_id);
--> statement-breakpoint
CREATE INDEX portal_connections_org_id_status_idx ON public.portal_connections(org_id, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.portal_connections');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_connections TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.portal_capture_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  trigger text NOT NULL CHECK (trigger IN ('manual','scheduled')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed','no_adapters')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  orders_found integer NOT NULL DEFAULT 0 CHECK (orders_found >= 0),
  orders_new integer NOT NULL DEFAULT 0 CHECK (orders_new >= 0),
  orders_revised integer NOT NULL DEFAULT 0 CHECK (orders_revised >= 0),
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text CHECK (note IS NULL OR length(note) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_capture_runs_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT portal_capture_runs_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT portal_capture_runs_connection_id_fk FOREIGN KEY (org_id, connection_id) REFERENCES public.portal_connections(org_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX portal_capture_runs_org_id_idx ON public.portal_capture_runs(org_id);
--> statement-breakpoint
CREATE INDEX portal_capture_runs_org_id_connection_id_created_at_idx ON public.portal_capture_runs(org_id, connection_id, created_at);
--> statement-breakpoint
CREATE INDEX portal_capture_runs_org_id_status_idx ON public.portal_capture_runs(org_id, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.portal_capture_runs');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_capture_runs TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.external_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  builder_name text NOT NULL CHECK (length(builder_name) BETWEEN 1 AND 200),
  builder_po_number text NOT NULL CHECK (length(builder_po_number) BETWEEN 1 AND 200),
  ordered_on text CHECK (ordered_on IS NULL OR length(ordered_on) <= 40),
  captured_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_minor bigint CHECK (total_minor IS NULL OR total_minor >= 0),
  status text NOT NULL DEFAULT 'captured' CHECK (status IN ('captured','converted')),
  revision_count integer NOT NULL DEFAULT 0 CHECK (revision_count >= 0),
  last_captured_at timestamptz NOT NULL DEFAULT now(),
  converted_order_id uuid,
  note text CHECK (note IS NULL OR length(note) <= 2000),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_orders_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT external_orders_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT external_orders_connection_id_fk FOREIGN KEY (org_id, connection_id) REFERENCES public.portal_connections(org_id, id) ON DELETE CASCADE,
  CONSTRAINT external_orders_converted_order_id_fk FOREIGN KEY (org_id, converted_order_id) REFERENCES public.supplier_orders(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT external_orders_org_id_connection_id_builder_po_number_uq UNIQUE (org_id, connection_id, builder_po_number),
  CONSTRAINT external_orders_org_id_converted_order_id_uq UNIQUE (org_id, converted_order_id)
);
--> statement-breakpoint
CREATE INDEX external_orders_org_id_idx ON public.external_orders(org_id);
--> statement-breakpoint
CREATE INDEX external_orders_org_id_status_idx ON public.external_orders(org_id, status);
--> statement-breakpoint
CREATE INDEX external_orders_org_id_builder_name_idx ON public.external_orders(org_id, builder_name);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.external_orders');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.external_orders TO fieldline_app, fieldline_platform;
