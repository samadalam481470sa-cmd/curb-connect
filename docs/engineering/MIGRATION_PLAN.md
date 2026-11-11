# Migration plan (additive only)

This plan implements the blueprint in the existing Fieldline/Field Pro monorepo. It never replaces a
framework, never drops a column or table to simplify a feature, and never rewrites a working module.

## 0. Rules that apply to every phase

1. **Preserve first.** Check [EXISTING_FEATURE_REGISTRY.md](EXISTING_FEATURE_REGISTRY.md); extend the
   existing ID rather than adding a parallel one.
2. **Fill stubs, don't add modules.** A stub file (`modules/<name>/index.ts`) is the designated home
   for a module's routes. New modules require a product justification and a registry entry.
3. **Additive SQL only.** New tables/columns/indexes/policies. Removal is a two-step deprecation:
   stop writing, backfill/verify, then drop in a later release with an owner decision — the
   blueprint forbids destructive migrations outright.
4. **Contract source of truth.** DTOs live in `packages/contracts/src/resources.ts`; a route handler
   imports them. No shape defined twice.
5. **Authority stays server-side.** Every new tenant table calls
   `SELECT fieldline_enable_tenant_rls('name');` in the same migration that creates it.
6. **Never fabricate.** Unknown stays `unknown`; a vendor that is not configured stays unavailable
   behind its flag; AI abstains rather than guesses.
7. **No "done" without evidence.** Unit + integration + UI test, inventory update, and a traceability
   row. Compilation is not evidence.

## 1. Phase 0 — Verify the baseline (blocking, no product change)

| Step          | Command                                                                                        | Exit criterion                                   |
| ------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Install       | `npm ci`                                                                                       | clean                                            |
| Static gates  | `npm run lint`, `npm run typecheck`, `npm run build`                                           | all exit 0                                       |
| Unit          | `npm run test:unit`                                                                            | 337 passing, no skips added                      |
| Start PostGIS | `docker compose -f infra/docker-compose.yml --env-file infra/.env up -d` (or portable install) | healthy on 54329                                 |
| Migrate       | `npm run db:migrate`                                                                           | 0000–0002 apply to a clean DB                    |
| Integration   | `npm run test:integration`                                                                     | all pass, including `idor` and `security-review` |
| Vision        | `python3.13 -m pytest` in `services/vision`                                                    | all pass                                         |
| E2E           | `npm run build -w @fieldline/web && npx playwright install && npm run test:e2e`                | passes                                           |
| IdP           | `npm run demo:sprint0`                                                                         | tenancy walk-through completes                   |

If any step fails, fix the environment first. Do not build features on an unverified baseline, and
record the failure in this file rather than reporting the baseline as green.

## 2. Phase 1 — Foundation hardening (no new product surface)

- Enable the two already-called endpoints: `GET /v1/dashboard` and `GET /v1/search`
  (modules `dashboard`, `search`). They unblock two unavailable screens and are prerequisites for
  every KPI widget in the blueprint.
- Add schema drift check and a documented restore drill skeleton.
- Add `data-control-id` attributes? **No** — that is a UI convention decision; record it in
  ARCHITECTURE_DECISIONS.md first and apply it only where new screens are built.
- Exit: dashboard/search return real data (zeros vs unavailable distinguished), tests green.

## 3. Phase 2 — Properties and imagery (shared intake)

Additive work on `properties` and `imagery` stubs. Both roof and curb intake depend on them.

| Item                                                    | Endpoint                   | Tables                     |
| ------------------------------------------------------- | -------------------------- | -------------------------- |
| Address search (provider seam, honest "not configured") | `GET /v1/addresses/search` | none (provider)            |
| Properties CRUD + confirmation                          | `/v1/properties*`          | `properties`, `structures` |
| Jurisdiction resolution (unknown stays unknown)         | `/v1/jurisdictions`        | `jurisdictions`            |
| Imagery candidates + rights enforcement                 | `/v1/imagery*`             | `imagery_assets`           |

Exit: a property can be created with an unresolved jurisdiction and a missing geocoder, and both
conditions surface as review-required rather than as blank values.

## 4. Phase 3 — Roofing product

Order: `roof` routes → editor UI → report viewer → takeoff wiring → export.

| Step               | Surface                                 | Reuses                                                                            |
| ------------------ | --------------------------------------- | --------------------------------------------------------------------------------- |
| Orders + lifecycle | `POST/GET /v1/roof/orders`, transitions | `roofOrderMachine`, `roof_orders`, `roof_order_events`                            |
| Reports + versions | `/v1/roof/reports*`                     | `roof_reports`, `roof_report_versions` (locked after submit)                      |
| Geometry patch     | `PATCH /v1/roof/reports/:id/geometry`   | `PatchRoofGeometryRequestSchema`, `packages/geometry` editor, `roof_geometry_ops` |
| Takeoff            | `POST /v1/roof/reports/:id/takeoff`     | `packages/pricing` roof, `material_takeoffs`, `waste_policies`                    |
| Export             | `POST /v1/exports` + job                | `packages/pdf` roof-report template                                               |

Exit: blueprint Scenario A runs end to end for a fictional property, with the report PDF produced from
a stored revision and the estimate carrying its price-book revision id.

## 5. Phase 4 — Curb product

| Step                           | Surface                                         | Reuses                                                        |
| ------------------------------ | ----------------------------------------------- | ------------------------------------------------------------- |
| Projects + intake observations | `/v1/curb/projects*`                            | `curb_projects`, `curb_observations` (unknown is first-class) |
| Media + calibration            | `/v1/curb/projects/:id/calibrations`            | `calibrations`, `packages/geometry` calibration               |
| Segments + measurements        | `/v1/curb/projects/:id/{segments,measurements}` | `curb_segments`, `curb_measurements`                          |
| Risk/permit/safety             | `/v1/curb/projects/:id/{risks,permits,safety}`  | `risk_flags`, `permit_requirements`, `safety_reviews`         |
| Estimate + gating              | `/v1/estimates` with gating                     | `packages/pricing` curb, `GatingResultSchema`                 |

Exit: Scenario B and Scenario G pass — a preliminary estimate is producible while execution release
is blocked, and the blockage names each unresolved gate.

## 6. Phase 5 — Commercial chain

`pricebooks` → `estimates`/`approvals` → `proposals`/`signatures` → `invoices`/`payments` →
`changeorders`, plus `crm`/`jobs` for the customer and project records they hang from.

Hard rules for this phase:

- Financial writes inside one transaction with an audit row and an idempotency key.
- Accepted proposals are immutable; a change is a new version.
- A payment is `paid` only after a verified provider webhook or authenticated status read.
- Duplicate webhooks produce one payment effect (Scenario F).

## 7. Phase 6 — Field operations

`scheduling`/`dispatches` (readiness gate), `portal`, `reviews`, `exports`, `billing`, `vision`
wiring, mobile capture UI, offline conflict resolution. Scenario E must pass with real endpoints
before this phase closes.

## 8. Phase 7 — Advanced platform

Inventory/equipment (new additive tables), supplier procurement, analytics, remaining trades,
document intelligence, assistant. Each new table ships with RLS, indexes, a migration test and an
inventory update.

## 9. Adding a module or table: the exact checklist

1. Read the stub and its `db/schema/<name>.ts`.
2. Reuse the existing DTOs; add missing ones to `packages/contracts/src/resources.ts` with tests.
3. If a table is missing: write the drizzle definition, generate SQL with `npm run db:generate -w
@fieldline/api`, hand-review it (geography quoting), add
   `SELECT fieldline_enable_tenant_rls('table');`, keep it forward-only.
4. Implement routes inside the existing module file with `tenantTx`, `requireOrg`, `assertCan`.
5. Emit an audit event per write; use the outbox for side effects.
6. Add unit + integration tests (positive, denial, cross-tenant, stale revision).
7. Update `EXISTING_FEATURE_REGISTRY.md`, `ROUTE_INVENTORY.md`, `API_INVENTORY.md`,
   `DATABASE_INVENTORY.md`, `REGRESSION_TEST_MATRIX.md` in the same commit.
8. PR body: preserved behaviour, added behaviour, files, migrations, API/UI changes, permissions,
   tests, regression results, security findings, rollback.

## 10. Rollback

| Change type                   | Rollback                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------ |
| Code                          | redeploy the previous artifact (`deploy.yml` names releases by version+commit) |
| Additive migration            | leave the table/column in place and revert the code; data is retained          |
| Bad data written by a feature | append-only correction rows (never UPDATE financial history)                   |
| Feature that misbehaves       | turn its feature flag off; the UI then shows unavailable, not fake data        |
| Vendor fault                  | disable the adapter + flag; keep local behaviour                               |

Forward-only migrations mean a rollback never drops schema. Anything that must be removed is a
separate, owner-approved deprecation release after a documented retention period.
