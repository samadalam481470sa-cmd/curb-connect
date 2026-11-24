# Active Permits Funnel

Live Texas permits, funneled into ranked, callable leads — and kept fresh by a keep-alive
worker the user calls "caffeinate". The contractor opens the funnel, calls the owner, logs
the call, and works the lead through New → Contacted → Quoted / Interested → Won / Lost.

## What already existed vs what is new

| Piece | Already existed | New in this build |
|---|---|---|
| Permit feeds | 8 live sources + fetchers (`permitLeads/sources.ts`), freshness module + daily 06:00 refresh (`jobs/permitSources.ts`) | Funnel reuses all of it; no new feed |
| Ranking | `search.ts` scores permits for a trade/city search; Pool Radar ranks pool permits | `funnel/funnel.ts` — `deriveFunnelLeads`: active permits only, hot/warm/cool call priority, plain-language call reasons, dedupe, dead/public-owner exclusion |
| Owner lookup | Land Scout CAD parcels (Collin + Dallas) with owner name + mailing address | `funnel/owner.ts` — address-matched CAD lookup (exact match only, ambiguous = no owner), plus phone from the permit itself or the company's own CRM contacts |
| Lead stages | CRM `leads` table (new/contacted/qualified/converted/disqualified/merged) — no quoted/interested/won/lost | `funnel/stages.ts` machine + `permit_funnel_stages` / `permit_funnel_calls` tables (migration 0035) |
| Refresh | Daily 06:00 freshness refresh; 2-hour permit watch | `funnel/cadence.ts` + `funnel/jobs.ts` — 30-min workday / hourly overnight refresh, 15-min keep-alive heartbeat, on-start backfill |
| UI | Permit Job Search, Pool Radar view | `permitJobs/Funnel/` — `FunnelView.tsx` + client helpers |

## Honesty rules (carried in code)

- Only permits the city feeds actually returned. Nothing backfilled, nothing invented.
- Contractor, value and owner are only what a public record published; blank stays blank.
- **A phone number is never invented.** It comes from the permit feed (Austin/Dallas publish
  one sometimes) or from the company's own CRM contacts matched by name. Otherwise the lead
  says "Phone not in public records" and shows the owner mailing address instead.
- Owner names come from the county appraisal district matched by exact street address; an
  ambiguous match returns no owner rather than the wrong one. Dallas CAD is appraisal-year
  2019 — the vintage rides on the lead.
- A feed that stopped publishing is labelled stale; its leads stay visible with that label.
- Call priority is a calling order (newest first, boosted when no contractor is on file), not
  a prediction the owner will hire you.
- Cities publish daily at best (Houston weekly), so the 30-minute cadence re-checks freshness
  as often as the publishing rhythm justifies. The keep-alive cannot keep Render's free web
  service from sleeping on zero HTTP traffic — it keeps the worker warm while the process is
  up, and the on-start job backfills on wake.

## Endpoints (plugin `funnel/routes.ts`)

- `POST /v1/permit-leads/funnel` — live fetch of all 8 feeds + custom feeds, ranked leads
  (cap 300), per-feed freshness + last-checked, owner enrichment on the top 40 leads.
- `GET /v1/permit-leads/funnel/stages` — stored stages for this company.
- `POST /v1/permit-leads/funnel/stage` — move a lead (`new → contacted → quoted/interested → won/lost`, `lost → new` to reopen).
- `POST /v1/permit-leads/funnel/call` — log a call (outcome + note); moves a new lead to Contacted.
- `GET /v1/permit-leads/funnel/cadence` — keep-alive schedule, per-source due/next-refresh/last-checked.

## Worker jobs (`funnel/jobs.ts`)

- `permit_funnel_refresh` — crontab `*/30 12-23,0-1 * * *` + `0 2-11 * * *` (UTC; 06:00–20:00
  Texas workday, same UTC convention as the other permit jobs).
- `permit_funnel_keepalive` — `*/15 12-23,0-1 * * *`; heartbeat that refreshes anything due.
- `permit_funnel_refresh_on_start` — backfill on server start/wake.

## Integration (for the main agent — these files were already modified by the parallel Gov Opportunities build, so this build did not touch them)

1. `apps/api/src/db/schema/index.ts` — optional, for consistency with every other table:
   add `export * from './permitFunnel';` alongside the other schema exports. Not required for
   the funnel to work: `funnel/store.ts` loads the barrel first (to init the schema graph in
   the working order) and then imports the table module directly.
2. `apps/api/src/modules/permitLeads/index.ts` — at the top add
   `import { createFunnelRoutes } from './funnel/routes';` and inside the module, before the
   closing of `permitLeadsModule`, add `await app.register(createFunnelRoutes());`.
3. `apps/api/src/jobs/tasks.ts` — add `import { permitFunnelTasks } from '../modules/permitLeads/funnel/jobs';`
   and spread `...permitFunnelTasks(deps),` in `buildTaskList` next to the other permit tasks.
4. `apps/api/src/worker.ts` — add `import { FUNNEL_CRONTAB } from './modules/permitLeads/funnel/jobs';`,
   add `FUNNEL_CRONTAB` to the crontab array, and queue the startup job mirroring the existing
   `permit_sources_refresh_on_start` block:
   `await runner.addJob('permit_funnel_refresh_on_start', {}, { jobKey: 'permit_funnel_refresh_on_start', maxAttempts: 1 }).catch(...)`.
5. Web — render `<FunnelView />` from `permitJobs/Funnel/FunnelView` inside Permit Job Search
   (same pattern as `<PoolRadar />` in `PermitJobSearch.tsx`), and add the `/permit-leads/funnel`
   paths to `apps/web/src/lib/endpoints.ts` + the `permit-jobs` nav entry in
   `packages/contracts/src/routes.ts` if a standalone page is wanted. No new page file was
   created by this build.
6. Deploy — run migration `0035_permit_funnel.sql` (hand-written; the drizzle meta snapshot
   was left untouched, same as 0033). Until it runs, the routes fall back to the in-memory
   stage store (stages last for the process lifetime) and log that fallback nowhere — the
   funnel list itself works with or without it.

## Files

- `apps/api/src/modules/permitLeads/funnel/funnel.ts` (+ `funnel.test.ts`) — derivation + ranking
- `apps/api/src/modules/permitLeads/funnel/owner.ts` (+ `owner.test.ts`) — CAD + contacts enrichment
- `apps/api/src/modules/permitLeads/funnel/stages.ts` (+ `stages.test.ts`) — stage machine
- `apps/api/src/modules/permitLeads/funnel/cadence.ts` (+ `cadence.test.ts`) — keep-alive schedule
- `apps/api/src/modules/permitLeads/funnel/store.ts` (+ `store.test.ts`) — stage/call storage
- `apps/api/src/modules/permitLeads/funnel/routes.ts` — Fastify plugin (5 endpoints)
- `apps/api/src/modules/permitLeads/funnel/jobs.ts` — graphile-worker tasks + crontab
- `apps/api/src/db/schema/permitFunnel.ts` — `permit_funnel_stages`, `permit_funnel_calls`
- `apps/api/drizzle/0035_permit_funnel.sql` — migration (renumbered from 0034: the parallel Gov
  Opportunities build already claimed `0034_gov_opportunities.sql`)
- `apps/web/src/features/permitJobs/Funnel/funnel.ts` (+ `funnel.test.ts`) — client helpers
- `apps/web/src/features/permitJobs/Funnel/FunnelView.tsx` — funnel view
