-- Baseline: database prerequisites shared by every module. Hand-written (drizzle-kit --custom).
-- PostGIS is required for property footprints, roof geometry georeferencing and curb segments.
-- IF NOT EXISTS keeps this a no-op where the extension was pre-installed by a superuser
-- (local portable Postgres, the postgis/postgis image), so the app role needs no extra rights.
CREATE EXTENSION IF NOT EXISTS postgis;
