-- Bid outreach: companies found each morning, emails/calls sent, replies read back. Tenant RLS.
CREATE TABLE public.outreach_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  auto_refresh boolean NOT NULL DEFAULT true,
  sender_user_id uuid,
  business_name text NOT NULL DEFAULT '' CHECK (length(business_name) <= 160),
  business_address text NOT NULL DEFAULT '' CHECK (length(business_address) <= 300),
  business_phone text NOT NULL DEFAULT '' CHECK (length(business_phone) <= 40),
  trades text[] NOT NULL,
  cities text[] NOT NULL,
  daily_lead_target integer NOT NULL DEFAULT 25 CHECK (daily_lead_target BETWEEN 0 AND 100),
  daily_email_limit integer NOT NULL DEFAULT 40 CHECK (daily_email_limit BETWEEN 0 AND 200),
  subject_template text NOT NULL CHECK (length(subject_template) BETWEEN 1 AND 250),
  body_template text NOT NULL CHECK (length(body_template) BETWEEN 1 AND 8000),
  search_cursor integer NOT NULL DEFAULT 0,
  last_refresh_at timestamptz,
  last_refresh_message text NOT NULL DEFAULT '',
  last_sync_at timestamptz,
  last_sync_message text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outreach_settings_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT outreach_settings_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX outreach_settings_org_id_idx ON public.outreach_settings(org_id);
--> statement-breakpoint
CREATE UNIQUE INDEX outreach_settings_org_id_uq ON public.outreach_settings(org_id);
--> statement-breakpoint
CREATE TABLE public.outreach_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('google_places','manual','import')),
  source_id text,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  trade text NOT NULL CHECK (length(trade) BETWEEN 1 AND 40),
  city text NOT NULL DEFAULT '' CHECK (length(city) <= 100),
  state text NOT NULL DEFAULT 'TX' CHECK (length(state) <= 40),
  address text NOT NULL DEFAULT '' CHECK (length(address) <= 300),
  phone text CHECK (length(phone) <= 40),
  website text CHECK (length(website) <= 500),
  email text CHECK (length(email) <= 254),
  email_source text CHECK (email_source IN ('website','manual','import')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','replied','interested','offer','declined','do_not_contact')),
  found_on date NOT NULL,
  last_contacted_at timestamptz,
  last_reply_at timestamptz,
  offer_amount_minor bigint CHECK (offer_amount_minor >= 0),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outreach_companies_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT outreach_companies_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX outreach_companies_org_id_idx ON public.outreach_companies(org_id);
--> statement-breakpoint
CREATE UNIQUE INDEX outreach_companies_org_id_source_source_id_uq ON public.outreach_companies(org_id, source, source_id);
--> statement-breakpoint
CREATE INDEX outreach_companies_found_on_idx ON public.outreach_companies(found_on);
--> statement-breakpoint
CREATE INDEX outreach_companies_status_idx ON public.outreach_companies(status);
--> statement-breakpoint
CREATE TABLE public.outreach_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  company_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('out','in','call')),
  status text NOT NULL CHECK (status IN ('queued','sent','failed','received','logged')),
  subject text NOT NULL DEFAULT '' CHECK (length(subject) <= 300),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 12000),
  to_email text,
  from_email text,
  external_id text,
  web_link text,
  classification text,
  amount_minor bigint CHECK (amount_minor >= 0),
  sender_user_id uuid,
  error text,
  handled boolean NOT NULL DEFAULT false,
  sent_at timestamptz,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outreach_messages_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT outreach_messages_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT outreach_messages_company_id_fk FOREIGN KEY (org_id, company_id) REFERENCES public.outreach_companies(org_id, id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX outreach_messages_org_id_idx ON public.outreach_messages(org_id);
--> statement-breakpoint
CREATE UNIQUE INDEX outreach_messages_org_id_external_id_uq ON public.outreach_messages(org_id, external_id);
--> statement-breakpoint
CREATE INDEX outreach_messages_company_id_idx ON public.outreach_messages(company_id);
--> statement-breakpoint
CREATE INDEX outreach_messages_direction_status_idx ON public.outreach_messages(direction, status);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.outreach_settings');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.outreach_companies');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.outreach_messages');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outreach_settings, public.outreach_companies, public.outreach_messages TO fieldline_app, fieldline_platform;
