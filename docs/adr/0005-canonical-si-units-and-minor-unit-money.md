# ADR 0005: Canonical SI units and integer minor-unit money

- Status: Accepted
- Date: 2026-10-26
- Requirements: STR-010, PLT-019, RF-029, CP-051..060, OPS-065

## Context

Roofers think in feet, squares (100 sq ft) and pitch as "6 in 12"; curb work mixes linear feet,
inches of depth and cubic yards; some markets use metric. Quotes are legal and financial
documents: a rounding difference between screen, PDF and invoice is a defect, and silently using
binary floating point for money produces such differences. The golden curb fixture (page 60 of
the blueprint) must reproduce exactly: direct cost $3,744.00, +10% overhead $4,118.40, and at a
25% target margin $5,491.20 before tax.

## Decision

- **Geometry and quantities** are stored and computed in canonical SI units: meters, square
  meters, cubic meters. Conversion to and from display units happens only at boundaries, using
  `packages/geometry` unit helpers. Pitch is stored as a rise/run ratio plus the original input
  (e.g. `{ rise: 6, run: 12, unit: "in/in" }`).
- **Money** is stored as integer minor units (`bigint`) plus an ISO 4217 currency code. Unit rates
  are `numeric(18,6)` and travel as decimal strings. All price arithmetic uses decimal.js through
  `packages/pricing` (precision 40, half-up rounding), with rounding to minor units only at named
  stages (e.g. line total, subtotal, tax). JavaScript floats are never used for money; ESLint
  flags `parseFloat`.
- **Unknown is not zero.** Inputs are either `{ state: "unknown" }` or
  `{ state: "known", value, unit, source, measuredAt, precision }`. A missing critical component
  makes an estimate review-required instead of pricing it at $0.
- `packages/pricing` exports `ENGINE_VERSION`; every stored estimate records the engine version and
  the price-book revision it used.

## Consequences

- Identical results across API, web, PDF and tests because they share one library and one
  rounding policy.
- Display code must always convert; storing a value in feet by mistake is a bug that tests must
  catch (round-trip conversion tests).
- Exact quantities are kept separate from rounded order packs (bundles, rolls, truckloads).

## Revisit triggers

- A market that requires a different rounding rule for tax or currency (e.g. cash rounding).
- Currencies with more than two minor-unit digits in scope.
- Evidence that a stage-level rounding choice disagrees with an accounting system the owner adopts.
