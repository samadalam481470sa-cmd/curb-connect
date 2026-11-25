# FieldPro Enterprise verification ledger

## Source register

| Source | Supplied PDF                                | Pages | SHA-256                                                            |
| ------ | ------------------------------------------- | ----: | ------------------------------------------------------------------ |
| v4     | FieldPro Enterprise Developer Blueprint v4  | 1,433 | `b6a9c003cfbba722b2c0a94328d917f70060f8e9e7861c949b291f8121d37d58` |
| v5     | FieldPro Control-Level Addendum v5 Expanded |   562 | `ba88464b8bf945a02644f9f7607ed5bab6fe40a7f60ff2660f0bcce292ab8bc0` |

[The source page index](source-pages.tsv) accounts for all 1,995 PDF pages. Use physical PDF page numbers. The exact duplicate range is v5 pp. 1–315 and v4 pp. 1119–1433. The 315 page pairs have the same whitespace-normalized text and the same 72 dpi page render. Follow the `exact_duplicate_of` column to the canonical v4 page. All other pages stay in scope pending requirement review.

The v4 PDF contains 100 pages whose streams required recovery in a temporary copy. The index uses the recovered text for those pages. Its hashes describe the page text after whitespace normalization. The original PDF hashes above identify the supplied files.

## Evidence rules

- A verified row names a specific behavior, its original source, its repository implementation, and the test name from a passing run. A single card may contain several rows.
- A requirement remains pending until it has evidence. Tests listed elsewhere and catalog entries are source material for the review.
- A blocker applies to the specific item that depends on an unavailable service, asset, approval, or prerequisite. Keep independent work moving and record what would unblock it.

## Verified requirements

| Source                                                                   | Verified requirement                                                                                                                                                                 | Implementation                                                                                                                                                     | Passing test                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| v5 p. 522, `V5/VENDOR-BIDDING/A07`                                       | A company owner or admin can record an evidence-backed review for the exact quote in the current project and package. Requests from an estimator or a different company are refused. | [Review command](../../../apps/api/src/modules/enterprise/bidding.ts), [migration 0049](../../../apps/api/drizzle/0049_enterprise_bid_responsiveness.sql)          | [Review and exception](#postgresql-checks)      |
| v5 p. 522, `V5/VENDOR-BIDDING/A07`                                       | Each checklist criterion must be evaluated once. An unmet scope requirement blocks a responsive decision until the reviewer records an exception.                                    | [Review input schema](../../../packages/contracts/src/enterpriseBidding.ts), [review form](../../../apps/web/src/features/enterprise/BidResponsiveness.tsx)        | [Review and exception](#postgresql-checks)      |
| v5 p. 522, `V5/VENDOR-BIDDING/A07`                                       | Review retries return the original decision, history is audited, and review leaves source quotes and award state intact. The lowest price is never selected automatically.           | [Review and award transactions](../../../apps/api/src/modules/enterprise/bidding.ts)                                                                               | [Review and exception](#postgresql-checks)      |
| v5 p. 523, `V5/VENDOR-BIDDING/A08`                                       | Authorized approver records a reason and locks the winning quote. Stale and expired awards fail. Simultaneous award attempts yield one winner.                                       | [Award command](../../../apps/api/src/modules/enterprise/bidding.ts)                                                                                               | [Award checks](#postgresql-checks)              |
| v5 p. 524, `V5/VENDOR-BIDDING/A09`                                       | Converting a confirmed award requires a configured purchase cost code. The draft preserves its original quote and amount. Concurrent retries return the same purchase order.         | [Purchase order commands](../../../apps/api/src/modules/enterprise/purchasing.ts), [migration 0048](../../../apps/api/drizzle/0048_enterprise_purchase_orders.sql) | [Purchase order commitment](#postgresql-checks) |
| v5 pp. 444 and 524, `V5/PROJECT-FINANCE/A01` and `V5/VENDOR-BIDDING/A09` | Issuing a purchase order adds its total once. Committed cost is filterable by cost code with the source orders available for inspection.                                             | [Purchasing report](../../../apps/api/src/modules/enterprise/purchasing.ts), [Costing panel](../../../apps/web/src/features/enterprise/EnterprisePurchasing.tsx)   | [Purchase order commitment](#postgresql-checks) |

| v4 pp. 1217, 1220, 1401 and v5 p. 410, `V5/TAKEOFF/A01` | Import one or more exact project PDF revisions to a plan set with one persisted sheet per page, original dimensions and orientation. The earlier PDF version stays selectable after a new upload. | [Plan-set API](../../../apps/api/src/modules/enterprise/takeoffPlans.ts), [PDF page reader](../../../apps/api/src/services/plan-pdf.ts), [migration 0052](../../../apps/api/drizzle/0052_enterprise_takeoff_plans.sql) | [Takeoff checks](#takeoff-checks) |
| v4 pp. 1217, 1401 and v5 p. 410, `V5/TAKEOFF/A01` | Only users with estimate write access can import. The import checks the document's project, category and stored checksum. Matching requests return the same plan set. An unreadable PDF saves no sheets or plan set, including when the request also contains a valid PDF. | [Plan-set API](../../../apps/api/src/modules/enterprise/takeoffPlans.ts), [document verification](../../../apps/api/src/modules/enterprise/documentStorage.ts) | [Takeoff checks](#takeoff-checks) |

| v4 pp. 1217, 1401 and v5 p. 411, `V5/TAKEOFF/A02` | Open a persisted sheet at its exact private PDF revision, including when a newer revision exists. Show the revision label and render its drawing and page thumbnails. | [Takeoff sheet table](../../../apps/web/src/features/enterprise/EnterpriseTakeoff.tsx), [PDF viewer](../../../apps/web/src/features/enterprise/TakeoffPdfViewer.tsx) | [Sheet viewer checks](#sheet-viewer-checks) |
| v5 p. 411, `V5/TAKEOFF/A02` | Fit to view, zoom, rotate, scroll a zoomed drawing, and navigate thumbnails. Closing restores focus to the opening control. Zoom is restored on reopening. | [PDF viewer](../../../apps/web/src/features/enterprise/TakeoffPdfViewer.tsx), [responsive viewer layout](../../../apps/web/src/app/enterprise-suite.css) | [Sheet viewer checks](#sheet-viewer-checks) |

| v4 pp. 1217, 1220, 1401 and v5 p. 412, `V5/TAKEOFF/A03` | Compute and store an authorized sheet's scale from two distinct in-bounds points and a known length and unit. Reject zero-length, invalid unit, and cross-tenant requests. A 100-point reference at 10 ft gives 25 ft over 250 points. | [Calibration API](../../../apps/api/src/modules/enterprise/takeoffCalibration.ts), [Scale calculation](../../../packages/contracts/src/enterpriseTakeoffCalibration.ts), [migration 0053](../../../apps/api/drizzle/0053_enterprise_takeoff_calibration.sql) | [Calibration checks](#calibration-checks) |
| v5 p. 412, `V5/TAKEOFF/A03` | A second reference reports the difference between calculated and known length. Concurrent retries retain one calibration and recalibration keeps the prior revision. | [Calibration API](../../../apps/api/src/modules/enterprise/takeoffCalibration.ts), [Scale calculation](../../../packages/contracts/src/enterpriseTakeoffCalibration.ts) | [Calibration checks](#calibration-checks) |

| v5 p. 412, `V5/TAKEOFF/A03` | Capture two reference points on the PDF viewer, convert rotated and zoomed display positions to sheet coordinates, preview the scale and verification difference, and show the saved result after reopening the sheet. | [Calibration controls](../../../apps/web/src/features/enterprise/TakeoffCalibrationControls.tsx), [PDF viewer](../../../apps/web/src/features/enterprise/TakeoffPdfViewer.tsx) | [Calibration checks](#calibration-checks) |

### PostgreSQL checks

Ran `npm run test:integration -w @fieldline/api -- src/modules/enterprise/`. All 30 tests passed. Named tests in [operations.int.test.ts](../../../apps/api/src/modules/enterprise/operations.int.test.ts):

| Evidence                  | Test name                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review and exception      | `requires evidence and an exception for unmet scope, deduplicates reviews, and keeps reviewed quotes unchanged`                                                 |
| Award checks              | `compares actual quotes, checks stale and expired decisions, and freezes the award` and `commits only one winner across simultaneous exclusive award decisions` |
| Purchase order commitment | `converts an award once, issues against the reviewed revision, and posts committed cost once`                                                                   |

A local Chromium run also passed the responsiveness journey. It verified that a missing exception leaves entered evidence in the form, adding the exception displays the saved review and evidence, and recording the review leaves the package open for an explicit award.

### Takeoff checks

Ran `npm run test:integration -w @fieldline/api -- src/modules/enterprise/` against a fresh PostgreSQL/PostGIS database after integrating the Takeoff and upstream migrations. All 35 tests passed. Named tests in [operations.int.test.ts](../../../apps/api/src/modules/enterprise/operations.int.test.ts):

- `imports every PDF sheet from the selected vault revisions, preserves prior versions, and deduplicates imports`
- `rejects an unreadable plan PDF without saving a set or partial sheets`

Chromium also passed the plan-import workflow. It verified that a corrupt PDF leaves the form inputs in place, a retry displays all three sheets, and the source download returns the identical private PDF bytes.

### Migration verification

[Migration 0051](../../../apps/api/drizzle/0051_reconcile_supplypro_gm.sql) and the [restored journal](../../../apps/api/drizzle/meta/_journal.json) keep both earlier Enterprise migrations and add the SupplyPro schema at a timestamp that an existing database can apply. Locally ran `npm run db:migrate -w @fieldline/api -- --test` for two upgrade fixtures with checked row values.

- Upgrade from the earlier Enterprise journal preserved a pre-existing roofing job and backfilled its manual origin.
- Upgrade from the published SupplyPro journal preserved an existing commercial job's estimate origin and installed the bid-review, record-link, and Takeoff tables.

### Sheet viewer checks

Ran `npm run test:e2e -w @fieldline/web -- enterprise-takeoff.spec.ts --workers=1` with the local seeded development identity provider and production web build. The named test `opens a prior private plan revision, renders the selected sheet, and restores zoom` passed on desktop and mobile Chromium. It checks the prior revision label, nonblank drawing pixels, thumbnail navigation, viewport scrolling, rotation, focus return, and saved zoom. [enterprise-takeoff.spec.ts](../../../apps/web/e2e/enterprise-takeoff.spec.ts)

`E2E_ENTERPRISE_DEV=1` enables this test against the seeded local app. Set `E2E_BASE_URL` to that app's origin. `E2E_CHROMIUM_PATH` optionally points Playwright at an installed Chromium.

### Calibration checks

Ran `npm run test:integration -w @fieldline/api -- src/modules/enterprise/` against PostgreSQL after integrating the project playbook changes. All 37 tests passed. The test `maps a 100-point reference to 10 feet, verifies a 250-point check at 25 feet, and keeps scale history` checked permissions, validation, duplicate retries, and immutable revisions. [operations.int.test.ts](../../../apps/api/src/modules/enterprise/operations.int.test.ts)

The desktop and mobile Chromium runs both passed the `Capture and save a sheet calibration from two reference points` step. The test captured points on a rotated sheet, checked their normalized coordinates, verified a warning when the check length differed, saved the scale, and reopened the sheet. [enterprise-takeoff.spec.ts](../../../apps/web/e2e/enterprise-takeoff.spec.ts)

## Pending and blocked requirements already reviewed

| Source                              | Status  | Requirement and remaining work                                                                                                                                                                                                                                              |
| ----------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v4 p. 805, Appendix F               | Blocked | Produce a timestamped observation matrix for the four supplied reference videos. The workspace received HTTP 403 from the proxy for all four YouTube URLs. The attached material contains the PDFs. An accessible authorized recording or export would unblock observation. |
| v5 p. 410, `V5/TAKEOFF/A01`         | Pending | Add image and CAD import and background tile/render processing. PDF import reuses the Vault scanner and exposes its recorded result.                                                                                                                                        |
| v5 p. 411, `V5/TAKEOFF/A02`         | Pending | Add high-resolution tile rendering and processing state. The current viewer renders the authenticated PDF through a bounded browser canvas.                                                                                                                                 |
| v5 p. 412, `V5/TAKEOFF/A03`         | Pending | Flag measurements made with a previous calibration once persistent measurements exist.                                                                                                                                                                                      |
| v5 p. 521, `V5/VENDOR-BIDDING/A06`  | Pending | Add normalized scope and units, alternates, exclusions, explicit tax, and comparability warnings to the existing lump-sum comparison.                                                                                                                                       |
| v5 p. 523, `V5/VENDOR-BIDDING/A08`  | Pending | Add qualification, budget and approval references, final outcomes and authorized notifications. Pre-existing bid packages still support their original award path.                                                                                                          |
| v5 p. 524, `V5/VENDOR-BIDDING/A09`  | Pending | Support awarded line items and a saved delivery address reference. The current quote is a single lump sum and the order stores an explicit delivery-address snapshot.                                                                                                       |
| v5 p. 444, `V5/PROJECT-FINANCE/A01` | Pending | Implement the versioned budget baseline, as-of date, approved changes, actuals, accruals, forecasting, and their drilldowns.                                                                                                                                                |
| v5 p. 525, `V5/VENDOR-BIDDING/S01`  | Pending | Audit the complete screen contract once the remaining bid commands and workflows are implemented.                                                                                                                                                                           |

## Checkpoint

Last verified item is v5 p. 412, `V5/TAKEOFF/A03`, for versioned calibration, point capture on a rotated sheet, and a verification dimension.

Next step is v5 p. 413, `V5/TAKEOFF/A04`. Reuse the saved calibration and the viewer's sheet coordinates to draw and persist a polyline against a project measurement category. Prove a 3-4-5 segment yields 5 in calibrated units. Reject duplicate vertices and stale calibration IDs and show a review state on older measurements after recalibration. Record any remaining snap behavior separately.
