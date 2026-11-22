-- Outreach: Texas license leads from the TDLR public license file (data.texas.gov 7358-krk7).
ALTER TABLE public.outreach_companies DROP CONSTRAINT IF EXISTS outreach_companies_source_check;
--> statement-breakpoint
ALTER TABLE public.outreach_companies ADD CONSTRAINT outreach_companies_source_check
  CHECK (source IN ('google_places','openstreetmap','tdlr','manual','import'));
--> statement-breakpoint
ALTER TABLE public.outreach_companies
  ADD COLUMN owner_name text CHECK (length(owner_name) <= 200),
  ADD COLUMN county text CHECK (length(county) <= 60),
  ADD COLUMN license_type text CHECK (length(license_type) <= 80),
  ADD COLUMN license_number text CHECK (length(license_number) <= 40),
  ADD COLUMN license_expires_on date,
  ADD COLUMN score integer CHECK (score BETWEEN 0 AND 100);
--> statement-breakpoint
CREATE INDEX outreach_companies_license_expires_on_idx ON public.outreach_companies(license_expires_on);
--> statement-breakpoint
ALTER TABLE public.outreach_settings
  ADD COLUMN license_types text[] NOT NULL DEFAULT '{}',
  ADD COLUMN license_counties text[] NOT NULL DEFAULT '{}',
  ADD COLUMN license_days integer NOT NULL DEFAULT 60 CHECK (license_days BETWEEN 7 AND 365),
  ADD COLUMN call_script_template text NOT NULL DEFAULT '' CHECK (length(call_script_template) <= 4000);
