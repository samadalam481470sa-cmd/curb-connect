# Audit gaps — round 2

Ten remaining items from the all-videos audit, built in order on top of main
`326cf1d` (Renditions capture framework) and rebased onto `0ec7741`
(Enterprise sales) before handoff. Additive only; nothing removed.
Migrations `0106`–`0108` (renumbered after the Enterprise sales migrations 0101–0105 landed mid-build), each with a journal entry (journal now 109 entries,
idx 0–108). No new permissions, modules, or web routes: every item extends an
existing module or screen.

## 1. Follow-up persistence

The roofing-agents follow-up queue state (snoozes, completions, cadence
overrides) and Front Desk inspection bookings were in-memory and reset on
every restart. Both now sit in database tables behind the same endpoints:

- `follow_up_overrides` (per-item manual state keyed by the stable queue id)
  and `roof_inspections` (bookings; job-linked bookings still mirror to the
  `schedules` crew calendar) — migration `0110_follow_up_inspection_persistence`.
- Store interfaces are orgId-first with DB implementations (drizzle,
  tenant-scoped) and resilient DB→memory fallback, so endpoints keep working
  before the migration is applied. Endpoint shapes are unchanged.
- The voice front desk keeps its memory default: its webhook runs without a
  tenant transaction (`auth: 'none'`), so DB wiring there still waits for the
  telephony provider work. Documented in code, unchanged behavior.

## 2. Trade-timing depth (finish-outs)

`POST /v1/permit-leads/finish-outs` now also returns `tradeTiming`, computed
from observed permit sequences in the scan itself:

- Permits are grouped by normalized address; for each finish-out parent
  permit, the lag to the first later same-trade permit is recorded.
- Per-trade windows (median/min/max days) are reported only with at least 5
  observed samples (`MIN_OBSERVED_SAMPLES`); below that the basis is
  `insufficient_data` and every number is null with the real sample count
  stated. Nothing is estimated into existence.
- The Finish-outs view shows a "Trade timing — observed permit sequences"
  panel with per-trade Observed/Insufficient-data rows, sample counts, and
  the address sequences behind them. Caveats travel with the response.

## 3. Roof-age packaging

Roof-age leads are now packaged by age band with source labels:

- Bands `under_10 / 10_14 / 15_19 / 20_24 / 25_29 / 30_plus`, every label
  suffixed "(permit age)". Each lead carries `ageBand`, `ageBandLabel`, and
  `ageBasis` naming the source and permit date the age was derived from —
  "not a damage, condition or remaining-life claim".
- Dateless roofing permits count as **age unknown, never estimated**;
  properties with no roofing permit in the scan stay unlisted (no invented
  unknown-age list).
- `POST /permit-leads/roof-age-export` (permission `export:create`) returns a
  ranked CSV including Age band and Age basis columns. The Roof-Age view
  renders band-grouped tables (oldest first) with a download button.

## 4. Pool Radar daily list

`POST /v1/permit-leads/pool-radar` now returns `dailyList` for the current
Texas date: permits dated today, leads whose follow-up window opens today
(day 21), and leads whose window starts closing today (day 36) — fence-filed
leads excluded. The response note states honestly that permits are fetched
live, so "new today" means the city dated it today; Field Pro stores nothing
between scans. The Pool Radar view shows the three lists with an in-view
**Add to funnel** action (creates the funnel stage row, in-app only — no
email, no push claims).

## 5. Plan-to-Bid trade sidebar + labor rate book

- **Trade totals** section in Plan-to-Bid: per-trade material subtotals
  (approved priced lines), labor, subcontractor, and trade total (held while
  any approved line in the trade is unpriced) — pure helper
  `computeTradeTotals`, unit-tested.
- **Labor rate book**: contractor-entered hourly rates per trade, stored per
  organization (`labor_rates`, migration `0111_labor_rates`, integer cents
  per hour, unique per org+trade+label). API: `GET/POST /plan-to-bid/labor-rates`,
  `PATCH/DELETE /plan-to-bid/labor-rates/:id` (`estimate:read`/`estimate:write`).
  A saved rate reaches a bid only when the contractor picks it in the trade's
  labor section. There are no default rates — an empty book is an honest
  empty state.

## 6. Commercial-pad parcel mode

A commercial-pad case in Land Feasibility (`commercialPad.ts`, pure math):
pad dimensions, building size, and contractor-entered coverage / parking /
open-space ratios → pad area, coverage cap and check, parking spaces and
area, developed-vs-pad fit check, then the shared underwriting (peak equity
= all-in cost, labeled, since pad mode has no monthly cash flow). Every
ratio is contractor-entered from the code that applies to their parcel —
Field Pro has no zoning or parking-code source and checks none. Blank inputs
yield nulls and a plain note.

## 7. Feasibility audit-status panel

A "Feasibility audit status" card in Land Feasibility listing every input
and factor with its real status — verified (live source named: USGS terrain,
FEMA flood, USGS NHD streams with checked date), estimated (slope/grading,
layout, underwriting), contractor-entered (zoning, prices, costs with
source-note counts, sewer depth, decision classes), or missing/no source
(flood/streams not pulled, comparable sales, sewer depth not entered). Rows
are derived from the same run state the sections read (`auditStatus.ts`), so
the panel cannot claim a source that did not answer.

## 8. Carrollton ingester

Carrollton publishes no permit API; it posts a monthly PDF report. Verified
live 2026-11-27: `previous_month.pdf` is the report dated 2026-11-01
(110 pages) covering October 2026 permits, with Date Entered, Permit Number,
Permit Type, Property Address, Job Description, Applicant, Valuation,
Status, and Date Issued.

- New source `carrollton` in `sources.ts`: fetches the fixed official PDF,
  extracts the text layer (`extractPdfText` with report-sized limits), and
  parses records anchored on permit numbers (`PR` + 2 letters + 9 digits),
  matching detail blocks (valuation/status/issued/applicant) back to records
  by street address, skipping duplicate header rows (CADID-marked) and
  cutting blocks at the next record's address. Deduped on permit number;
  future-dated rows dropped.
- The applicant is carried in the description ("Applicant: …"), never as a
  hired contractor. Coverage month is derived from the report date
  (previous calendar month).
- Freshness: 45-day cadence with the note "Monthly PDF report covering the
  previous month — leads are ~4–5 weeks old." Search and the daily refresh
  pick it up like Houston. Public file only — no login, no scraping beyond
  fetching the published PDF.
- Caveat: the parser is verified against a fixture built from the
  live-fetched report text plus an end-to-end generated-PDF test; it has not
  been run against the real 110-page PDF bytes from the server (no local
  download path in the build environment).

## 9. Irving historical layer

Irving's two open-data permit tables (residential + commercial, ArcGIS
FeatureServer on services3.arcgis.com) still answer but stopped updating in
March 2025. Verified live 2026-11-27: both report `lastEditDate`
2025-03-12; newest permit 2025-02-28.

- New source `irving` (both tables merged, deduped on permit number),
  wired like Denton: newest-first paging with client-side window filtering.
  The tables publish no contractor — that field stays empty.
- Labeled historical everywhere: source name, source note ("Historical —
  feed stopped March 2025"), freshness cadence note, and the ArcGIS
  last-edit date in the freshness panel. The 14-day cadence keeps it
  permanently stale — it is never presented as a live feed.
- The funnel explicitly skips `irving` permits: historical permits are never
  call leads, even in wide age windows (tested).

## 10. Time-saved auto-logging

Agent activity rows used to record `minutesSaved: null` everywhere, so
"hours saved" was permanently "not measured yet". Now:

- `agent_time_baselines` (migration `0112_agent_time_baselines`): the
  contractor's minutes-saved per task type, per organization. Task types
  are the real logged actions: `follow_up_completed`, `follow_up_snoozed`,
  `inspection_booked`, `inspection_confirmed`, `inspection_completed`,
  `inspection_cancelled`.
- When an agent action completes (follow-up complete/snooze, inspection
  booked/status change, or a POST to `/roof-agents/activity` without a
  duration), the activity row is auto-filled from the contractor's saved
  baseline. No saved baseline → the row stays unmeasured (null), never a
  template guess.
- The starting template (e.g. inspection booked = 15 min) is labeled
  "Starting estimate — edit to your numbers", the same pattern as the GL
  chart template. `POST /roof-agents/time-baselines/apply-template` adopts
  it for task types not yet set (saved numbers are kept). API:
  `GET /roof-agents/time-baselines`, `PUT /roof-agents/time-baselines/:taskType`.
- The Agent hours panel (roofing dashboard) gains a baselines editor and
  reads the auto-logged entries through the existing totals endpoint. The
  totals note now states hours come from saved baselines applied to logged
  actions.

## Verification

- `npm run lint`, `npm run typecheck`, `npm run test:unit` — see the build
  report for exact counts. Known flake: `invoiceIntel/chunked.test.ts`
  under parallel load (passes alone).
- Migrations 0106–0108 are hand-written with journal entries; they have not
  been applied to a real database in the build environment (no local
  Postgres). One Render API deploy runs them in order.
- No browser/visual verification was run for the new panels (Finish-outs
  timing, Roof-Age bands, Pool daily list, Plan-to-Bid trade totals + rate
  book, commercial pad, audit status, time baselines).
