# Land feasibility upgrades

Additive upgrades to the House Builder Land feasibility tool. Nothing that already
existed was removed or changed in behaviour: the lot layout, code check, earthwork,
development cost and monthly cash flow in `siteFeasibility.ts` run exactly as before.

## What already existed

- **Land feasibility tool** (`apps/web/src/features/build/LandFeasibility.tsx`,
  `siteFeasibility.ts`, `landScene.ts`): parcel + zoning rules + terrain -> numbered
  lot layout (one row on the street, or a new street through the middle), per-lot
  code check with reasons and fixes, cut/fill earthwork, itemized development cost,
  profit / margin / peak equity and a monthly cash-flow chart, drawn as a 3D site
  plan with slope heatmap, trees and underground utilities.
- **Site terrain API** (`apps/api/src/services/site-terrain.ts`): elevations from the
  USGS 3D Elevation Program (3DEP) Elevation Point Query Service plus the FEMA
  flood zone from the National Flood Hazard Layer. No key, no paid feed.
- **Land Scout** (`apps/api/src/modules/landScout/`, `apps/web/src/features/landScout/`):
  buy-box parcel search and scoring (Collin CAD, Dallas CAD, TxDOT highways,
  substation mirror) with due-diligence reports. Its CAD values are assessed
  values, not sale comps.

## What is new

### Subdivision lot plan — `subdivision.ts`

`planSubdivision(parcel, { targetLotSqft, minLotWidthFt, roadsAllowancePct, roadWidthFt })`
lays out a simple numbered grid/row plan: one row on the existing street, or a
spine road through the middle with lots on both sides, whichever fits more lots.
The lot count is capped at what the net area (gross minus the roads allowance)
holds at the target lot size. Returns lot rects, the road rect, gross / road /
net acres, average lot size and lots per acre. Zero or blank inputs return an
empty plan with a note, never a crash.

In the UI it is a "Subdivision lot plan" card with target lot size and roads
allowance inputs, a numbered 2D plan, and an optional overlay on the 3D site
plan (white "Sub lot" outlines, off by default). Everywhere it is labeled a
**planning layout, not a survey** — it is not a plat and not a zoning approval;
the lot check above is what tests each lot against the rules.

### Financial underwriting panel — `underwriting.ts`

`underwrite({ land, sitework, verticalBuild, selling, hoaMonthlyPerLot, lotCount,
carryMonths, financing, revenue, peakEquity, durationMonths })` itemizes the deal
into land, sitework, vertical build, selling, HOA dues carried, and financing,
and computes profit, **return on cost** (profit / all-in cost), **equity multiple**
((peak equity + profit) / peak equity) and an **annualized return** from the
multiple over the deal length. The UI feeds it from the feasibility run (land
price, site cost, homes cost, selling cost, interest carry, revenue, peak equity,
deal length) and adds one editable input: HOA dues per lot per month (default 0,
blank). Blank or zero inputs yield null ratios ("—" in the UI), never Infinity.
Every output is labeled an estimate.

### Slope / grading analysis — `slopeGrading.ts`

`slopeBands(terrain, parcel, maxBuildSlopePct)` samples the existing USGS 3DEP
terrain grid across the parcel and reports the share in four bands: gentle
(<5%), moderate (5–15%), steep (15% to building limit), over the building limit.
`gradingNote` turns the bands into a plain-language note. The UI shows the bands
with the cut/fill totals. It is labeled an **estimate, not engineering**: a civil
engineer must confirm grading, drainage and retaining walls.

### LiDAR wording

No new LiDAR feed was added and none is needed: the terrain already comes from
USGS 3DEP, which is LiDAR-derived elevation. The tool now says so in-app
("Ground heights are elevation from USGS 3DEP LiDAR", and on the ground-source
line when real USGS data is loaded). Do not add a paid LiDAR API.

### Comparable sales

No comp source is wired in the repo — the market module has material prices and
indexes, trades and site context, but no sale comps, and Land Scout's CAD values
are assessed values, not comps. The tool therefore shows an honest
"No comparable-sales source is connected" state and never invents comps.

## Tests

- `subdivision.test.ts` — spine-road vs single-row choice, area cap, zero/blank inputs.
- `underwriting.test.ts` — itemized totals, HOA carry, zero/blank ratios, a loss.
- `slopeGrading.test.ts` — flat / moderate / steep terrain bands, estimate wording.
- Existing `siteFeasibility.test.ts` still passes unchanged (10 tests).
