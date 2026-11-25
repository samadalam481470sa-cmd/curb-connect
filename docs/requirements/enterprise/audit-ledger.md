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

### PostgreSQL checks

Ran `npm run test:integration -w @fieldline/api -- src/modules/enterprise/`. All 30 tests passed. Named tests in [operations.int.test.ts](../../../apps/api/src/modules/enterprise/operations.int.test.ts):

| Evidence                  | Test name                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review and exception      | `requires evidence and an exception for unmet scope, deduplicates reviews, and keeps reviewed quotes unchanged`                                                 |
| Award checks              | `compares actual quotes, checks stale and expired decisions, and freezes the award` and `commits only one winner across simultaneous exclusive award decisions` |
| Purchase order commitment | `converts an award once, issues against the reviewed revision, and posts committed cost once`                                                                   |

A local Chromium run also passed the responsiveness journey. It verified that a missing exception leaves entered evidence in the form, adding the exception displays the saved review and evidence, and recording the review leaves the package open for an explicit award.

## Pending and blocked requirements already reviewed

| Source                              | Status  | Requirement and remaining work                                                                                                                                                                                                                                              |
| ----------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v4 p. 805, Appendix F               | Blocked | Produce a timestamped observation matrix for the four supplied reference videos. The workspace received HTTP 403 from the proxy for all four YouTube URLs. The attached material contains the PDFs. An accessible authorized recording or export would unblock observation. |
| v5 p. 521, `V5/VENDOR-BIDDING/A06`  | Pending | Add normalized scope and units, alternates, exclusions, explicit tax, and comparability warnings to the existing lump-sum comparison.                                                                                                                                       |
| v5 p. 523, `V5/VENDOR-BIDDING/A08`  | Pending | Add qualification, budget and approval references, final outcomes and authorized notifications. Pre-existing bid packages still support their original award path.                                                                                                          |
| v5 p. 524, `V5/VENDOR-BIDDING/A09`  | Pending | Support awarded line items and a saved delivery address reference. The current quote is a single lump sum and the order stores an explicit delivery-address snapshot.                                                                                                       |
| v5 p. 444, `V5/PROJECT-FINANCE/A01` | Pending | Implement the versioned budget baseline, as-of date, approved changes, actuals, accruals, forecasting, and their drilldowns.                                                                                                                                                |
| v5 p. 525, `V5/VENDOR-BIDDING/S01`  | Pending | Audit the complete screen contract once the remaining bid commands and workflows are implemented.                                                                                                                                                                           |

## Checkpoint

Last verified item is the one-winner concurrency acceptance test on v5 p. 523, with the v5 p. 522 responsiveness checks in the same PostgreSQL run.

Next step is v5 p. 410, `V5/TAKEOFF/A01`. Use the private Enterprise Document Vault's existing versioned plan PDF storage, inspect an exact tenant-scoped PDF version using the installed PDF.js library, and persist each PDF page as a distinct sheet. Add a PostgreSQL test that imports a three-page PDF, rejects a corrupt PDF without creating any sheets, and refuses an import by a user outside the project company.
