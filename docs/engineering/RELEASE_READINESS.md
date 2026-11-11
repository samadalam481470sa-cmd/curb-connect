# Release readiness

Blueprint §20 tracker scored against evidence at commit `c91a8cc`. A box is marked only when the
check was performed in this repository. Documentation-only work cannot turn a product box green.

**Score: 6 of 36 verified · 12 partial · 18 not started.**

## Existing application preservation

| #   | Item                                  | Status | Evidence / reason                                                                                                                                       |
| --- | ------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Existing routes inventoried           | ✅     | [ROUTE_INVENTORY.md](ROUTE_INVENTORY.md): 21 pages, 46 endpoints, 21 stubs, declared-but-unbuilt routes                                                 |
| 2   | Existing components inventoried       | ✅     | [COMPONENT_INVENTORY.md](COMPONENT_INVENTORY.md): shell, 10 feature views, 25 design-system components                                                  |
| 3   | Existing APIs inventoried             | ✅     | [API_INVENTORY.md](API_INVENTORY.md) with module line counts                                                                                            |
| 4   | Existing database schemas inventoried | ✅     | [DATABASE_INVENTORY.md](DATABASE_INVENTORY.md): 88 tables, 112 enums, RLS, triggers                                                                     |
| 5   | Existing tests preserved              | ✅     | 44 non-legacy test files intact; none deleted or skipped by this audit                                                                                  |
| 6   | Marketing-site isolation verified     | ⚠️     | No `marketing-site/` in the repo or its history; the site is a separate deployment, so isolation holds by absence and could not be tested as a boundary |
| 7   | Regression baseline established       | ✅     | `npm run test:unit`: 30 files, 337 tests, exit 0. Integration/vision/e2e **not run** (no PostGIS, Python 3.13 or browsers)                              |

## Roofing and curb products

| #   | Item                                             | Status | Evidence / reason                                                              |
| --- | ------------------------------------------------ | ------ | ------------------------------------------------------------------------------ |
| 8   | Roof drawing and satellite workflow verified     | ❌     | No canvas, no imagery provider; `/roof` is a coming-soon gate                  |
| 9   | Roof calculations regression-tested              | ⚠️     | `packages/geometry` + `packages/pricing` unit tests pass; no HTTP/UI path      |
| 10  | Roof material estimation implemented or verified | ⚠️     | Takeoff/waste/pack logic exists and is tested; no catalogue data, routes or UI |
| 11  | Curb guided capture implemented or verified      | ❌     | `modules/curb` is a stub; no capture UI                                        |
| 12  | Curb calibration and measurement review verified | ❌     | Calibration math tested; no routes, no review queue                            |
| 13  | Curb pricing regression-tested                   | ⚠️     | Cost model unit tests pass; no price-book content or estimate route            |
| 14  | Permit and utility gates verified                | ❌     | Tables + 12-gate matrix documented; no enforcement in a work order path        |

## Business operations

| #   | Item                      | Status | Evidence / reason                                                      |
| --- | ------------------------- | ------ | ---------------------------------------------------------------------- |
| 15  | CRM                       | ❌     | `crm` module stub; `/leads` coming soon                                |
| 16  | Projects                  | ❌     | `jobs` stub; `/jobs` coming soon                                       |
| 17  | Estimates and proposals   | ❌     | Stubs; schema/contracts only                                           |
| 18  | Invoices and payments     | ❌     | Stubs; no provider, no webhook verification                            |
| 19  | Scheduling and workforce  | ❌     | Tables only; `crew_manager` role exists                                |
| 20  | Supplier marketplace      | ❌     | `supplier_orders` table; flag off                                      |
| 21  | Procurement and inventory | ❌     | No inventory/equipment tables at all                                   |
| 22  | Documents and contracts   | ⚠️     | Media/upload/EXIF pipeline works; contracts and exports have no routes |

## AI and field operations

| #   | Item                           | Status | Evidence / reason                                                                               |
| --- | ------------------------------ | ------ | ----------------------------------------------------------------------------------------------- |
| 23  | Construction AI assistant      | ❌     | Not started                                                                                     |
| 24  | Image intelligence             | ⚠️     | Photo-quality scoring real; recognisers abstain by design; API client is a stub                 |
| 25  | Document intelligence          | ❌     | Not started (no OCR)                                                                            |
| 26  | Mobile camera and uploads      | ⚠️     | Upload sessions + PWA exist; no guided capture UI                                               |
| 27  | Offline field workflows        | ⚠️     | IndexedDB outbox with idempotency keys and tests; no field endpoints to sync to, no conflict UI |
| 28  | AI confidence and human review | ⚠️     | Abstention contract + review tables exist; no review routes or UI                               |

## Production readiness

| #   | Item                       | Status | Evidence / reason                                                                           |
| --- | -------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| 29  | Tenant isolation tests     | ⚠️     | RLS + composite FKs + `idor.int.test.ts` exist; test **not executed** here                  |
| 30  | Payment security tests     | ❌     | No payment path to test                                                                     |
| 31  | Automated regression suite | ⚠️     | Unit suite green; integration/vision/e2e unexecuted in this audit; CI status not observable |
| 32  | Performance testing        | ❌     | No load profile or measurement                                                              |
| 33  | Backups and restoration    | ❌     | No backup strategy or restore drill                                                         |
| 34  | Monitoring and alerting    | ⚠️     | Structured logs, correlation ids, OTel hooks, health probes; no dashboards or alerts        |
| 35  | Deployment verification    | ❌     | `deploy.yml` builds artifacts and deploys nowhere; no hosting chosen                        |
| 36  | User acceptance testing    | ❌     | No pilot; no complete journey exists                                                        |

## What "done" requires next

1. Execute the unrun suites (phase 0 of [MIGRATION_PLAN.md](MIGRATION_PLAN.md)) and replace the ⚠️
   rows with measured results.
2. Implement `dashboard` + `search` to remove two unavailable screens.
3. Build the roofing and curb HTTP surfaces, then their screens, so items 8–14 can be scored honestly.
4. Only then move into the commercial chain.

## Standing limitations of this audit

- No database, no browsers, no Python 3.13 in the environment: database, worker and browser
  behaviour is `static` or `unrun`, never claimed as passing.
- CI history was not inspected; workflow files were read, not executed.
- Only the product's read-only state was examined; nothing was deployed, migrated or published.
