# Database (apps/api/src/db)

- `schema/` — one Drizzle file per API module. `_columns.ts` (id, org_id, revision, timestamps,
  money `minorUnits` + `currencyColumn`, `rateColumn` numeric(18,6), PostGIS `geometry`/`geography`
  custom types), `_enums.ts` (Postgres enums built from the `@fieldline/contracts` tuples), and
  `_tenant.ts` (`tenantTable()`).
- `../../drizzle/` — migrations. `0000_baseline` (PostGIS), `0001_core_schema` (generated),
  `0002_rls_triggers` (hand-written: roles, grants, RLS, triggers). drizzle-kit quotes
  `geography(Point,4326)` as an identifier; the generated SQL was hand-corrected, so check any new
  geography column in future generated files.
- `seeds/demo.ts` — idempotent fictional demo data (deterministic ids via `seedId()`).

## Tenancy

Every tenant table is built with `tenantTable()`: `org_id NOT NULL` (indexed, FK to organizations),
`UNIQUE (org_id, id)`, and children reference parents with composite FKs `(org_id, parent_id) ->
parent(org_id, id)` via `h.fk(...)`, so a cross-tenant reference fails with SQLSTATE 23503.

Row-Level Security is ENABLEd and FORCEd on every table with `org_id`; the policy is
`org_id = fieldline_current_org_id()` (= `nullif(current_setting('app.org_id', true), '')::uuid`).
Special cases: `organizations` (by `id`, or membership of `app.user_id`), `memberships` (read also
by `user_id = app.user_id` for the workspace switcher), `feature_flags` (global rows with NULL org
are readable). Global tables without RLS: users, external_identities, sessions, jurisdictions,
plans, model_registry (the app role may only read the last three).

Request path: connect as `fieldline_app` (NOSUPERUSER NOBYPASSRLS; `APP_DATABASE_URL`), or as the
owner and `SET LOCAL ROLE fieldline_app`, then inside the transaction
`select set_config('app.org_id', $org, true), set_config('app.user_id', $user, true)`.

Privileged path (document every use in code review): migrations run as the owner; the job worker
and cross-tenant platform operations (creating an organization, previewing or accepting an invitation by token,
routing a payment webhook to its org, writing global reference data) use the owner connection with
`SET LOCAL ROLE fieldline_platform` (BYPASSRLS). Superusers bypass RLS entirely — never run the API
runtime as a superuser.

New tenant table in a later migration: `SELECT fieldline_enable_tenant_rls('table_name');`.

## Integrity triggers

- Append-only (UPDATE/DELETE raise SQLSTATE `FL001`): audit_events (also TRUNCATE),
  roof_order_events, job_events, signature_events, payment_events, ledger_entries,
  measurement_overrides, org_settings_revisions, estimate_revisions, usage_ledger, consents;
  roof_geometry_ops rejects UPDATE.
- Locked versions (SQLSTATE `FL002`): price_book_revisions once approved/retired,
  roof_report_versions once submitted+, proposal_versions once sent+ — only lifecycle columns may
  change and DELETE is rejected. Their children (price_items, production_rates, roof facets/
  vertices/edges/ops, proposal_options) cannot be inserted, changed or deleted under a locked parent.
- `updated_at` is maintained by a trigger on every table.
