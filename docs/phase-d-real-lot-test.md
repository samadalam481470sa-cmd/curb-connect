# Phase D item 19 — house builder + land feasibility on one real lot

Run date: 2026-11-23. Test: `apps/web/src/features/build/realLot.test.ts`.

## Lot (public data only, no customer data)

- Center coordinates: **32.7767, -97.3670 (Fort Worth, TX)**.
- Modeled parcel: 400 ft street frontage × 320 ft deep (≈2.94 acres), rectangular
  (the tool supports rectangular parcels only).

## Inputs

- **Terrain:** 3×3 elevations fetched live from the USGS 3DEP Elevation Point Query
  Service (`epqs.nationalmap.gov`), feet:
  - Row 0: 598.997, *fetch timed out (null)*, 615.759
  - Row 1: 614.179, 645.320, 630.682
  - Row 2: 635.980, 650.074, 636.774
  - The missing sample is filled by `fillGrid` (neighbour average), same as the live API.
- **Flood zone:** FEMA NFHL (`hazards.fema.gov`) was **unreachable from the build
  environment** (HTTP 000) on 2026-11-23, so the run uses `flood: null`.
  **Live flood lookup is unverified in this run** and must be re-checked where the
  service is reachable.
- **Zoning, costs, revenue, timeline:** in-repo starting values (`DEFAULT_RULES`,
  `DEFAULT_COSTS`), which are explicitly labeled starting values, not ordinance rules
  or published prices. This run verifies the math pipeline, not an investment decision.
- **House:** `DEFAULT_SPEC` (50×32 ft, 1 story, 3 bed / 2 bath, 6/12 roof).

## Steps exercised

1. `fillGrid` on the recorded USGS grid (null handling).
2. `runFeasibility` for all three exit plans (`sell_pads`, `build_sell`, `build_hold`):
   layout + code check, earthwork cut/fill, cost rows with sources, revenue/profit,
   monthly cash flow, peak equity, hold NOI/value for build-hold.
3. `computeTakeoff` + `priceTakeoff` for the default house (quantities with formulas;
   unpriced materials stay unpriced).

## Findings

- Recorded elevations span ~51 ft across the parcel, so earthwork quantities and
  slope-driven lot issues are expected and asserted (no NaN, no crash).
- Bugs found: one test-authoring bug on first run (asserted a non-existent `cashFlow`
  field on `CashMonth`; the field is `net`). Fixed in the test. No product-code bug was
  found in this run; all 6 tests pass. If a future run fails, fix additively and record
  the fix here.

## Still unverified live

- FEMA flood-zone lookup (endpoint unreachable here).
- Browser UI flow on the deployed site (Render deploy is the main agent's step).
- Real zoning rules/costs for this parcel (starting values used by design).
