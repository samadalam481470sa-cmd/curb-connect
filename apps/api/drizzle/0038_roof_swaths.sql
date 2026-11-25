-- Hail swaths (additive): one stored row per UTC day holding the hail-path polygons
-- derived from NOAA MRMS MESH Max 1440min (trailing-24h maximum estimated hail size).
-- The MRMS directory only keeps about the last 24 hours of files, so the app keeps its own
-- copy: the swath worker (apps/swath-worker) fetches the latest file every 30 minutes,
-- thresholds cells at/above 1.00 inch, and upserts the day's row (swath_date is the UTC date
-- of the file's validity time). A row is stored even on quiet days (empty features) so the
-- API can tell "checked, no hail" apart from "never run". Platform-owned, not tenant data:
-- no RLS; the API reads it through the named platform operation `roof.swath`, and the worker
-- writes it with the owner database URL. Features are GeoJSON Polygon/MultiPolygon features
-- with properties.maxHailIn (inches, 2dp). MRMS is a modeled radar estimate, never confirmed
-- damage — the API labels it that way on every response. No existing tables change.
CREATE TABLE public.roof_swaths (
  swath_date date PRIMARY KEY,
  source text NOT NULL DEFAULT 'NOAA MRMS MESH Max 1440min',
  source_file text NOT NULL DEFAULT '',
  source_valid_at timestamptz,
  threshold_in numeric(4,2) NOT NULL DEFAULT 1.00,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  feature_count integer NOT NULL DEFAULT 0,
  cell_count integer NOT NULL DEFAULT 0,
  checked_at timestamptz NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roof_swaths TO fieldline_app, fieldline_platform;
