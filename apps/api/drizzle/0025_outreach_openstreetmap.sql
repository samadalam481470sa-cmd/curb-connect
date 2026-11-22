-- Outreach: companies can also come from OpenStreetMap (free search when no Google Places key).
ALTER TABLE public.outreach_companies DROP CONSTRAINT IF EXISTS outreach_companies_source_check;
--> statement-breakpoint
ALTER TABLE public.outreach_companies ADD CONSTRAINT outreach_companies_source_check
  CHECK (source IN ('google_places','openstreetmap','manual','import'));
