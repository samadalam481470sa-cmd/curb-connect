# Database inventory

## 1. Migrations

| File                                     | Lines | Kind                                  | Content                                                                                                                                                    |
| ---------------------------------------- | ----- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/drizzle/0000_baseline.sql`     | 5     | hand-written                          | `CREATE EXTENSION postgis` baseline                                                                                                                        |
| `apps/api/drizzle/0001_core_schema.sql`  | 2183  | drizzle-kit generated, hand-corrected | **88 tables, 112 enums**, indexes, composite foreign keys. Migrated database at `0f3bcc6`: **104 tables, 119 enums, 107 policies, 94 RLS-enabled tables**. |
| `apps/api/drizzle/0002_rls_triggers.sql` | 270   | hand-written                          | roles (`fieldline_app`, `fieldline_platform`), grants, RLS enable+force, helpers, append-only and version-lock triggers                                    |

Forward-only. `apps/api/src/db/migrator.ts` applies them; `reset-test.ts` refuses any database whose
name does not end in `_test`. Drizzle schema files in `src/db/schema/*` are the typed mirror used by
the API (tables are built with `tenantTable()` / `tenantTable`-style helpers, not raw `pgTable`, in
most files).

## 2. Tables by domain (88 in migration 0001; 104 in the migrated database)

| Domain                     | Tables                                                                                                                                                                 |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity & tenancy (9)     | `users`, `external_identities`, `sessions`, `organizations`, `memberships`, `invitations`, `role_bundles`, `permission_overrides`, `approval_delegations`              |
| Org config (4)             | `org_settings_revisions`, `feature_flags`, `service_areas`, `jurisdictions`                                                                                            |
| Audit & events (6)         | `audit_events`, `domain_events`, `idempotency_keys`, `consents`, `notes`, `tasks`                                                                                      |
| Media & storage (4)        | `media_assets`, `media_redactions`, `upload_sessions`, `attachments`                                                                                                   |
| Properties (2)             | `properties`, `structures`                                                                                                                                             |
| Imagery & vision (3)       | `imagery_assets`, `inference_results`, `model_registry`                                                                                                                |
| Roof (9)                   | `roof_orders`, `roof_order_events`, `roof_reports`, `roof_report_versions`, `roof_facets`, `roof_vertices`, `roof_edges`, `roof_geometry_ops`, `measurement_overrides` |
| Roof takeoff (4)           | `material_takeoffs`, `material_catalog_items`, `waste_policies`, `production_rates`                                                                                    |
| Curb (8)                   | `curb_projects`, `curb_observations`, `calibrations`, `curb_segments`, `curb_measurements`, `risk_flags`, `permit_requirements`, `safety_reviews`                      |
| Pricing (4)                | `price_books`, `price_book_revisions`, `price_items`, `production_rates` (shared)                                                                                      |
| Estimating & approvals (4) | `estimates`, `estimate_revisions`, `approvals`, `review_tasks`                                                                                                         |
| CRM & jobs (10)            | `customers`, `contacts`, `leads`, `jobs`, `job_events`, `job_stage_definitions`, `crews`, `crew_members`, `schedules`, `dispatches`                                    |
| Proposals & contracts (8)  | `proposals`, `proposal_versions`, `proposal_options`, `proposal_selections`, `signature_envelopes`, `signature_events`, `contracts`, `portal_tokens`                   |
| Billing (7)                | `invoices`, `invoice_lines`, `payments`, `payment_events`, `ledger_entries`, `change_orders`, `supplier_orders`                                                        |
| Platform plan (5)          | `plans`, `subscriptions`, `entitlements`, `usage_ledger`, `export_records`                                                                                             |
| Communications (2)         | `notifications`, `notification_preferences`                                                                                                                            |

(Row counts overlap where a table serves two domains; the authoritative count is 88 `CREATE TABLE`
statements in `0001_core_schema.sql`.)

## 3. Tenancy model

- Every tenant table: `org_id uuid NOT NULL`, indexed, FK to `organizations`, `UNIQUE (org_id, id)`.
- Children use composite FKs `(org_id, parent_id) → parent(org_id, id)` — a cross-tenant reference
  fails with SQLSTATE 23503 rather than being merely filtered out.
- RLS is **enabled and forced** on every table with `org_id`. Policy:
  `org_id = fieldline_current_org_id()` = `nullif(current_setting('app.org_id', true), '')::uuid`.
- Special cases: `organizations` (by `id` or membership of `app.user_id`), `memberships` (also
  readable by `user_id` for the workspace switcher), `feature_flags` (global rows with NULL org).
- Global tables without RLS: `users`, `external_identities`, `sessions`, `jurisdictions`, `plans`,
  `model_registry` (app role may only read the last three).
- Runtime role: `fieldline_app` (NOSUPERUSER NOBYPASSRLS). The job worker and named cross-tenant
  platform operations use `fieldline_platform` (BYPASSRLS) through `withPlatform()` and must be
  listed in `PLATFORM_OPERATIONS` (documented per use).
- New tenant table: `SELECT fieldline_enable_tenant_rls('table_name');`

## 4. Integrity triggers

| Trigger class          | Effect                                                                                                                                                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Append-only (`FL001`)  | UPDATE/DELETE rejected on `audit_events`, `roof_order_events`, `job_events`, `signature_events`, `payment_events`, `ledger_entries`, `measurement_overrides`, `org_settings_revisions`, `estimate_revisions`, `usage_ledger`, `consents`; `roof_geometry_ops` rejects UPDATE |
| Version lock (`FL002`) | after approval/issue, `price_book_revisions`, `roof_report_versions`, `proposal_versions` may only change lifecycle columns; DELETE rejected; children (`price_items`, `production_rates`, facets/vertices/edges/ops, `proposal_options`) are frozen under a locked parent   |
| `updated_at`           | maintained by trigger on every table                                                                                                                                                                                                                                         |
| Truncate guard         | `audit_events` cannot be truncated                                                                                                                                                                                                                                           |

## 5. Units, money and unknown values

- Canonical units: metres, square metres, cubic metres (ADR 0005). Imperial display is a formatting
  concern (`packages/ui/src/format/length.ts`, `apps/web/src/lib/format.ts`).
- Money: integer minor units (`bigint`) + ISO currency. Unit rates `numeric(18,6)` returned as
  strings. Never floating point. Rounding half-up at named stages.
- Measurement: either `{ state: 'unknown', reason }` or
  `{ state: 'known', value, unit, source, measuredAt, precision }` with provenance
  `machine_estimated | imagery_derived | user_entered | field_verified | survey_supplied`.
- Pitch: rise/run ratio **plus** the original input (e.g. 6-in-12).
- Spatial: PostGIS `geometry`/`geography` columns (site location, paths, footprints), suitable for
  GiST indexes.

## 6. Domain invariants encoded in the schema

- Roof: each facet stored separately; sloped area derived, not stored as the plan area.
- Curb: `curb_observations.state` makes "unknown" a first-class stored answer with an
  `unknown_reason`; buried thickness/reinforcement/utility clearance are never inferred.
- Price books: approved revisions are immutable (`FL002`), so an issued estimate can always be
  reproduced from the revision it referenced.
- Financial history is append-only; corrections are new rows, not edits.

## 7. Verification status and risks

| Item                                                                                   | Status                                                                                                                                                       |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| DDL executed against PostgreSQL 17 + PostGIS in this audit                             | **not run** — no `psql` in the audit environment                                                                                                             |
| `apps/api/src/db/schema.int.test.ts` (17 cases), `test/database.int.test.ts` (5 cases) | exist, **unrun**                                                                                                                                             |
| Generated SQL hygiene                                                                  | known hazard documented in `src/db/README.md`: drizzle-kit quotes `geography(Point,4326)` as an identifier; generated geography columns must be hand-checked |
| Table drift risk                                                                       | typed schema files and migration are maintained together by hand; no automated drift check exists                                                            |

The next phase must run `npm run db:migrate` against a disposable PostGIS instance and execute the
integration suite before any schema change ships. That is the first additive-migration gate in
[MIGRATION_PLAN.md](MIGRATION_PLAN.md).
