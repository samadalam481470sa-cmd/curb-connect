# Blueprint gaps build (2026-11-26)

Seven full-stack stacks from the Hyphen Competitive Development Blueprint,
built on top of what already existed in Field Pro (extended, not duplicated).
Everything is additive. Gated items stay gated: no live payments, no live
QuickBooks sync, no email sends (mailer not connected), no native push
delivery. Numbers are contractor-entered or derived from entered values —
never invented.

Migrations: `0093_schedule_critical_path`, `0094_progress_billing`,
`0095_general_ledger`, `0096_three_way_match`, `0097_concrete_dispatch`,
`0098_trade_finder`, `0099_requisitions_backorders` (journal idx 93–99).
New API modules: `progressBilling`, `gl`, `threeWayMatch`, `concrete`,
`tradeFinder`, `requisitions` (module count 68 → 74). New POLICY actions:
`gl:read/write/post/manage`, `concrete:read/write`, `vendor:read/write`,
`requisition:read/write/approve`. New platform operation:
`trade_finder.search` (read-only published directory profiles of opted-in
companies).

## 1. Critical-path scheduling

Extends the existing PM schedule (`scheduleTasks`, single finish-to-start
predecessor) instead of replacing it.

- `apps/api/src/modules/projectManagement/criticalPath.ts` — pure CPM:
  forward/backward pass, total float per task, critical flag, cycle
  detection (Kahn topo sort; cycles return an honest error naming the
  involved tasks), `simulateMove` (non-persisting reschedule impact),
  `compareToBaseline`. Entered start dates act as floors — CPM never pulls a
  task earlier than entered. Legacy `predecessorTaskId` links are honored as
  lag-0 dependencies; new links live in `schedule_dependencies` with lag.
  13 unit tests.
- `schedule_baselines` / `schedule_baseline_tasks` — named snapshots of the
  current task dates; compare shows on-plan / slipped / ahead / added /
  removed per task.
- API (`criticalPathRoutes.ts`, registered in the PM module):
  `GET /pm/jobs/:jobId/schedule/critical-path`,
  `POST .../simulate-move`, `POST/DELETE .../dependencies` (cycle-creating
  links rejected before persisting), `POST/GET .../baselines`,
  `GET .../baselines/:id/compare`. Permissions: `schedule:read/write`.
- Web: `CriticalPathPanel` under the Gantt in Project Management; critical
  bars tinted orange in the Gantt. Dates labeled as entered dates / estimates.

## 2. Progress billing / AR

- `schedules_of_values` + `sov_lines` per job (contract sum + entered
  retainage %; lines-vs-contract mismatch shown honestly).
- `progress_billing_applications` + lines: draft → submitted →
  approved/rejected → invoiced. Percent complete and stored materials are
  entered per line; `calc.ts` computes completed-to-date, this period,
  retainage withheld, current due, balance to finish (7 unit tests).
  Overbilling a line blocks submit/approve. Approval freezes the totals.
- Invoice generation creates a **draft** customer invoice (kind `progress`)
  with one line per SOV line billed this period plus a negative retainage
  line; issuing/sending stays in the existing invoices flow.
- AR aging from issued/partially-paid invoices (current / 1–30 / 31–60 /
  61–90 / 90+ / no due date).
- PDF: `progress_billing` template in `@fieldline/pdf` — a generic progress
  billing application, explicitly **not** an AIA form (stated on its face).
- Permissions reuse `draw:read/write/approve`; invoice generation uses
  `invoice:write`. Web: `/progress-billing` (Finance → Money In).

## 3. GL reporting

Audit finding: the existing `ledger_entries` book is the **payments
settlement ledger** (7 fixed enum accounts, issuer-side). The GL is a
separate, owner-posted book; settlement entries are **not** auto-posted into
it, because the payer-side accounting treatment is an owner/accountant
decision. The UI and this doc say so plainly.

- `gl_accounts` (asset/liability/equity/income/expense, normal balance),
  seeded starting template (22 construction accounts) flagged
  `is_template` and labeled "starting point, not accounting advice".
- `gl_journal_entries` + lines: drafts may be unbalanced; **posting enforces
  balanced debits/credits**. Posted entries are immutable (no edit/delete
  endpoints) — corrections are reversing entries (`source='reversal'`).
- `gl_periods`: posting into a closed period is rejected.
- Reports from **posted lines only** (`reports.ts`, 9 unit tests): trial
  balance with an honest balanced check, balance sheet (assets vs
  liabilities + equity + current earnings, difference shown), P&L.
- Web: `/general-ledger` (Finance → Reporting).

## 4. Three-way match

- Receiving (didn't exist): `po_receipts` + `po_receipt_lines` against
  supplier orders (PO lines are `supplier_orders.lines` jsonb, by index) —
  full/partial with shortage/damage condition + notes.
- `ap_invoice_matches`: one per AP invoice — linked PO + invoice-side
  figures entered from the supplier's invoice (billed qty/unit price per
  line, tax, freight, vendor, cost code). `match.ts` computes matched /
  price_variance / quantity_variance / unmatched (11 unit tests). Anything
  unverifiable (e.g. PO line without a price) is `unmatched`, never assumed.
- Variance routing: `POST .../decide` (approve/reject with a required
  reason). **Gate:** in the existing AP decide handler (`jobCost`), when a
  match record exists, approve/record-payment is blocked until the invoice
  is matched or the variance approved. Invoices with no match record keep
  the existing flow unchanged (additive; e.g. service invoices without POs).
- Duplicate detection: same vendor + invoice number + amount, surfaced on
  the match record.
- Web: `/three-way-match` (Finance → Money Out).

## 5. Concrete dispatch

- `concrete_mix_designs`: contractor-entered name/strength/slump/aggregate/
  admixtures/price per yard.
- `concrete_orders`: job, pour location, volume, date + window, pump flag,
  contact, plant (entered), truck (from `fleet_assets`), driver (entered),
  ETA (entered — **no GPS provider; nothing fakes live tracking**).
- `concrete_loads`: per-load tickets (truck, batch time, yards
  loaded/delivered/returned, ticket number, photo refs via the existing
  refs pattern, typed-name signature attestation).
- Status flow `scheduled → batched → en_route → on_site → pouring →
  complete` (cancel only before en_route), enforced server-side
  (`flow.ts`, 6 unit tests).
- Invoice handoff: delivered yards on completed loads × entered price →
  draft invoice (kind `standalone`), never auto-sent. No entered price →
  honest error, never invented.
- Web: `/concrete-dispatch` (Operations → Orders & Bids) with dispatch
  board by day.

## 6. Trade Finder

- `directory_profiles` (one per org): published trades, service
  cities/ZIPs, availability, license/insurance expiry. Read cross-tenant
  **only** for `directory_opt_in` companies via the named platform operation
  `trade_finder.search` — published data only.
- `vendor_profiles`: the org's own private vendor records with the same
  qualification fields (no public vendors table existed). Tenant-scoped.
- Search filters: trade, city, ZIP exact or 3-digit sectional area
  (labeled approximate — not a true radius; no geocoding of entered areas),
  availability, "qualified only" (license + insurance on file and
  unexpired; expiry status computed from entered dates, `search.ts`,
  10 unit tests).
- "Request connection" reuses `POST /network/connections`.
- Web: `/trade-finder` (Operations → Orders & Bids).

## 7. Requisitions + backorders

- `purchase_requisitions`: job, cost code, items (same shape as PO lines),
  needed-by, requester; draft → submitted → approved/rejected → converted.
  Conversion creates **one** draft supplier order (`origin='requisition'`);
  `converted_order_id` is unique per org and re-converting returns the
  existing order (idempotent — never two POs).
- `po_line_backorders`: entered expected date/note per PO line. Backordered
  quantity is derived (ordered − received from `po_receipts`), never stored
  stale. Aging view: open lines with age in days and overdue flags vs the
  entered expected date (`logic.ts`, 7 unit tests).
- Web: `/requisitions` (Operations → Orders & Bids).

## Honest limits / unverified

- No browser available during the build: no visual verification. Verified by
  lint, typecheck (0 TS errors per workspace), and unit tests only.
- Migrations were hand-written and journal-checked but **not applied against
  a real database** in this environment (no local Postgres); they run on the
  next Render API deploy.
- Endpoints were not exercised against a deployed API.
- Progress-billing SOV lines cannot be edited once applications exist (by
  design — create a new SOV).
- Three-way match gates AP approval only when a match record exists (see
  above); AP invoices without a PO still use the existing approval path.
- GL does not include settlement-ledger activity (see §3).
- Trade Finder ZIP "area" is a 3-digit approximation, not a radius.
- Concrete ETA/status are manual; load-ticket photos use the existing
  reference pattern (upload flow unchanged).
