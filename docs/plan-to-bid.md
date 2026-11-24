# Plan-to-Bid

Upload a construction plan (PDF exported from CAD, or an AutoCAD DXF/DWG) and Field Pro
reads the drawings and specs into a review-ready takeoff, estimate and bid package,
organized by trade in build sequence.

## What already existed (reused, not rebuilt)

- **Plan reading** — `apps/api/src/services/plan-pdf.ts` (text layer), `plan-geometry.ts`
  (walls, rooms, footprint, scale) and `plan-dwg.ts` (DWG → DXF), already used by the
  House Builder's `/home/brief` endpoint.
- **Takeoff engine** — `apps/web/src/features/build/takeoff.ts` (`computeTakeoff`,
  `priceTakeoff`) with the dated price book in `prices.ts`. Plan-to-Bid runs it against
  the measured footprint when the plan gives one.
- **AI hook** — the existing home AI server (`HOME_AI_BASE_URL`, Qwen) with the open
  model as backup, the same pattern as invoice AI, Ask Field Pro and Land Scout.
- **Live prices** — the existing market endpoint (`GET /v1/market/material-prices`,
  SerpApi, needs `SERPAPI_API_KEY`), with source + checked-at timestamps.
- **PDF package** — `@fieldline/pdf` layout primitives and snapshot pattern (same as the
  Land Scout due-diligence report).

## What is new

- `packages/contracts/src/planToBid.ts` — trade taxonomy (14 trades in build sequence),
  read/bid-package request and response schemas.
- `apps/api/src/modules/planToBid/` — `GET /v1/plan-to-bid/status`,
  `POST /v1/plan-to-bid/read` (deterministic keyword + geometry reader, optional Qwen
  classification), `POST /v1/plan-to-bid/bid-package` (renders the DRAFT PDF).
  No new database tables; no migration.
- `packages/pdf/src/templates/bid-package.tsx` — the draft bid package template.
- `apps/web/src/features/planToBid/` — review screen (`PlanToBidView`), review logic
  (`planToBid.ts`: takeoff → trades, totals, build sequence) and the `/plan-to-bid` page.

## Honesty rules (do not weaken)

- A bid package is always labeled **DRAFT — review-ready, not a sent proposal**.
  Proposals are a stub; nothing here sends anything to anyone.
- Quantities are only numbers when the plan states them or the geometry measured them.
  Otherwise they are blank for the reviewer to fill in.
- Prices are only numbers when they come from the dated price book, a live listing, or
  a contractor-entered rate. Blank is "Price missing" and is excluded from every total;
  a total with any approved unpriced line is shown as partial (and as null in the API).
- Labor and subcontractor costs are contractor-entered only — never invented.
- The Florida "3x more likely" style claims from the source reel are not in the product.
  Follow-up windows and conversion rates are not claimed anywhere in Plan-to-Bid.

## Trades (build sequence)

Sitework & Landscape → Excavation → Foundations → Underground Plumbing → Rebar & Vapor
Barrier → Structural Steel → Framing → Roofing → Envelope & Exterior → Electrical →
Plumbing → HVAC → Interior Finishes → Exterior Finishes & Site.
