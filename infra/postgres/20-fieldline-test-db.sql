-- First-start init for the postgis/postgis container (infra/docker-compose.yml).
-- fieldline_dev is created by POSTGRES_DB; this adds the isolated test database used by
-- `npm test` (API integration tests only ever touch databases whose name ends in "_test").
CREATE DATABASE fieldline_test OWNER fieldline;
\connect fieldline_test
CREATE EXTENSION IF NOT EXISTS postgis;
