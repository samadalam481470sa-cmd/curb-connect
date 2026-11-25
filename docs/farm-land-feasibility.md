# Farm land-feasibility additions

Five additions to the Land feasibility tool, from the @custom_ai_systems farm land-feasibility
reel (a Panama ranch demo — none of its demo figures are used; every number here comes from
the builder's own inputs). All additive; nothing removed.

## 1. Farm scenario + payback / break-even / valuation-over-time

- `apps/web/src/features/build/farmScenario.ts` — farm-only case next to the three exit
  plans: buy, farm (or lease) for a hold period, sell. Inputs are contractor-entered
  (income $/acre/yr, costs $/acre/yr, hold years, appreciation %/yr, exit selling costs %).
  Outputs: net farm income, payback years, valuation-over-time curve, exit value, profit,
  return on cost. Blank income = no scenario (nulls + note), never an invented rate.
- `underwriting.ts` gained project-level metrics: **break-even revenue** (the all-in cost),
  **break-even price per lot**, and **payback years** (first month the cumulative cash
  balance returns to zero, from the monthly cash flow; null when it never does).

## 2. PDF concept site plan

- New `@fieldline/pdf` template `concept_site_plan`: a "Concept for Discussion" sheet with
  the numbered lot plan + home footprints drawn to scale, lot schedule, underwriting
  summary and assumptions. Labelled a concept on its face — not a survey, plat or zoning
  approval.
- `POST /v1/land-feasibility/concept-plan` (`export:create`) renders it server-side from
  client-computed figures (same pattern as saved-project summaries: the server renders
  verbatim, never recomputes). The web downloads the PDF; nothing is sent anywhere.

## 3. Land decision-class layer

- `decisionClasses.ts` — four contractor-painted classes (cultivated, conservation,
  regeneration, buildable pocket) as rectangles in parcel feet. Paint by dragging on the
  2D plan or by typing the rectangle; per-class acres/share table; optional drape over the
  3D scene. Honest label everywhere: no land-cover or soil data source is connected, so
  the classes are the builder's judgment, not measured data.

## 4. Short-stay (nightly rental) case

- `shortStay.ts` — nightly rate, occupancy %, operating-cost % (all contractor-entered)
  → nights/yr, net income, payback, cash-on-cash, value at the cap rate. Note reminds the
  builder to confirm the city allows nightly rentals.

## 5. Utility trench-depth check

- `trenchDepthCheck` in `slopeGrading.ts`, shown in the Slope & grading panel: deepest
  sewer cut along the main = entered depth + ground rise above the main's low end, sampled
  from the USGS 3DEP terrain. Null (with an explanatory note) when no sewer depth was
  entered. Estimate only; the pipe profile is an engineer's design.

No migration: farm/short-stay/decision-zone inputs are component state (like the phase
count and HOA dues), not part of the saved-project snapshot, so saved projects do not
restore them.
