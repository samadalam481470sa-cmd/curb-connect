-- Builder operations section (additive): warranty + homeowner service, job cost with
-- budget-to-actual and draw billing, AP workflow with lien-release tracking, home-sales
-- pipeline with contracts and priced selections, supplier order flow between connected
-- companies, the land hierarchy (communities → phases → lots → houses) with land contracts
-- and SWPPP inspections, field time tracking and inspection checklists, cross-company work
-- assignments, and the QuickBooks sync log. Every amount is builder-entered or carried from
-- an existing record — nothing is invented. Money movement stays gated on a payments
-- provider; assignment email stays gated on the mailer/SMTP. No existing tables change
-- except two enum values appended for assignment notifications.
ALTER TYPE public.notification_category ADD VALUE IF NOT EXISTS 'work_assigned';
--> statement-breakpoint
ALTER TYPE public.subject_type ADD VALUE IF NOT EXISTS 'assignment';
--> statement-breakpoint
CREATE TABLE public.warranty_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  job_id uuid NOT NULL,
  customer_id uuid,
  title text NOT NULL CHECK (length(title) <= 300),
  description text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','under_review','approved','denied','in_progress','completed','closed')),
  reported_by text NOT NULL DEFAULT 'staff' CHECK (reported_by IN ('staff','homeowner')),
  coverage_note text,
  closed_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warranty_tickets_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT warranty_tickets_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT warranty_tickets_job_id_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT warranty_tickets_customer_id_fk FOREIGN KEY (org_id, customer_id) REFERENCES public.customers(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX warranty_tickets_org_id_idx ON public.warranty_tickets(org_id);
--> statement-breakpoint
CREATE INDEX warranty_tickets_org_id_status_idx ON public.warranty_tickets(org_id, status);
--> statement-breakpoint
CREATE INDEX warranty_tickets_job_id_created_at_idx ON public.warranty_tickets(job_id, created_at);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.warranty_tickets');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warranty_tickets TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.warranty_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  ticket_id uuid NOT NULL,
  title text NOT NULL CHECK (length(title) <= 300),
  scope text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  assignee_membership_id uuid,
  scheduled_on text,
  completed_at timestamptz,
  cost_minor bigint,
  currency char(3) NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warranty_work_orders_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT warranty_work_orders_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT warranty_work_orders_ticket_id_fk FOREIGN KEY (org_id, ticket_id) REFERENCES public.warranty_tickets(org_id, id) ON DELETE CASCADE,
  CONSTRAINT warranty_work_orders_assignee_membership_id_fk FOREIGN KEY (org_id, assignee_membership_id) REFERENCES public.memberships(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX warranty_work_orders_org_id_idx ON public.warranty_work_orders(org_id);
--> statement-breakpoint
CREATE INDEX warranty_work_orders_ticket_id_created_at_idx ON public.warranty_work_orders(ticket_id, created_at);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.warranty_work_orders');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warranty_work_orders TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.warranty_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  ticket_id uuid NOT NULL,
  author_kind text NOT NULL CHECK (author_kind IN ('staff','homeowner')),
  author_user_id uuid,
  body text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warranty_messages_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT warranty_messages_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT warranty_messages_ticket_id_fk FOREIGN KEY (org_id, ticket_id) REFERENCES public.warranty_tickets(org_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX warranty_messages_org_id_idx ON public.warranty_messages(org_id);
--> statement-breakpoint
CREATE INDEX warranty_messages_ticket_id_created_at_idx ON public.warranty_messages(ticket_id, created_at);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.warranty_messages');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warranty_messages TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.job_cost_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  job_id uuid NOT NULL,
  cost_code text NOT NULL CHECK (length(cost_code) <= 60),
  label text NOT NULL CHECK (length(label) <= 200),
  budget_minor bigint NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_cost_budgets_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT job_cost_budgets_job_id_cost_code_uq UNIQUE (org_id, job_id, cost_code),
  CONSTRAINT job_cost_budgets_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT job_cost_budgets_job_id_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX job_cost_budgets_org_id_idx ON public.job_cost_budgets(org_id);
--> statement-breakpoint
CREATE INDEX job_cost_budgets_org_id_job_id_idx ON public.job_cost_budgets(org_id, job_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.job_cost_budgets');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_cost_budgets TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.job_cost_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  job_id uuid NOT NULL,
  cost_code text NOT NULL CHECK (length(cost_code) <= 60),
  description text NOT NULL CHECK (length(description) <= 500),
  amount_minor bigint NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  source text NOT NULL CHECK (source IN ('purchase_order','ap_invoice','manual')),
  source_id uuid,
  incurred_on text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_cost_entries_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT job_cost_entries_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT job_cost_entries_job_id_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX job_cost_entries_org_id_idx ON public.job_cost_entries(org_id);
--> statement-breakpoint
CREATE INDEX job_cost_entries_job_id_cost_code_idx ON public.job_cost_entries(job_id, cost_code);
--> statement-breakpoint
CREATE INDEX job_cost_entries_org_id_job_id_idx ON public.job_cost_entries(org_id, job_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.job_cost_entries');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_cost_entries TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.draw_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  job_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','paid','rejected')),
  contract_minor bigint NOT NULL,
  requested_minor bigint NOT NULL,
  retainage_pct numeric(18,6) NOT NULL DEFAULT '0',
  currency char(3) NOT NULL DEFAULT 'USD',
  note text,
  submitted_at timestamptz,
  decided_at timestamptz,
  paid_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT draw_requests_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT draw_requests_job_id_number_uq UNIQUE (org_id, job_id, number),
  CONSTRAINT draw_requests_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT draw_requests_job_id_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX draw_requests_org_id_idx ON public.draw_requests(org_id);
--> statement-breakpoint
CREATE INDEX draw_requests_org_id_status_idx ON public.draw_requests(org_id, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.draw_requests');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.draw_requests TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.ap_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  vendor_name text NOT NULL CHECK (length(vendor_name) <= 200),
  invoice_number text CHECK (length(invoice_number) <= 120),
  job_id uuid,
  cost_code text CHECK (length(cost_code) <= 60),
  amount_minor bigint NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  due_on text,
  status text NOT NULL DEFAULT 'captured' CHECK (status IN ('captured','pending_approval','approved','payment_recorded','rejected','disputed')),
  source text NOT NULL CHECK (source IN ('manual','invoice_intel','network_bill')),
  source_id uuid,
  approval_note text,
  approved_by_user_id uuid,
  approved_at timestamptz,
  payment_recorded_at timestamptz,
  lien_release_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ap_invoices_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT ap_invoices_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT ap_invoices_job_id_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX ap_invoices_org_id_idx ON public.ap_invoices(org_id);
--> statement-breakpoint
CREATE INDEX ap_invoices_org_id_status_idx ON public.ap_invoices(org_id, status);
--> statement-breakpoint
CREATE INDEX ap_invoices_org_id_due_on_idx ON public.ap_invoices(org_id, due_on);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.ap_invoices');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ap_invoices TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.lien_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  job_id uuid,
  ap_invoice_id uuid,
  claimant_name text NOT NULL CHECK (length(claimant_name) <= 200),
  kind text NOT NULL CHECK (kind IN ('conditional_progress','unconditional_progress','conditional_final','unconditional_final')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','requested','received','verified','void')),
  amount_minor bigint,
  currency char(3) NOT NULL DEFAULT 'USD',
  through_on text,
  received_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lien_releases_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT lien_releases_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT lien_releases_job_id_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT lien_releases_ap_invoice_id_fk FOREIGN KEY (org_id, ap_invoice_id) REFERENCES public.ap_invoices(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX lien_releases_org_id_idx ON public.lien_releases(org_id);
--> statement-breakpoint
CREATE INDEX lien_releases_org_id_status_idx ON public.lien_releases(org_id, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.lien_releases');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lien_releases TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.sales_prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  buyer_name text NOT NULL CHECK (length(buyer_name) <= 200),
  buyer_email text CHECK (length(buyer_email) <= 320),
  buyer_phone text CHECK (length(buyer_phone) <= 40),
  agent_name text CHECK (length(agent_name) <= 200),
  agent_email text CHECK (length(agent_email) <= 320),
  agent_phone text CHECK (length(agent_phone) <= 40),
  agent_brokerage text CHECK (length(agent_brokerage) <= 200),
  stage text NOT NULL DEFAULT 'new' CHECK (stage IN ('new','contacted','appointment','contract','closed','lost')),
  community_name text CHECK (length(community_name) <= 200),
  budget_minor bigint,
  currency char(3) NOT NULL DEFAULT 'USD',
  notes text,
  customer_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_prospects_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT sales_prospects_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT sales_prospects_customer_id_fk FOREIGN KEY (org_id, customer_id) REFERENCES public.customers(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX sales_prospects_org_id_idx ON public.sales_prospects(org_id);
--> statement-breakpoint
CREATE INDEX sales_prospects_org_id_stage_idx ON public.sales_prospects(org_id, stage);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.sales_prospects');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_prospects TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.sales_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  prospect_id uuid NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  location text CHECK (length(location) <= 300),
  note text,
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','completed','cancelled','no_show')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_appointments_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT sales_appointments_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT sales_appointments_prospect_id_fk FOREIGN KEY (org_id, prospect_id) REFERENCES public.sales_prospects(org_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX sales_appointments_org_id_idx ON public.sales_appointments(org_id);
--> statement-breakpoint
CREATE INDEX sales_appointments_prospect_id_starts_at_idx ON public.sales_appointments(prospect_id, starts_at);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.sales_appointments');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_appointments TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.sales_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('structural','elevation','finish','fixture','flooring','other')),
  name text NOT NULL CHECK (length(name) <= 200),
  description text,
  price_minor bigint,
  currency char(3) NOT NULL DEFAULT 'USD',
  visual_note text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_options_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT sales_options_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX sales_options_org_id_idx ON public.sales_options(org_id);
--> statement-breakpoint
CREATE INDEX sales_options_org_id_category_idx ON public.sales_options(org_id, category);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.sales_options');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_options TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.sales_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  prospect_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','signed','in_design','under_construction','closed','cancelled')),
  community_name text CHECK (length(community_name) <= 200),
  lot_label text CHECK (length(lot_label) <= 120),
  plan_name text CHECK (length(plan_name) <= 160),
  base_price_minor bigint,
  currency char(3) NOT NULL DEFAULT 'USD',
  studio_house_id uuid,
  job_id uuid,
  signed_on text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_contracts_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT sales_contracts_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT sales_contracts_prospect_id_fk FOREIGN KEY (org_id, prospect_id) REFERENCES public.sales_prospects(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_contracts_studio_house_id_fk FOREIGN KEY (org_id, studio_house_id) REFERENCES public.studio_houses(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT sales_contracts_job_id_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX sales_contracts_org_id_idx ON public.sales_contracts(org_id);
--> statement-breakpoint
CREATE INDEX sales_contracts_org_id_status_idx ON public.sales_contracts(org_id, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.sales_contracts');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_contracts TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.sales_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  option_id uuid NOT NULL,
  price_minor bigint,
  currency char(3) NOT NULL DEFAULT 'USD',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_selections_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT sales_selections_contract_id_option_id_uq UNIQUE (org_id, contract_id, option_id),
  CONSTRAINT sales_selections_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT sales_selections_contract_id_fk FOREIGN KEY (org_id, contract_id) REFERENCES public.sales_contracts(org_id, id) ON DELETE CASCADE,
  CONSTRAINT sales_selections_option_id_fk FOREIGN KEY (org_id, option_id) REFERENCES public.sales_options(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX sales_selections_org_id_idx ON public.sales_selections(org_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.sales_selections');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_selections TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.network_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  order_key uuid NOT NULL,
  side text NOT NULL CHECK (side IN ('buyer','supplier')),
  partner_org_id uuid NOT NULL,
  partner_display_name text NOT NULL CHECK (length(partner_display_name) <= 255),
  reference text NOT NULL CHECK (length(reference) <= 80),
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','accepted','declined','in_production','shipped','delivered','cancelled')),
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_minor bigint,
  currency char(3) NOT NULL DEFAULT 'USD',
  requested_delivery_on text,
  delivery_address text CHECK (length(delivery_address) <= 500),
  note text,
  history jsonb NOT NULL DEFAULT '[]'::jsonb,
  sent_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  email_state text NOT NULL DEFAULT 'not_connected' CHECK (email_state IN ('not_connected','queued','sent','failed')),
  email_sent_at timestamptz,
  email_note text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT network_orders_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT network_orders_org_id_order_key_uq UNIQUE (org_id, order_key),
  CONSTRAINT network_orders_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX network_orders_org_id_idx ON public.network_orders(org_id);
--> statement-breakpoint
CREATE INDEX network_orders_org_id_status_idx ON public.network_orders(org_id, status);
--> statement-breakpoint
CREATE INDEX network_orders_partner_org_id_status_idx ON public.network_orders(partner_org_id, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.network_orders');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.network_orders TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.sku_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  partner_org_id uuid,
  package_name text NOT NULL CHECK (length(package_name) <= 200),
  supplier_sku text NOT NULL CHECK (length(supplier_sku) <= 120),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sku_mappings_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT sku_mappings_org_id_package_name_uq UNIQUE (org_id, package_name),
  CONSTRAINT sku_mappings_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX sku_mappings_org_id_idx ON public.sku_mappings(org_id);
--> statement-breakpoint
CREATE INDEX sku_mappings_org_id_supplier_sku_idx ON public.sku_mappings(org_id, supplier_sku);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.sku_mappings');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sku_mappings TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.dispatch_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  route_date text NOT NULL,
  driver_name text CHECK (length(driver_name) <= 160),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','dispatched','completed','cancelled')),
  stops jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispatch_routes_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT dispatch_routes_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX dispatch_routes_org_id_idx ON public.dispatch_routes(org_id);
--> statement-breakpoint
CREATE INDEX dispatch_routes_org_id_route_date_idx ON public.dispatch_routes(org_id, route_date);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.dispatch_routes');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_routes TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.supplier_field_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  order_id uuid,
  report_kind text NOT NULL CHECK (report_kind IN ('delivery','site_condition','damage','other')),
  note text NOT NULL,
  photo_media_ids uuid[] NOT NULL DEFAULT '{}',
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_field_reports_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT supplier_field_reports_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX supplier_field_reports_org_id_idx ON public.supplier_field_reports(org_id);
--> statement-breakpoint
CREATE INDEX supplier_field_reports_org_id_created_at_idx ON public.supplier_field_reports(org_id, created_at);
--> statement-breakpoint
CREATE INDEX supplier_field_reports_order_id_idx ON public.supplier_field_reports(order_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.supplier_field_reports');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_field_reports TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.land_communities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) <= 200),
  city text CHECK (length(city) <= 120),
  county text CHECK (length(county) <= 120),
  status text NOT NULL DEFAULT 'planning' CHECK (status IN ('planning','developing','selling','built_out')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT land_communities_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT land_communities_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX land_communities_org_id_idx ON public.land_communities(org_id);
--> statement-breakpoint
CREATE INDEX land_communities_org_id_status_idx ON public.land_communities(org_id, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.land_communities');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.land_communities TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.land_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  community_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) <= 160),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','developing','released','complete')),
  planned_lot_count integer CHECK (planned_lot_count >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT land_phases_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT land_phases_community_id_name_uq UNIQUE (org_id, community_id, name),
  CONSTRAINT land_phases_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT land_phases_community_id_fk FOREIGN KEY (org_id, community_id) REFERENCES public.land_communities(org_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX land_phases_org_id_idx ON public.land_phases(org_id);
--> statement-breakpoint
CREATE INDEX land_phases_org_id_status_idx ON public.land_phases(org_id, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.land_phases');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.land_phases TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.land_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  community_id uuid NOT NULL,
  phase_id uuid,
  lot_number text NOT NULL CHECK (length(lot_number) <= 60),
  block text CHECK (length(block) <= 60),
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held','released','available','reserved','under_contract','sold','closed')),
  price_minor bigint,
  currency char(3) NOT NULL DEFAULT 'USD',
  width_ft numeric(12,2),
  depth_ft numeric(12,2),
  released_on text,
  contract_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT land_lots_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT land_lots_community_id_lot_number_uq UNIQUE (org_id, community_id, lot_number),
  CONSTRAINT land_lots_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT land_lots_community_id_fk FOREIGN KEY (org_id, community_id) REFERENCES public.land_communities(org_id, id) ON DELETE CASCADE,
  CONSTRAINT land_lots_phase_id_fk FOREIGN KEY (org_id, phase_id) REFERENCES public.land_phases(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT land_lots_contract_id_fk FOREIGN KEY (org_id, contract_id) REFERENCES public.sales_contracts(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX land_lots_org_id_idx ON public.land_lots(org_id);
--> statement-breakpoint
CREATE INDEX land_lots_org_id_status_idx ON public.land_lots(org_id, status);
--> statement-breakpoint
CREATE INDEX land_lots_phase_id_idx ON public.land_lots(phase_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.land_lots');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.land_lots TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.land_houses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  lot_id uuid NOT NULL,
  plan_name text CHECK (length(plan_name) <= 160),
  studio_house_id uuid,
  contract_id uuid,
  job_id uuid,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','under_construction','complete','sold','closed')),
  address_line text CHECK (length(address_line) <= 300),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT land_houses_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT land_houses_lot_id_uq UNIQUE (org_id, lot_id),
  CONSTRAINT land_houses_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT land_houses_lot_id_fk FOREIGN KEY (org_id, lot_id) REFERENCES public.land_lots(org_id, id) ON DELETE CASCADE,
  CONSTRAINT land_houses_studio_house_id_fk FOREIGN KEY (org_id, studio_house_id) REFERENCES public.studio_houses(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT land_houses_contract_id_fk FOREIGN KEY (org_id, contract_id) REFERENCES public.sales_contracts(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT land_houses_job_id_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX land_houses_org_id_idx ON public.land_houses(org_id);
--> statement-breakpoint
CREATE INDEX land_houses_org_id_status_idx ON public.land_houses(org_id, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.land_houses');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.land_houses TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.land_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  community_id uuid,
  vendor_name text NOT NULL CHECK (length(vendor_name) <= 200),
  scope text NOT NULL,
  contract_minor bigint NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','complete','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT land_contracts_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT land_contracts_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT land_contracts_community_id_fk FOREIGN KEY (org_id, community_id) REFERENCES public.land_communities(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX land_contracts_org_id_idx ON public.land_contracts(org_id);
--> statement-breakpoint
CREATE INDEX land_contracts_org_id_status_idx ON public.land_contracts(org_id, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.land_contracts');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.land_contracts TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.land_progress_pays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  land_contract_id uuid NOT NULL,
  number integer NOT NULL CHECK (number > 0),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','approved','paid','rejected')),
  requested_minor bigint NOT NULL,
  approved_minor bigint,
  currency char(3) NOT NULL DEFAULT 'USD',
  note text,
  decided_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT land_progress_pays_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT land_progress_pays_land_contract_id_number_uq UNIQUE (org_id, land_contract_id, number),
  CONSTRAINT land_progress_pays_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT land_progress_pays_land_contract_id_fk FOREIGN KEY (org_id, land_contract_id) REFERENCES public.land_contracts(org_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX land_progress_pays_org_id_idx ON public.land_progress_pays(org_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.land_progress_pays');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.land_progress_pays TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.swppp_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  community_id uuid,
  job_id uuid,
  scheduled_on text NOT NULL,
  inspector_name text CHECK (length(inspector_name) <= 160),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','corrective_action','cancelled')),
  findings text,
  corrective_action_due_on text,
  photo_media_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT swppp_inspections_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT swppp_inspections_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT swppp_inspections_community_id_fk FOREIGN KEY (org_id, community_id) REFERENCES public.land_communities(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT swppp_inspections_job_id_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX swppp_inspections_org_id_idx ON public.swppp_inspections(org_id);
--> statement-breakpoint
CREATE INDEX swppp_inspections_org_id_scheduled_on_idx ON public.swppp_inspections(org_id, scheduled_on);
--> statement-breakpoint
CREATE INDEX swppp_inspections_org_id_status_idx ON public.swppp_inspections(org_id, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.swppp_inspections');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.swppp_inspections TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  membership_id uuid,
  worker_name text NOT NULL CHECK (length(worker_name) <= 160),
  job_id uuid,
  cost_code text CHECK (length(cost_code) <= 60),
  work_date text NOT NULL,
  hours numeric(6,2) NOT NULL CHECK (hours >= 0 AND hours <= 24),
  rate_minor_per_hour bigint,
  currency char(3) NOT NULL DEFAULT 'USD',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT time_entries_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT time_entries_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT time_entries_membership_id_fk FOREIGN KEY (org_id, membership_id) REFERENCES public.memberships(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT time_entries_job_id_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX time_entries_org_id_idx ON public.time_entries(org_id);
--> statement-breakpoint
CREATE INDEX time_entries_org_id_work_date_idx ON public.time_entries(org_id, work_date);
--> statement-breakpoint
CREATE INDEX time_entries_job_id_work_date_idx ON public.time_entries(job_id, work_date);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.time_entries');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.time_entries TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.inspection_checklist_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) <= 200),
  description text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inspection_checklist_templates_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT inspection_checklist_templates_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX inspection_checklist_templates_org_id_idx ON public.inspection_checklist_templates(org_id);
--> statement-breakpoint
CREATE INDEX inspection_checklist_templates_org_id_name_idx ON public.inspection_checklist_templates(org_id, name);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.inspection_checklist_templates');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inspection_checklist_templates TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.inspection_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  template_id uuid NOT NULL,
  job_id uuid,
  inspector_name text CHECK (length(inspector_name) <= 160),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  answers jsonb NOT NULL DEFAULT '[]'::jsonb,
  photo_media_ids uuid[] NOT NULL DEFAULT '{}',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inspection_results_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT inspection_results_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT inspection_results_template_id_fk FOREIGN KEY (org_id, template_id) REFERENCES public.inspection_checklist_templates(org_id, id) ON DELETE RESTRICT,
  CONSTRAINT inspection_results_job_id_fk FOREIGN KEY (org_id, job_id) REFERENCES public.jobs(org_id, id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX inspection_results_org_id_idx ON public.inspection_results(org_id);
--> statement-breakpoint
CREATE INDEX inspection_results_org_id_status_idx ON public.inspection_results(org_id, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.inspection_results');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inspection_results TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.work_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  assignment_key uuid NOT NULL,
  side text NOT NULL CHECK (side IN ('assigner','assignee')),
  partner_org_id uuid NOT NULL,
  partner_display_name text NOT NULL CHECK (length(partner_display_name) <= 255),
  kind text NOT NULL CHECK (kind IN ('job','purchase_order','task','bid_invitation')),
  title text NOT NULL CHECK (length(title) <= 200),
  description text,
  subject_type text CHECK (length(subject_type) <= 60),
  subject_id uuid,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','accepted','declined','in_progress','completed','cancelled')),
  due_on text,
  email_state text NOT NULL DEFAULT 'not_connected' CHECK (email_state IN ('not_connected','queued','sent','failed')),
  email_sent_at timestamptz,
  email_note text,
  responded_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_assignments_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT work_assignments_org_id_assignment_key_uq UNIQUE (org_id, assignment_key),
  CONSTRAINT work_assignments_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX work_assignments_org_id_idx ON public.work_assignments(org_id);
--> statement-breakpoint
CREATE INDEX work_assignments_org_id_status_idx ON public.work_assignments(org_id, status);
--> statement-breakpoint
CREATE INDEX work_assignments_partner_org_id_status_idx ON public.work_assignments(partner_org_id, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.work_assignments');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_assignments TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.integration_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('quickbooks')),
  state text NOT NULL CHECK (state IN ('ok','not_connected','failed')),
  pushed integer NOT NULL DEFAULT 0,
  pulled integer NOT NULL DEFAULT 0,
  message text,
  ran_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_sync_log_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT integration_sync_log_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX integration_sync_log_org_id_idx ON public.integration_sync_log(org_id);
--> statement-breakpoint
CREATE INDEX integration_sync_log_org_id_provider_ran_at_idx ON public.integration_sync_log(org_id, provider, ran_at);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.integration_sync_log');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_sync_log TO fieldline_app, fieldline_platform;
