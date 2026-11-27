-- 0098: trade finder (blueprint gap 6).
--   * directory_profiles: one per org — published trade-directory fields
--     (trades, service cities/ZIPs, availability, license/insurance expiry).
--     Read cross-tenant only for directory-opted-in orgs via the named
--     platform operation 'trade_finder.search'.
--   * vendor_profiles: the org's own private vendor records with the same
--     qualification fields. Tenant-scoped, never cross-tenant.
CREATE TABLE public.directory_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  trades text[] NOT NULL DEFAULT '{}',
  service_cities text[] NOT NULL DEFAULT '{}',
  service_zips text[] NOT NULL DEFAULT '{}',
  availability text CHECK (availability IS NULL OR availability IN ('available','busy','not_taking_work')),
  availability_note text CHECK (availability_note IS NULL OR length(availability_note) <= 300),
  license_number text CHECK (license_number IS NULL OR length(license_number) <= 80),
  license_expires_on date,
  insurance_expires_on date,
  qualifications_note text CHECK (qualifications_note IS NULL OR length(qualifications_note) <= 1000),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT directory_profiles_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT directory_profiles_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT directory_profiles_org_id_uq UNIQUE (org_id)
);
--> statement-breakpoint
CREATE INDEX directory_profiles_org_id_idx ON public.directory_profiles(org_id);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.directory_profiles');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.directory_profiles TO fieldline_app, fieldline_platform;
--> statement-breakpoint
CREATE TABLE public.vendor_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  trade text CHECK (trade IS NULL OR length(trade) <= 80),
  contact_name text CHECK (contact_name IS NULL OR length(contact_name) <= 120),
  contact_phone text CHECK (contact_phone IS NULL OR length(contact_phone) <= 40),
  contact_email text CHECK (contact_email IS NULL OR length(contact_email) <= 200),
  service_cities text[] NOT NULL DEFAULT '{}',
  service_zips text[] NOT NULL DEFAULT '{}',
  availability text CHECK (availability IS NULL OR availability IN ('available','busy','not_taking_work')),
  availability_note text CHECK (availability_note IS NULL OR length(availability_note) <= 300),
  license_number text CHECK (license_number IS NULL OR length(license_number) <= 80),
  license_expires_on date,
  insurance_expires_on date,
  qualifications_note text CHECK (qualifications_note IS NULL OR length(qualifications_note) <= 1000),
  notes text CHECK (notes IS NULL OR length(notes) <= 2000),
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendor_profiles_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT vendor_profiles_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX vendor_profiles_org_id_idx ON public.vendor_profiles(org_id);
--> statement-breakpoint
CREATE INDEX vendor_profiles_org_id_trade_idx ON public.vendor_profiles(org_id, trade);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.vendor_profiles');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendor_profiles TO fieldline_app, fieldline_platform;
