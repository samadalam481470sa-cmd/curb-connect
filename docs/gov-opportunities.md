# Gov Opportunities

The finder that finds .gov listing opportunities FOR the contractor and tells them — the
contractor does no researching. From the @many.talks.biz reel (DgIMBzhx90H): dead links on
government "helpful links" pages, a free SAM.gov profile, and the Texas CMBL supplier portal.

## What already existed vs what's new

| Piece | Already in Field Pro | New here |
| --- | --- | --- |
| SAM.gov | `externalBids` searches federal **opportunities** (`GET /bidding/external/search`, source `sam`, gated on the existing `SAM_GOV_API_KEY`) | Listing **presence** check: `GET /v1/gov-opportunities` calls the SAM.gov Entity Management API by company name and reports `listed` / `not_listed` / `requires_setup` / `unknown`. Same key, no new key. |
| CMBL | Nothing | Always an honest "check manually" item: the CMBL search is a legacy form with no public API, so Field Pro never claims a result. It gives the exact search URL (`mycpa.cpa.state.tx.us/tpasscmblsearch/tpasscmblsearch.do`, verified live 2026-11-24) and the steps from the Comptroller's own FAQ. |
| Dead-link scanning | Permit-source freshness module (`permitLeads/freshness.ts`, daily job, stored rows, status endpoint) — reused as the pattern, not the code | New scanner (`govOpportunities/scanner.ts`): fetches 5 seed .gov resource pages, extracts outbound links, HEAD-then-GET checks each, stores one row per (page, link) in `gov_link_checks` (migration 0034). |
| Daily refresh | `permit_sources_refresh` job at 06:00 CST + on-start backfill | New `gov_opportunities_refresh` job, same 06:00 CST cadence, same on-start backfill, same idempotent upsert pattern. |
| "Tells them" | Permit Job Search freshness panel | New `/gov-opportunities` view (primary nav) + a link card in Permit Job Search. Plain-language cards: what it is, why it matters, the exact dead link, the exact page. Last-checked time on every card. |
| Outreach draft | Qwen AI hook (`HOME_AI_BASE_URL`, used by invoice AI / Ask Field Pro / Land Scout) | Optional `POST /gov-opportunities/draft` reuses the hook. No AI configured → honest `dependency_unavailable`, never a faked draft. |
| Email alerts | Not connected | Deliberately not built: the UI says email alerts are off until email is connected. Nothing sends email. |

## Seed pages (all verified to load 2026-11-24)

- Texas Comptroller — CMBL info (`comptroller.texas.gov/purchasing/vendor/cmbl/`)
- City of Fort Worth — Economic Development (`fortworthtexas.gov/departments/econdev`)
- City of Dallas — Business Enterprise Hub (`dallascityhall.com/.../Business-Enterprise-Hub.aspx`)
- City of San Antonio — Economic Development, small business (`sanantonio.gov/edd/small-business`)
- City of Arlington — Office of Economic Development (`arlingtontx.gov/.../economic_development`)

Dropped for failing the load check: Austin's small-business resources page (404) and the SBA
Texas local-assistance page (404). If a seed page stops loading, the scan records a page
error and keeps the page's previous rows — it is never reported as link-free.

## Honesty rules

- Dead = the check returned HTTP 4xx/5xx, or the host no longer resolves (DNS failure).
- Unknown = the check timed out or errored another way. Unknown is never shown as dead.
- A listing is "listed" only when the official API returned the company. Without a SAM.gov
  key, SAM reports `requires_setup`. CMBL is always manual — there is no public API.
- The "what to offer" suggestion is built from the contractor's trade and the page name only;
  Field Pro never invents page content or a contact email.
- No scraping of pages behind a login; public .gov pages only. No email is sent.

## Endpoints

- `GET /v1/gov-opportunities/status` — scan status per seed page + SAM key state.
- `GET /v1/gov-opportunities?trade=&company=&city=` — dead-link opportunities for one trade
  plus SAM.gov / CMBL listing presence.
- `POST /v1/gov-opportunities/refresh` — re-run the scan now (rate-limited, 2 per 5 min).
- `POST /v1/gov-opportunities/draft` — draft the outreach email for one opportunity (Qwen;
  honest error when AI is not connected).

## Activation

- One Render deploy runs migration 0034 (new `gov_link_checks` table). The worker's on-start
  backfill runs the first scan when the stored check is more than 24 hours old.
- Optional: set `SAM_GOV_API_KEY` (already in `render.yaml` config as `externalBids.samGovKey`)
  to turn on the live SAM.gov listing check. Without it, SAM reports `requires_setup`.
