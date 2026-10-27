-- Custom migration (drizzle-kit generate --custom): roles, grants, Row-Level Security, and the
-- integrity triggers drizzle-kit cannot express. See apps/api/src/db/README.md for the model.
--
-- Roles (cluster-wide, so creation is idempotent and shared by fieldline_dev and fieldline_test):
--   fieldline_app       NOSUPERUSER NOBYPASSRLS. The API runtime connects as (or SET ROLE to) it,
--                       so RLS applies. Its LOGIN/password is managed outside migrations.
--   fieldline_platform  NOLOGIN BYPASSRLS. The privileged path for the job worker and cross-tenant
--                       platform operations (org bootstrap, invitation acceptance by token,
--                       webhook routing): the owner connection runs SET ROLE fieldline_platform.
--   migration owner     whoever runs migrations (local/CI superuser `fieldline`) owns the tables.
--                       FORCE ROW LEVEL SECURITY makes even a non-superuser owner subject to RLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fieldline_app') THEN
    CREATE ROLE fieldline_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE fieldline_app NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fieldline_platform') THEN
    CREATE ROLE fieldline_platform NOLOGIN NOSUPERUSER BYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  -- Lets the migration/owner connection switch into either role (no-op for superusers).
  EXECUTE format('GRANT fieldline_app, fieldline_platform TO %I', current_user);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'could not grant fieldline roles to %: %', current_user, SQLERRM;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO fieldline_app, fieldline_platform;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fieldline_app, fieldline_platform;
--> statement-breakpoint
-- Global reference data: the app reads it; only the platform role writes it.
REVOKE INSERT, UPDATE, DELETE ON jurisdictions, plans, model_registry, spatial_ref_sys FROM fieldline_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fieldline_app, fieldline_platform;
--> statement-breakpoint

-- ------------------------------------------------------------------ tenant context helpers
-- nullif(...,'') matters: after a transaction-local set_config ends, the setting reads as ''.
CREATE OR REPLACE FUNCTION fieldline_current_org_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION fieldline_current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION fieldline_current_org_id(), fieldline_current_user_id() TO PUBLIC;
--> statement-breakpoint

-- Enables + forces RLS with the standard tenant policy. Future migrations call this for every
-- new tenant table: SELECT fieldline_enable_tenant_rls('my_table');
CREATE OR REPLACE FUNCTION fieldline_enable_tenant_rls(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s USING (org_id = fieldline_current_org_id()) '
    'WITH CHECK (org_id = fieldline_current_org_id())', tbl);
END
$$;
--> statement-breakpoint
-- Every public table with an org_id column except the specially-scoped ones below.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'org_id' AND t.table_type = 'BASE TABLE'
      AND c.table_name NOT IN ('feature_flags', 'memberships')
  LOOP
    PERFORM fieldline_enable_tenant_rls(format('public.%I', r.table_name)::regclass);
  END LOOP;
END
$$;
--> statement-breakpoint

-- memberships: a user sees their own memberships in every org (workspace switcher, GET /v1/me
-- with app.user_id set) and all memberships of the active org; writes stay in the active org.
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memberships_read ON memberships FOR SELECT
  USING (org_id = fieldline_current_org_id() OR user_id = fieldline_current_user_id());
--> statement-breakpoint
CREATE POLICY memberships_insert ON memberships FOR INSERT WITH CHECK (org_id = fieldline_current_org_id());
--> statement-breakpoint
CREATE POLICY memberships_update ON memberships FOR UPDATE
  USING (org_id = fieldline_current_org_id()) WITH CHECK (org_id = fieldline_current_org_id());
--> statement-breakpoint
CREATE POLICY memberships_delete ON memberships FOR DELETE USING (org_id = fieldline_current_org_id());
--> statement-breakpoint

-- organizations: the tenant root is keyed by id. Visible when active, or when the current user
-- is a member (workspace list). Creating an organization is a platform operation.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organizations_read ON organizations FOR SELECT USING (
  id = fieldline_current_org_id()
  OR EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = organizations.id AND m.user_id = fieldline_current_user_id())
);
--> statement-breakpoint
CREATE POLICY organizations_update ON organizations FOR UPDATE
  USING (id = fieldline_current_org_id()) WITH CHECK (id = fieldline_current_org_id());
--> statement-breakpoint

-- feature_flags: tenants read global defaults (org_id NULL) plus their own rows; write own rows.
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feature_flags FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY feature_flags_read ON feature_flags FOR SELECT
  USING (org_id IS NULL OR org_id = fieldline_current_org_id());
--> statement-breakpoint
CREATE POLICY feature_flags_write ON feature_flags FOR ALL
  USING (org_id = fieldline_current_org_id()) WITH CHECK (org_id = fieldline_current_org_id());
--> statement-breakpoint

-- ------------------------------------------------------------------ updated_at maintenance
CREATE OR REPLACE FUNCTION fieldline_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
--> statement-breakpoint
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('CREATE TRIGGER a_touch_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION fieldline_touch_updated_at()', r.table_name);
  END LOOP;
END
$$;
--> statement-breakpoint

-- ------------------------------------------------------------------ append-only tables
-- Raises SQLSTATE 'FL001' so the API can map it to a stable problem code.
CREATE OR REPLACE FUNCTION fieldline_reject_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'FL001';
END
$$;
--> statement-breakpoint
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'audit_events', 'roof_order_events', 'job_events', 'signature_events', 'payment_events',
    'ledger_entries', 'measurement_overrides', 'org_settings_revisions', 'estimate_revisions',
    'usage_ledger', 'consents'
  ] LOOP
    EXECUTE format('CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION fieldline_reject_mutation()', tbl);
  END LOOP;
END
$$;
--> statement-breakpoint
-- Truncate bypasses row triggers; block it too on the audit log.
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION fieldline_reject_mutation();
--> statement-breakpoint
-- The geometry command log may be dropped with its draft version, but never rewritten.
CREATE TRIGGER append_only BEFORE UPDATE ON roof_geometry_ops
  FOR EACH ROW EXECUTE FUNCTION fieldline_reject_mutation();
--> statement-breakpoint

-- ------------------------------------------------------------------ locked versions
-- fieldline_guard_locked_version(allowed_columns_csv, locked_status...): once OLD.status is one
-- of the locked statuses, DELETE is rejected and UPDATE may change only the allowed columns
-- (lifecycle fields such as status). Raises SQLSTATE 'FL002'.
CREATE OR REPLACE FUNCTION fieldline_guard_locked_version() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  allowed text[] := string_to_array(TG_ARGV[0], ',') || ARRAY['updated_at', 'revision'];
  locked text[] := TG_ARGV[1:];
  old_doc jsonb;
  new_doc jsonb;
BEGIN
  IF NOT (OLD.status::text = ANY (locked)) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% % is % and immutable', TG_TABLE_NAME, OLD.id, OLD.status USING ERRCODE = 'FL002';
  END IF;
  old_doc := to_jsonb(OLD) - allowed;
  new_doc := to_jsonb(NEW) - allowed;
  IF old_doc IS DISTINCT FROM new_doc THEN
    RAISE EXCEPTION '% % is % and immutable', TG_TABLE_NAME, OLD.id, OLD.status USING ERRCODE = 'FL002';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER z_locked_version BEFORE UPDATE OR DELETE ON price_book_revisions FOR EACH ROW
  EXECUTE FUNCTION fieldline_guard_locked_version('status,effective_to', 'approved', 'retired');
--> statement-breakpoint
CREATE TRIGGER z_locked_version BEFORE UPDATE OR DELETE ON roof_report_versions FOR EACH ROW
  EXECUTE FUNCTION fieldline_guard_locked_version('status,approved_at,approved_by_user_id',
    'submitted', 'approved', 'issued', 'superseded', 'rejected');
--> statement-breakpoint
CREATE TRIGGER z_locked_version BEFORE UPDATE OR DELETE ON proposal_versions FOR EACH ROW
  EXECUTE FUNCTION fieldline_guard_locked_version('status', 'sent', 'accepted', 'declined', 'superseded');
--> statement-breakpoint

-- Children of a locked parent are frozen too. Args: parent_table, fk_column, locked_status...
CREATE OR REPLACE FUNCTION fieldline_guard_locked_parent() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_table text := TG_ARGV[0];
  fk_column text := TG_ARGV[1];
  locked text[] := TG_ARGV[2:];
  parent_id uuid;
  parent_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    parent_id := (to_jsonb(OLD) ->> fk_column)::uuid;
  ELSE
    parent_id := (to_jsonb(NEW) ->> fk_column)::uuid;
  END IF;
  EXECUTE format('SELECT status::text FROM public.%I WHERE id = $1', parent_table)
    INTO parent_status USING parent_id;
  IF parent_status = ANY (locked) THEN
    RAISE EXCEPTION '% rows of % % (%) are immutable', TG_TABLE_NAME, parent_table, parent_id, parent_status
      USING ERRCODE = 'FL002';
  END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) ->> fk_column) IS DISTINCT FROM (to_jsonb(NEW) ->> fk_column) THEN
    EXECUTE format('SELECT status::text FROM public.%I WHERE id = $1', parent_table)
      INTO parent_status USING (to_jsonb(OLD) ->> fk_column)::uuid;
    IF parent_status = ANY (locked) THEN
      RAISE EXCEPTION '% rows of locked % cannot be moved', TG_TABLE_NAME, parent_table USING ERRCODE = 'FL002';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['price_items', 'production_rates'] LOOP
    EXECUTE format('CREATE TRIGGER z_locked_parent BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION fieldline_guard_locked_parent(%L, %L, %L, %L)',
      tbl, 'price_book_revisions', 'price_book_revision_id', 'approved', 'retired');
  END LOOP;
  FOREACH tbl IN ARRAY ARRAY['roof_facets', 'roof_vertices', 'roof_edges', 'roof_geometry_ops'] LOOP
    EXECUTE format('CREATE TRIGGER z_locked_parent BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION fieldline_guard_locked_parent(%L, %L, %L, %L, %L, %L, %L)',
      tbl, 'roof_report_versions', 'report_version_id', 'submitted', 'approved', 'issued', 'superseded', 'rejected');
  END LOOP;
  EXECUTE format('CREATE TRIGGER z_locked_parent BEFORE INSERT OR UPDATE OR DELETE ON public.proposal_options FOR EACH ROW EXECUTE FUNCTION fieldline_guard_locked_parent(%L, %L, %L, %L, %L, %L)',
    'proposal_versions', 'proposal_version_id', 'sent', 'accepted', 'declined', 'superseded');
END
$$;
