# Roof Intelligence Engine — audit and delivered core

**Feature ID:** ROOF-AI-001. **Status:** foundation core delivered; the network, database, model and
UI layers are not implemented. This page is the audit and the honest status record for the engine
specification.

## Audit — what the repository already had

| Asset                        | State before this change                                                                                                                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roof geometry math           | Implemented: `packages/geometry` (pitch, slope factor, polygon validation, topology) and `packages/contracts/src/roof-geometry.ts` (facet/vertex/edge schema, topology validator).                                                        |
| Roof database schema         | Implemented: `roof.ts` (orders, reports, versions, facets, edges, overrides, takeoff) and `imagery.ts` (assets, rights, GSD, capture date).                                                                                               |
| Roof / imagery / vision APIs | **Stubs** — modules registered but with no routes.                                                                                                                                                                                        |
| Roof measurement UI          | Placeholder (`/roof` shows "coming in a later slice"); no editor.                                                                                                                                                                         |
| Vision service               | Deterministic photo-quality checks only; recognisers abstain, no trained model is registered.                                                                                                                                             |
| Licensing                    | `docs/product/licensing-register.md` marks Google map tiles and Esri basemaps **visualization-only**; an analysis-licensed aerial provider is undecided (owner decision D-03), as are training datasets (D-12) and legal sign-off (D-13). |

## What this change delivers

`packages/contracts/src/roof-analysis.ts`, exported from `@fieldline/contracts`, with tests in
`roof-analysis.test.ts`. It is pure: no network, database, clock or filesystem, so every rule below
is deterministic and unit-tested.

1. **Rights gate before scoring.** A candidate is eligible only when its licence permits analysis
   and derivatives, its retention has not expired, its ground sample distance is known and no
   coarser than 60 cm/px, its sharpness is at least 40/100, and the building match is at least 60%.
   Standard web-map imagery cannot enter the pipeline by construction: Google map tiles and Esri
   basemaps are not even valid analysis providers in this contract.
2. **Evidence-weighted ranking, not newest-wins.** Resolution (25%), sharpness (20%), roof
   visibility (20%), orthorectification (15%), recency with a two-year half-life (10%) and metadata
   confidence (10%). An older clear image beats a newer obstructed one; ties break by newer capture
   date then asset id. Every candidate is ranked and exclusions carry reasons.
3. **Explicit abstention.** `assessRoofAnalysis` returns `abstained` with typed reasons — no
   registered model, unconfirmed building, no eligible imagery, or missing geometry. It never
   substitutes a default roof shape, pitch or area.
4. **Pitch-honest measurement.** Sloped area is `planArea / cos(pitch)`; an unknown pitch returns
   `null` and makes the sloped total, roofing squares and certification unavailable. Totals list the
   unresolved facets instead of silently treating them as flat.
5. **Conservative confidence.** Overall confidence is the weakest of imagery, geometry, calibration,
   pitch and building match — not an average that hides a bad input.
6. **Immutable approvals.** A measurement revision is editable only while `draft`; approving freezes
   it and any correction must be a new revision.

### Acceptance tests covered by this core

| Spec test | Coverage                                                                 |
| --------- | ------------------------------------------------------------------------ |
| 7         | Historical image is not automatically current (recency is 10%, dated)    |
| 8         | Highest-resolution eligible candidate can be selected                    |
| 9         | A blurry image is excluded (sharpness gate)                              |
| 13        | Facet scale is deterministic from plan area (calibration itself pending) |
| 14        | Pitch correction recalculates sloped area                                |
| 15        | Unknown pitch cannot yield a certified result                            |
| 18        | Approved revisions are immutable                                         |
| 22        | No cross-tenant access exists to test yet (no HTTP layer)                |
| 24        | Expired image permissions exclude the asset                              |

Tests 1–6, 10–12, 16–17, 19–25 require address resolution, a licensed provider, a trained model,
persistence or HTTP/UI; they are **not** claimed.

## Why the rest is not built yet

- **No licensed analysis imagery.** Owner decision D-03 is open and the licensing register forbids
  machine analysis of the map tiles currently used for display. Building the CV pipeline on those
  tiles would breach the stated terms.
- **No trained, validated model.** The vision service abstains by design and no dataset exists
  (D-12); claiming segmentation would violate AIQ-081 and the repository's honesty rules.
- **No provider credentials.** Google Solar requires a server-side API key; none is configured.
- **No database in this workspace**, so job persistence, idempotent processing and audit events
  cannot be verified end to end. Integration tests require PostgreSQL 17 + PostGIS.
- **No roof UI route.** `/roof` is still an honest placeholder; adding an analysis screen before the
  backend exists would create dead controls (PLT-015).

## Build order for the next slices

1. **Imagery provider adapters** behind one typed interface (`searchCoverage`, `findImagery`,
   `getMetadata`, `getAuthorizedAsset`, `checkLicense`, `getRetentionPolicy`) with a Google Solar
   building-insights adapter and a contractor-upload adapter that records consent. Every adapter
   reports `not_configured` rather than faking data.
2. **Database job persistence** for analysis jobs, candidates, revisions and predictions, with
   tenant-scoped queries, audit events and idempotent processing (reuse the outbox/worker pattern).
3. **HTTP module** `/v1/roof-analysis/jobs` with the endpoints in ROOF-AI-001 Part E, RBAC
   (`roof_order:read/create`, `roof_report:edit_geometry`, `roof_report:approve`) and `If-Match`
   revisions.
4. **AI screen** (`/roof/:orderId/ai`) with address confirmation, candidate comparison, confidence,
   unresolved conditions and human approval — controls to be registered in Volume 2 before coding.
5. **Model integration** only after a registered, validated model and licensed training data exist;
   until then the vision worker must keep abstaining.

## Deliberate limits

The engine core is intentionally small and honest. It does not fetch imagery, call Google, run a
model, persist a job, price a roof or claim a measurement. It decides **whether an image may be
analysed at all**, which image is best and why, and whether the resulting geometry is complete
enough to certify — the rules every later layer must obey.
