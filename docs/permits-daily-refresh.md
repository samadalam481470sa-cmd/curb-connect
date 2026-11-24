# Permit feeds: daily refresh

Permit Job Search reads live city feeds on every search, but a feed can stop publishing
without warning — Denton's ArcGIS feed, for example, has not published a new permit since
2026-01-06 yet still answers queries. This page documents how Field Pro catches that
automatically, once a day, without anyone clicking search.

## What runs daily

A graphile-worker job, `permit_sources_refresh`, re-fetches every live source for the last
30 days and stores one row per source in `permit_source_statuses` (migration 0033):

- **Schedule:** `0 12 * * *` in `apps/api/src/jobs/permitSources.ts` — 12:00 UTC, which is
  6:00 am CST (7:00 am during daylight time). Same crontab pattern as the existing
  `permit_watch_morning` job (6:10 am).
- **On start:** `permit_sources_refresh_on_start` is queued every time the worker starts or
  wakes up and runs the refresh only when the stored check is more than 24 hours old, so a
  sleeping free Render instance backfills instead of showing a stale panel.
- **No paid service:** the worker already runs inside the API instance on Render
  (`WORKER_INLINE=true` in `render.yaml`; `apps/api/scripts/render-start.mjs` starts
  `dist/worker.js` next to the API). No new service, no new dependency.
- **Idempotent:** the store upserts by `source_id`, so a crash-and-retry or a second daily
  run updates the same 8 rows instead of duplicating them. A single source failing never
  stops the others; its row keeps its previous newest permit date and is marked
  `unavailable` with the error.

## What is stored per source

`apps/api/src/modules/permitLeads/freshness.ts` computes, from the last 30 days of permits:

- `status`: `live` (newest permit inside the cadence), `stale` (newest permit past it —
  14 days for the daily feeds and for Houston, 45 days for Dallas, which publishes on the
  city's own schedule), or `unavailable` (no permits returned, or the fetch failed).
  Houston is a weekly Excel file, so a newest permit up to ~10 days old is normal; the
  14-day window covers one missed week, and the stored message says so.
- `newest_permit_date`, `count_30d`, and `field_health`: the share of permits naming a
  contractor, listing a value above zero, and carrying a zip code. Dallas 2026 is the live
  example: counts are fine, but contractor and value are present on only a few percent of
  permits, so the stored message says so instead of ranking on missing fields.
- `source_updated_at`: the last edit date the city's own ArcGIS service reports (Fort
  Worth, Denton, Arlington only), when it can be read.
- `last_checked_at` and a plain-language `message`.

## Where it shows

- **Permit Job Search → Feed freshness:** `GET /v1/permit-leads/sources/status`
  (`apps/api/src/modules/permitLeads/index.ts`, permission `job:read`) returns the stored
  rows. Before the first refresh has run it returns `unknown` rows with an honest
  "not checked yet" message instead of failing the page.
- **Search results:** each feed in a search response now carries `freshness` and
  `fieldHealth`, and a feed whose newest permit is past its window is reported `stale`
  instead of `ok` (see `apps/api/src/modules/permitLeads/search.ts`).

## How to verify it ran

1. Open Permit Job Search and read the **Feed freshness** panel: every source should show
   a "Last daily check" within the last day.
2. Or query the endpoint directly (signed in, any company):
   `GET /v1/permit-leads/sources/status` — `checkedAt` is the newest `lastCheckedAt`.
3. Or in the database:
   `SELECT source_id, status, newest_permit_date, count_30d, last_checked_at FROM permit_source_statuses ORDER BY source_id;`
4. Worker logs print one line per source on every run:
   `[permit-sources] fortworth: live — newest 2026-11-23, 731 in 30d, checked …`

## Live verification (2026-11-23)

| Source | Newest permit | Verdict |
| --- | --- | --- |
| Fort Worth ArcGIS | 2026-11-23 | Live; value on ~7% of permits (city publishes no value on most) |
| Denton ArcGIS | 2026-01-05 applied / 2026-03-14 issued | **Stale** — feed last edited 2026-01-06, no permits since |
| Collin Socrata `82ee-gbj5` | 2026-11-23 | Live; 52 future-dated rows (incl. year 2206) are dropped by the normalizer |
| Dallas Socrata `e7gq-4sah` | Nov 2026 (4,233 permits) | Live counts, **field collapse**: contractor 1–5%, value 0–3% all through 2026 |
| Arlington ArcGIS | 2026-11-20 | Live; 463 issued in 30 days |
| San Antonio CKAN | 2026-11-20 | Live |
| Austin Socrata `3syk-w9eu` | 2026-11-21 | Live; contractor 100%, value ~20% |
| Houston weekly Excel | 2026-11-22 (file Nov 16-22, 385 permits) | Live; weekly file, newest normally up to a week old; no contractor or value published |

## Houston: weekly Excel ingester

Houston publishes no per-permit API. The Houston Permitting Center posts one workbook per
week on its public Sold Permits Search page
(`https://www.houstonpermittingcenter.org/sold-permits-search`); the file names follow no
stable pattern, so the ingester (`apps/api/src/modules/permitLeads/sources.ts`,
`discoverHoustonReportFiles`) reads that public index page, takes the direct links to the
city's own file host (never the Office viewer links), sorts them by the week-end date in
the filename, and fetches the newest few until the 30-day window is covered (at most five
files). The parser (`parseHoustonWorkbook`, built on the already-present `fflate`
dependency — no new dependency) reads real `.xlsx` workbooks and the HTML tables the city
sometimes saves with an `.xls` extension. Columns are matched by header text
(Zip Code, Permit Date, Permit Type, Project No, Address, Comments); rows dedupe on
project number + permit type and future-dated rows are dropped, like Collin. Verified live
2026-11-23: newest file `Nov 16-22.xlsx` (35,786 bytes) covers 2026-11-16→2026-11-22,
385 data rows, all with project number / zip / address, types Building Pmt 341 /
Demolition 38 / OCC-BLDG PMT 6. Note: the Planning Department page that used to link
these reports stopped doing so on 2025-12-01 — the Permitting Center page is the current
source. The refresh job includes Houston through the shared `fetchers` map, and the
freshness panel shows the weekly-cadence note.

Still blocked (no queryable public source, no scraping): Garland (ArcGIS Hub has no permit
dataset), Grand Prairie (Hub is private / no public API), Carrollton (CityServe portal
only, Hub private), Irving (ArcGIS layers exist but frozen at 2025-02-28 newest issue).
These stay listed under "Cities without a live feed yet" with official links.
