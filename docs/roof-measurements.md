# Roof measurements (traced, MANUAL source)

The Roof Measurements page (`/roof`) and the `roof` API module deliver the blueprint's roof
workflow for the **manual measurement path**: find the house, trace each roof plane, measure the
areas, approve, then turn the approved measurement into a priced estimate. It is a real, persisted
and tested workflow. It does not include automatic AI roof detection (see "Not built yet").

## Workflow

1. **Find the house.** Type the job address and press _Fly to_ (OpenStreetMap Nominatim, one
   request per search). Satellite, hybrid and clean views use Esri World Imagery for display only.
2. **Trace.** Press _Trace facet_ and click each corner of one roof plane. Click the first point
   (or press Enter) to close it. Backspace removes the last point and Esc cancels.
3. **Pitch.** Enter rise per 12 for each plane. A plane without a pitch keeps an unknown sloped
   area; it is never guessed.
4. **Save.** _Save measurement_ creates the property, a roof order `RM-YYYY-####`, a report and
   version 1. Later saves create the next version. Earlier versions are kept as superseded.
5. **Approve.** Members with `roof_report:approve` approve the current version. Approval is refused
   while any plane has no pitch. An approved version is frozen by a database trigger.
6. **Estimate.** Members with `estimate:write` price the approved version with their own unit prices
   (prefilled from dated reference listings). The result is estimate `EST-YYYY-####`.

## API

| Route                                      | Permission                  | Result                                                     |
| ------------------------------------------ | --------------------------- | ---------------------------------------------------------- |
| `POST /v1/roof/measurements`               | `roof_order:create`         | Property, roof order, report, version 1 (idempotent)       |
| `GET /v1/roof/measurements`                | `roof_order:read`           | 50 most recent traced measurements                         |
| `GET /v1/roof/measurements/:id`            | `roof_report:read`          | Current version: lon/lat rings, areas, totals, warnings    |
| `POST /v1/roof/measurements/:id/revisions` | `roof_report:edit_geometry` | Next version; stale `baseVersionNumber` is `409`           |
| `POST /v1/roof/measurements/:id/approve`   | `roof_report:approve`       | Version approved, order `approved`; `412` if pitch missing |
| `POST /v1/roof/measurements/:id/estimates` | `estimate:write`            | Estimate + revision; `Idempotency-Key` required            |
| `GET /v1/roof/measurements/:id/estimates`  | `estimate:read`             | Estimates priced from this measurement                     |

Schemas live in `packages/contracts/src/roof-measurement-api.ts`.

## How the numbers are produced

- **The client never sends areas or totals.** Requests carry lon/lat rings, pitches and unit prices
  only. The schemas are strict, so an extra `planSqFt` field is rejected.
- **Areas.** All rings of one measurement are projected about one shared origin with the WGS84
  local tangent plane in `@fieldline/geometry`. Self-intersecting rings and planes under 0.5 m² are
  rejected. Sloped area is plan area × √(1 + (rise/12)²).
- **Storage.** Each version stores the canonical `RoofGeometrySchema` document (`LOCAL_ENU_M`,
  georeferenced), SI totals, and relational facets, vertices and edges. Rings are rebuilt for the
  map with the inverse projection (`tangentPlane().unproject`), accurate to well under a millimetre.
- **Estimate.** `@fieldline/pricing` computes it in decimal arithmetic. The steps are: sloped area,
  waste applied once (human-entered, with a reason), pack quantities rounded up only when ordering,
  cost lines, overhead, target margin, and tax on the taxable share.
  - Shingles: 3 bundles per square.
  - Underlayment: 10 squares per roll.
  - Decking: 32 ft² per OSB sheet.
- **Provenance.** The prices used are recorded as a price book revision ("Roof measurement prices").
  The revision is `approved` only when the member may approve price books. Otherwise it is
  `pending_approval`. The estimate revision pins that price book revision, the measurement version,
  the request and the material takeoff. Estimates are always `quoteKind: review_required` and never
  binding, because a traced measurement is not field-verified.
- **Audit and state.** Order steps are written to `roof_order_events` and follow `roofOrderMachine`:
  `draft → ordered → measuring → review_required → approved → quoted`. Editing an approved or quoted
  measurement returns it to `review_required`. Existing estimates keep the version they priced.
  Creates, revisions, approvals and estimates are written to the audit log.

## Tests

- `apps/api/test/platform/roof-measurements.int.test.ts` runs against PostgreSQL + PostGIS. It
  covers server-side measurement and rejection of client areas, tenant isolation (404 for another
  company), role checks, approval gating on pitch, database immutability of approved versions,
  version conflicts, estimate totals equal to the pricing engine, idempotent replay, price book
  provenance and state transitions.
- `apps/api/src/services/roof-trace.test.ts` covers the geometry and estimate math with hand-checked
  quantities.
- `packages/geometry/src/basics.test.ts` covers the inverse projection round trip.

## Not built yet

- **Automatic roof detection.** One-click detection needs imagery licensed for machine analysis
  (for example Nearmap or EagleView), an account, and a segmentation model validated against real
  measurements. Esri display tiles are not used for analysis. Google's Solar API terms limit it to
  solar use, so it is not used for roofing estimates.
- **Edge classification** (eave, rake, ridge, hip, valley). Traced edges are stored as
  `unclassified`, so starter strip, ridge cap, drip edge and flashing are left out of the estimate
  and the estimate says so.
- **Proposals and invoices** from a roof estimate.
