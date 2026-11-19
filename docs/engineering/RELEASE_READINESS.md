# Release readiness

Blueprint §20 tracker scored against evidence at commit `0f3bcc6`, after the phase-0 baseline was
executed. A box is marked only when the check was performed in this repository.

**Score: 11 of 36 verified · 12 partial · 13 not started.** (Previous pass: 6 / 12 / 18.)

## Existing application preservation

| #   | Item                                  | Status | Evidence / reason                                                                                                                                      |
| --- | ------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Existing routes inventoried           | ✅     | [ROUTE_INVENTORY.md](ROUTE_INVENTORY.md): pages, endpoints, stubs, declared-but-unbuilt routes                                                         |
| 2   | Existing components inventoried       | ✅     | [COMPONENT_INVENTORY.md](COMPONENT_INVENTORY.md): shell, feature views, 22 design-system components                                                    |
| 3   | Existing APIs inventoried             | ✅     | [API_INVENTORY.md](API_INVENTORY.md) with module line counts                                                                                           |
| 4   | Existing database schemas inventoried | ✅     | [DATABASE_INVENTORY.md](DATABASE_INVENTORY.md); migrated database measured at 104 tables, 119 enums, 107 policies                                      |
| 5   | Existing tests preserved              | ✅     | 70 non-legacy test files intact; none deleted or skipped by these passes                                                                               |
| 6   | Marketing-site isolation verified     | ⚠️     | `marketing-site/` exists in-repo and is deployed separately on Vercel; it shares no code with `apps/web`, but the boundary was not exercised as a test |
| 7   | Regression baseline established       | ✅     | All four suites executed: unit 604, integration 177, vision 29, E2E 10 — every one exit 0                                                              |

## Roofing and curb products

| #   | Item                                             | Status | Evidence / reason                                                                                                                               |
| --- | ------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 8   | Roof drawing and satellite workflow verified     | ⚠️     | Map-based roof workspace and footprint service exist with integration tests; no automated canvas/UI test, no licensed imagery-analysis provider |
| 9   | Roof calculations regression-tested              | ✅     | geometry (71) and pricing (45) unit tests plus roof-measurements integration (9) all pass                                                       |
| 10  | Roof material estimation implemented or verified | ⚠️     | Takeoff, waste and pack logic tested and exposed through the roof API; catalogue data and estimate UI still incomplete                          |
| 11  | Curb guided capture implemented or verified      | ⚠️     | Curb workspace and calibrated-camera maths exist; capture flow has no automated test                                                            |
| 12  | Curb calibration and measurement review verified | ⚠️     | Calibration maths unit-tested; no review queue test                                                                                             |
| 13  | Curb pricing regression-tested                   | ✅     | Curb cost model unit tests pass (page-60 fixture, tiering, saw production)                                                                      |
| 14  | Permit and utility gates verified                | ❌     | Tables and gate matrix documented; no enforcement in a work-order path                                                                          |

## Business operations

| #   | Item                      | Status | Evidence / reason                                                                                         |
| --- | ------------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| 15  | CRM                       | ⚠️     | Customer job-status sharing works end to end (`job-customer-status.int`, 4); full CRM module still a stub |
| 16  | Projects                  | ✅     | Jobs pipeline live and covered: `pipeline.int` (11), `jobs-bidding.int` (3) green                         |
| 17  | Estimates and proposals   | ❌     | Stubs; schema/contracts only                                                                              |
| 18  | Invoices and payments     | ❌     | No payment route; no provider configured                                                                  |
| 19  | Scheduling and workforce  | ❌     | Tables only                                                                                               |
| 20  | Supplier marketplace      | ❌     | `supplier_orders` table; no routes                                                                        |
| 21  | Procurement and inventory | ❌     | No inventory/equipment tables                                                                             |
| 22  | Documents and contracts   | ⚠️     | Media/upload/EXIF pipeline verified (13 tests); contracts and exports have no routes                      |

## AI and field operations

| #   | Item                           | Status | Evidence / reason                                                                                                       |
| --- | ------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| 23  | Construction AI assistant      | ❌     | Not started                                                                                                             |
| 24  | Image intelligence             | ⚠️     | Photo-quality scoring real; roof-analysis contract ranks imagery and abstains without a registered model; no API wiring |
| 25  | Document intelligence          | ❌     | No OCR                                                                                                                  |
| 26  | Mobile camera and uploads      | ⚠️     | Upload sessions and PWA verified; guided capture UI untested                                                            |
| 27  | Offline field workflows        | ⚠️     | Outbox with idempotency keys unit-tested; no field endpoints to sync to                                                 |
| 28  | AI confidence and human review | ⚠️     | Abstention contract tested; no review routes                                                                            |

## Production readiness

| #   | Item                       | Status | Evidence / reason                                                                                                             |
| --- | -------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------- |
| 29  | Tenant isolation tests     | ✅     | `idor.int.test.ts` (25) and `security-review.int.test.ts` (5) pass as `fieldline_app` (NOBYPASSRLS) against 107 live policies |
| 30  | Payment security tests     | ❌     | No payment path to test                                                                                                       |
| 31  | Automated regression suite | ✅     | Unit, integration, vision and E2E suites all executed green in one baseline; CI runs the same commands                        |
| 32  | Performance testing        | ❌     | No load profile or measurement                                                                                                |
| 33  | Backups and restoration    | ❌     | No backup strategy or restore drill                                                                                           |
| 34  | Monitoring and alerting    | ⚠️     | Structured logs, correlation ids, OTel hooks, health probes; no dashboards or alerts                                          |
| 35  | Deployment verification    | ❌     | `deploy.yml` builds artifacts and deploys nowhere; no hosting chosen for the API                                              |
| 36  | User acceptance testing    | ❌     | No pilot; no complete commercial journey                                                                                      |

## What "done" requires next

1. Turn the twelve PARTIAL rows into PASS or a documented gap: canvas/capture UI tests, review queue,
   CRM surface, and imagery-analysis provider are the blockers.
2. Implement `estimates`/`proposals` and the payment path, then Scenario C and F become testable.
3. Add performance, backup/restore and deployment verification — the three production items with no
   evidence at all.
4. Re-run this baseline whenever tenancy, auth or schema changes; scenario D is the highest-value check.

## Standing limitations of this baseline

- PostgreSQL 16.15 + PostGIS 3.4.2 were assembled locally; CI uses `postgis/postgis:17-3.5`.
- The camera Playwright suite and CI runs themselves were not executed here.
- Nothing was deployed, migrated against a real environment, or published.
- Screens rendered under a headless browser with system fonts only; visual fidelity was not reviewed.
