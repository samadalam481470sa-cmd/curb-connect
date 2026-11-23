-- Land Scout (additive): saved buy boxes and company-imported parcels. Live county CAD
-- data is queried per search and never stored; only parcels a company imports itself
-- (e.g. a fresher DCAD export) are kept, labeled with their source. No existing tables change.
CREATE TABLE public.land_scout_buy_boxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) <= 120),
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT land_scout_buy_boxes_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT land_scout_buy_boxes_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE TABLE public.land_scout_parcels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  county text NOT NULL CHECK (county IN ('collin','dallas')),
  parcel_id text NOT NULL CHECK (length(parcel_id) <= 80),
  owner_name text,
  owner_mailing text,
  situs_address text,
  city text,
  zip text,
  acres numeric(14,4) CHECK (acres IS NULL OR acres >= 0),
  appraisal_use text,
  land_value numeric(16,2),
  market_value numeric(16,2),
  value_year numeric(6,0),
  lat numeric(12,7),
  lon numeric(12,7),
  vintage text,
  source text NOT NULL,
  source_url text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT land_scout_parcels_org_id_id_uq UNIQUE (org_id, id),
  CONSTRAINT land_scout_parcels_parcel_uq UNIQUE (org_id, county, parcel_id),
  CONSTRAINT land_scout_parcels_org_fk FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX land_scout_buy_boxes_org_id_idx ON public.land_scout_buy_boxes(org_id);
--> statement-breakpoint
CREATE INDEX land_scout_buy_boxes_created_idx ON public.land_scout_buy_boxes(org_id, created_at);
--> statement-breakpoint
CREATE INDEX land_scout_parcels_org_id_idx ON public.land_scout_parcels(org_id);
--> statement-breakpoint
CREATE INDEX land_scout_parcels_county_idx ON public.land_scout_parcels(org_id, county);
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.land_scout_buy_boxes');
--> statement-breakpoint
SELECT fieldline_enable_tenant_rls('public.land_scout_parcels');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.land_scout_buy_boxes, public.land_scout_parcels TO fieldline_app, fieldline_platform;
