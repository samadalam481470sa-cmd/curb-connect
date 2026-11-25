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

| v4 p. 1217 and v5 p. 413, `V5/TAKEOFF/A04` | Compute and persist a polyline length from the current saved calibration and a project category. Keep the source sheet, vertices, calibration, and units. Reject zero-length segments, invalid coordinates, unauthorized writes, and stale scale references. | [Length API](../../../apps/api/src/modules/enterprise/takeoffLengths.ts), [Length calculation](../../../packages/contracts/src/enterpriseTakeoffLength.ts), [migration 0054](../../../apps/api/drizzle/0054_enterprise_takeoff_lengths.sql) | [Length checks](#length-checks) |
| v5 pp. 412–413, `V5/TAKEOFF/A03` and `V5/TAKEOFF/A04` | Flag previous length measurements for review after recalibration. Their stored vertices, calibration, and quantity remain available. | [Length API](../../../apps/api/src/modules/enterprise/takeoffLengths.ts) | [Length checks](#length-checks) |
| v5 p. 423, `V5/TAKEOFF/T01` | When direction constraint is enabled, snap a segment to a 45-degree increment within the sheet boundary. | [Direction calculation](../../../packages/contracts/src/enterpriseTakeoffLength.ts) | [Length checks](#length-checks) |

| v5 p. 413, `V5/TAKEOFF/A04` | Draw a polyline on a calibrated sheet, double-click to finish, preview its length, assign a category, and save the measurement. The saved length remains visible with a review notice after recalibration. | [Length controls](../../../apps/web/src/features/enterprise/TakeoffLengthControls.tsx), [PDF viewer](../../../apps/web/src/features/enterprise/TakeoffPdfViewer.tsx) | [Length checks](#length-checks) |

| v4 p. 1217 and v5 p. 414, `V5/TAKEOFF/A05` | Draw and close an exterior and deduction boundaries. Compute and save net area, exterior perimeter, and deduction perimeter from the active calibration. A 10 × 12 ft exterior with a 2 × 3 ft deduction gives 114 sq ft. | [Area API](../../../apps/api/src/modules/enterprise/takeoffAreas.ts), [Area controls](../../../apps/web/src/features/enterprise/TakeoffAreaControls.tsx), [migration 0055](../../../apps/api/drizzle/0055_enterprise_takeoff_areas.sql) | [Area checks](#area-checks) |
| v5 pp. 412 and 414, `V5/TAKEOFF/A03` and `V5/TAKEOFF/A05` | Reject self-crossing boundaries, deductions outside or touching the exterior, and overlapping or nested deductions. Retain the original quantity and flag the area after recalibration. | [Polygon computation](../../../packages/geometry/src/takeoffArea.ts), [Area API](../../../apps/api/src/modules/enterprise/takeoffAreas.ts) | [Area checks](#area-checks) |

| v5 p. 415, `V5/TAKEOFF/A06` | Save project-scoped count symbols and stable marker IDs on a sheet. Reject out-of-bounds points. Concurrent requests to remove the same marker decrement the count once and retain the original marker in history. | [Count API](../../../apps/api/src/modules/enterprise/takeoffCounts.ts), [migration 0057](../../../apps/api/drizzle/0057_enterprise_takeoff_counts.sql) | [Count checks](#count-checks) |
| v4 p. 1364, Shared Platform Controls 11 | Control-evidence packet export requires authentication, scopes evidence to the active company, and logs the export actor and packet digest. | [Control export API](../../../apps/api/src/modules/enterprise/controls.ts), [packet checksum](../../../apps/api/src/modules/enterprise/controlPacket.ts) | [Audit export check](#audit-export-check) |

| v5 p. 415, `V5/TAKEOFF/A06` | Place a selected symbol on the drawing, warn about nearby draft markers, undo a draft point, and remove a saved marker. Categories added in the length tool are available to counts immediately. | [Count controls](../../../apps/web/src/features/enterprise/TakeoffCountControls.tsx), [PDF viewer](../../../apps/web/src/features/enterprise/TakeoffPdfViewer.tsx), [shared categories](../../../apps/web/src/features/enterprise/TakeoffLengthControls.tsx) | [Count checks](#count-checks) |
| v5 p. 416, `V5/TAKEOFF/A07` | Tag a saved length, area, or count with project floor, room, material, phase, trade, and alternate references. Reject references outside the project and rooms that conflict with the selected floor. Repeating a tag assignment keeps the original record. | [Condition API](../../../apps/api/src/modules/enterprise/takeoffConditions.ts), [migration 0058](../../../apps/api/drizzle/0058_enterprise_takeoff_conditions.sql) | [Condition checks](#condition-checks) |
| v5 p. 416, `V5/TAKEOFF/A07` | Filter the measurement table by floor. Untagged measurements and measurements tagged only to another floor are excluded. | [Condition controls](../../../apps/web/src/features/enterprise/TakeoffConditionControls.tsx), [Condition API](../../../apps/api/src/modules/enterprise/takeoffConditions.ts) | [Condition checks](#condition-checks) |
| v4 pp. 1219 and 1227 | Submit an exact saved quantity for review. An authorized reviewer can approve it or request changes with a reason. Approval refuses a stale measurement or an incorrect or superseded calibration. A duplicate decision records a single audit entry with actor, reason, and before and after states. | [Review API](../../../apps/api/src/modules/enterprise/takeoffReviews.ts), [migration 0059](../../../apps/api/drizzle/0059_enterprise_takeoff_reviews.sql) | [Measurement review checks](#measurement-review-checks) |
| v4 pp. 1216 and 1219 | From a saved measurement, see any scale blocker, submit a reason, record a decision, and reopen the decision history. | [Review controls](../../../apps/web/src/features/enterprise/TakeoffMeasurementReview.tsx) | [Measurement review checks](#measurement-review-checks) |
| v5 p. 392, `V5/ESTIMATING/A01`, and v5 p. 404, `V5/ESTIMATING/S04` | Create a blank, project-scoped commercial estimate with a currency and quantity precision. Add typed lines and preserve their saved decimal quantities. Role and project checks apply to reading and writing the estimate. | [Estimate API](../../../apps/api/src/modules/enterprise/estimates.ts), [migration 0060](../../../apps/api/drizzle/0060_enterprise_estimate_drafts.sql) | [Estimate draft checks](#estimate-draft-checks) |
| v5 pp. 401 and 404, `V5/ESTIMATING/S01` and `V5/ESTIMATING/S04` | Navigate from Estimating to the selected project's estimate. Create a blank draft from that route, enter a line quantity, and reopen the approved revision with the exact quantity and approval reason. | [Estimating workspace](../../../apps/web/src/features/enterprise/EnterpriseEstimating.tsx), [project estimate route](../../../apps/web/src/app/(app)/enterprise/projects/%5BprojectId%5D/estimate/page.tsx) | [Estimate draft checks](#estimate-draft-checks) |

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

### Length checks

All 38 Enterprise integration tests passed with the lengths migration. The test `saves a calibrated 3-4-5 length once and flags its unchanged quantity after recalibration` covers tenant and category scope, duplicate requests, invalid vertices, a 5 ft result, and review status after recalibration. [operations.int.test.ts](../../../apps/api/src/modules/enterprise/operations.int.test.ts)

The targeted contracts run passed `adds each segment before applying the calibrated factor` and `snaps directions to 45-degree increments within the drawing boundary`. [enterpriseTakeoffLength.test.ts](../../../packages/contracts/src/enterpriseTakeoffLength.test.ts)

Both desktop and mobile Chromium passed the `Draw and save a calibrated polyline, then flag the earlier length after recalibration` step. It checks the drawn vertices, double-click to finish, a computed 5 ft length, category selection, persistence, and the review notice after changing the scale. [enterprise-takeoff.spec.ts](../../../apps/web/e2e/enterprise-takeoff.spec.ts)

### Area checks

All 39 Enterprise integration tests passed with the areas migration. The test `persists a calibrated 114 sq ft area with deductions and rejects invalid boundaries` verifies the exact quantity, stored boundaries, permissions, concurrent retry, and review status after recalibration. [operations.int.test.ts](../../../apps/api/src/modules/enterprise/operations.int.test.ts)

All three targeted geometry tests passed. They cover the exact net area and both perimeters, invalid boundaries, and a deduction that crosses a concave outline even though its vertices are inside. [takeoffArea.test.ts](../../../packages/geometry/src/takeoffArea.test.ts)

Desktop and mobile Chromium both passed the `Draw an area with a deduction and verify the net area and perimeters` step, including closing the shapes, rejecting an invalid deduction, saving, and reopening the area. [enterprise-takeoff.spec.ts](../../../apps/web/e2e/enterprise-takeoff.spec.ts)

### Count checks

All 41 Enterprise integration tests passed with the counts and control-compliance migrations on a fresh PostgreSQL/PostGIS database. The test `retains individual markers and decreases the count exactly once on concurrent removals` checked tenant scope, coordinate bounds, duplicate requests, revisions, and retained marker history. [operations.int.test.ts](../../../apps/api/src/modules/enterprise/operations.int.test.ts)

Desktop and mobile Chromium passed the `Count symbols, warn on a nearby marker, undo, and remove exactly one saved marker` step. It uses a category created in the length tool, verifies the warning and draft undo, and checks that the removed marker stays in history while only the active marker remains on the drawing. [enterprise-takeoff.spec.ts](../../../apps/web/e2e/enterprise-takeoff.spec.ts)

### Audit export check

The same PostgreSQL run passed `assigns owners, reviews attached evidence and exports a checksummed audit packet`. The test verifies rejection without authentication, absence of another company's evidence, and an audit row matching the export actor, module, and digest. [blueprint.int.test.ts](../../../apps/api/src/modules/enterprise/blueprint.int.test.ts)

### Condition checks

All 42 Enterprise integration tests passed. `groups only tagged measurements by floor and refuses a room in another project` verifies all six condition types, project and company isolation, matching room and floor, retry behavior, and the exact floor-filtered membership. [operations.int.test.ts](../../../apps/api/src/modules/enterprise/operations.int.test.ts)

Desktop and mobile Chromium passed the `Tag measurements by floor and room and show only the selected floor` step. It assigns a length and an area to different floors and checks that the untagged count disappears from both filtered views. [enterprise-takeoff.spec.ts](../../../apps/web/e2e/enterprise-takeoff.spec.ts)

### Measurement review checks

All 43 Enterprise integration tests passed. `locks a reviewed quantity to its measurement and scale, rejects stale or incorrect approval, and audits one decision` exercises estimator and reviewer permissions, tenant isolation, a 120 sq ft quantity, incorrect scale, recalibration, count changes, concurrent retry, and retained review history. [operations.int.test.ts](../../../apps/api/src/modules/enterprise/operations.int.test.ts)

Desktop and mobile Chromium passed the `Keep scale warnings visible and sign off the exact saved count` step. It displays an incorrect-scale warning on an area and verifies the submitted and approved states and the saved decision reason for a count. [enterprise-takeoff.spec.ts](../../../apps/web/e2e/enterprise-takeoff.spec.ts)

### Estimate draft checks

All 44 Enterprise integration tests passed. `creates a scoped blank estimate, keeps decimal line quantities, and freezes the approved revision` verifies company and project isolation, estimator and reviewer permissions, concurrent creation retries, decimal line storage, stale writes, audit, and rejection of new lines after approval. [operations.int.test.ts](../../../apps/api/src/modules/enterprise/operations.int.test.ts)

Desktop and mobile Chromium both passed `creates a blank commercial estimate and preserves approved quantities on the project route`. It creates a CAD draft at four decimal places, adds a typed line and manual quantity, approves it, and reloads the route to verify the quantity and approval reason. [enterprise-estimates.spec.ts](../../../apps/web/e2e/enterprise-estimates.spec.ts)

## Pending and blocked requirements already reviewed

| Source                                                    | Status  | Requirement and remaining work                                                                                                                                                                                                                                              |
| --------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v4 p. 805, Appendix F                                     | Blocked | Produce a timestamped observation matrix for the four supplied reference videos. The workspace received HTTP 403 from the proxy for all four YouTube URLs. The attached material contains the PDFs. An accessible authorized recording or export would unblock observation. |
| v5 p. 410, `V5/TAKEOFF/A01`                               | Pending | Add image and CAD import and background tile/render processing. PDF import reuses the Vault scanner and exposes its recorded result.                                                                                                                                        |
| v5 p. 411, `V5/TAKEOFF/A02`                               | Pending | Add high-resolution tile rendering and processing state. The current viewer renders the authenticated PDF through a bounded browser canvas.                                                                                                                                 |
| v5 p. 412, `V5/TAKEOFF/A03`                               | Pending | Extend the previous-calibration review state to additional measurement types when they are implemented.                                                                                                                                                                     |
| v5 pp. 413 and 423, `V5/TAKEOFF/A04` and `V5/TAKEOFF/T01` | Pending | Snap to detected drawing lines and endpoints with the specified tolerance and indicator.                                                                                                                                                                                    |
| v5 p. 417, `V5/TAKEOFF/A08`, and v5 p. 395, `V5/ESTIMATING/A04` | Pending | Preview compatible unit conversions and transfer approved quantities once while protecting manually entered quantities. Exact measurement review and the commercial draft target are verified. |
| v5 p. 392, `V5/ESTIMATING/A01` | Pending | Add creation from an approved template, sales opportunity links, and pinned catalog and labor assumptions. The blank project draft is verified. |
| v5 p. 399, `V5/ESTIMATING/A08` | Pending | Create a new draft from an existing revision, retain the original, and compare revisions line by line. The draft workspace already freezes an approved quantity revision. |
| v4 p. 1222 and v5 p. 424, `V5/TAKEOFF/T02` | Pending | Publish takeoff workflow events with delivery history and add the lead approval gate for changing a locked scale. Recalibration already makes an earlier measurement ineligible for approval. |
| v5 p. 521, `V5/VENDOR-BIDDING/A06`                        | Pending | Add normalized scope and units, alternates, exclusions, explicit tax, and comparability warnings to the existing lump-sum comparison.                                                                                                                                       |
| v5 p. 523, `V5/VENDOR-BIDDING/A08`                        | Pending | Add qualification, budget and approval references, final outcomes and authorized notifications. Pre-existing bid packages still support their original award path.                                                                                                          |
| v5 p. 524, `V5/VENDOR-BIDDING/A09`                        | Pending | Support awarded line items and a saved delivery address reference. The current quote is a single lump sum and the order stores an explicit delivery-address snapshot.                                                                                                       |
| v5 p. 444, `V5/PROJECT-FINANCE/A01`                       | Pending | Implement the versioned budget baseline, as-of date, approved changes, actuals, accruals, forecasting, and their drilldowns.                                                                                                                                                |
| v5 p. 525, `V5/VENDOR-BIDDING/S01`                        | Pending | Audit the complete screen contract once the remaining bid commands and workflows are implemented.                                                                                                                                                                           |

## Checkpoint

Last verified item is blank commercial estimate creation under v5 pp. 392 and 404. Draft lines preserve decimal quantities and an approved quantity revision refuses new lines.

Next step is to add the takeoff transfer preview and confirmation commands for v5 pp. 395 and 417. Select an approved, current measurement review and map it to a draft line. Use exact decimal conversion to show 120 sq ft as 13.333… sq yd before the configured rounding. Verify that repeating a confirmation keeps one source record, that existing quantities require explicit replacement, and that approved revisions and incompatible units refuse changes.
