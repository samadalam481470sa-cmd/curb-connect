# Roof Intelligence Engine — audit and delivered core

**Feature ID:** ROOF-AI-001. **Status:** foundation core, the Google Solar structured-insights
adapter, and the confirmed-address analysis job/cache are delivered; licensed analysis imagery, the
model and UI are not implemented. This page is the audit and the honest status record for the engine
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

### Imagery schema (delivered)

Migration `0013_supreme_sharon_ventura.sql` extends `imagery_assets` with the analysis provider ids
(`google_solar`, `analysis_licensed_aerial`, `naip`, `local_gis`, `lidar`), quality and perspective
enums, processing date, orthorectification, and sharpness, roof-visibility, shadow, georeference and
building-match scores. Existing rows default to `unknown`/null rather than invented values, and every
0–100 score is range-checked in Postgres. The table keeps its existing forced RLS and tenant
constraints.

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

## Roof analysis job and cache (delivered)

`POST /v1/roof/analysis-jobs` accepts a property id and an optional roof order id. It refuses with
`address_confirmation_required` until a person has set `confirmed_location` and `confirmed_at` on
the property. The job snapshots that address and those coordinates, then queues `roof.analysis`
through the transactional outbox, so the API never calls a paid provider in the request path.
`GET /v1/roof/analysis-jobs/:id` returns status, the cache indicator and normalized insights.

The worker re-checks the confirmation before calling Google Solar, fails definitively if the pin
moved after the request, and reuses the newest succeeded result for the same provider and rounded
coordinates for 30 days. A cache hit makes no provider request. Results remain
`structured_insight_only` with `imageryRights: not_granted`: they are review input, never certified
roof geometry, and retryable provider failures use graphile's backoff.

## Contractor uploads (delivered)

`POST /v1/imagery/contractor-uploads` registers a processed media asset owned by the property. In
one tenant transaction it writes an `imagery_analysis` consent row (granting person, source, policy
version and evidence), stores the exact `RoofImageryRights`, converts the consent period's
`retentionDays` into `imagery_assets.expires_at`, links the asset to the consent and writes an audit
event. The `contractor_upload` provider advertises upload/analysis capability but no imagery search
or structured insights. Registration refuses media owned by another property, unprocessed media,
rights that do not allow storage, a retention period outside 1–3650 days, a blank grantor or grant
source, and a second asset for the same file; the media asset id is also the provider id. Upload and
EXIF-stripping remain in the media module; this endpoint records the licence and consent trail. The
generic `POST /v1/imagery/candidates` ingest rejects `contractor_upload` outright, and Postgres
enforces the same rule for every writer: `imagery_assets_contractor_consent_ck` refuses a
`contractor_upload` row with no consent, no future `expires_at`, or rights that do not allow storage,
so an asset cannot be stored without valid consent, rights and retention even outside this endpoint.

## Consent withdrawal and retention (delivered)

`POST /v1/imagery/consents/:consentId/withdrawal` never edits the original grant. It inserts a new
`imagery_analysis` consent row with `status='withdrawn'` and `supersedes_id` pointing at the grant,
records the reason and actor in its evidence, marks every linked imagery asset `expired`, moves its
`expires_at` to now (never later) and increments its revision. The API writes the audit event in the
same transaction, so the grant, withdrawal, asset state and audit trail agree. Replaying the
withdrawal returns the existing row with `alreadyWithdrawn: true`; it does not create a second
withdrawal. Expired assets are excluded from rankable candidates, and the client asset response
reports `rights_expired` even when vision metadata has not been collected.

## Imagery ingestion (delivered)

`POST /v1/imagery/candidates` accepts a normalized `RoofImageryCandidate` and writes the provider id
(`analysis_licensed_aerial`, `google_solar`, `naip`, `local_gis`, `lidar`, `contractor_upload` or
`fixture`) plus every ranking field into `imagery_assets`: source reference, capture and processing
dates, GSD, quality, perspective, orthorectification, sharpness, roof visibility, shadow,
georeference and building-match confidence, rights, attribution and retention expiry.
`GET /v1/imagery/candidates?propertyId=` reads complete, analysis-provider rows back into the same
contract. `GET /v1/imagery/assets?propertyId=` uses the client `ImageryCandidateSchema` and returns
quality, perspective, orthorectification, processing date, all five scores and current eligibility
blockers without exposing display-only or incomplete rows as rankable candidates. Rows missing
required ranking metadata or using a display-only provider are omitted rather than filled with
invented values. The integration test posts aerial and NAIP candidates, reloads
them and verifies the aerial asset is selected by `rankImageryCandidates`.

## Why the rest is not built yet

- **No licensed analysis imagery.** Owner decision D-03 is open and the licensing register forbids
  machine analysis of the map tiles currently used for display. Building the CV pipeline on those
  tiles would breach the stated terms.
- **No trained, validated model.** The vision service abstains by design and no dataset exists
  (D-12); claiming segmentation would violate AIQ-081 and the repository's honesty rules.
- **No provider credentials.** Google Solar requires a server-side API key; none is configured.
- **No hosted deployment.** Production behaviour cannot be verified here; integration tests run
  against an isolated PostgreSQL 17 + PostGIS database.
- **No roof UI route.** `/roof` is still an honest placeholder; adding an analysis screen before the
  backend exists would create dead controls (PLT-015).

## Build order for the next slices

1. **Imagery provider adapters.** Delivered: the typed `ImageryProvider` contract, a Google Solar
   structured building-insights adapter (server-side key, no pixels, explicit `not_granted`
   imagery rights), a contractor-upload provider and an authenticated `GET /v1/imagery/providers`
   status route. Contractor uploads now record consent, rights and retention through
   `POST /v1/imagery/contractor-uploads`. Still to build: `searchCoverage`/`getAuthorizedAsset` for
   an analysis-licensed aerial provider. The confirmed-address job and persistent cache are
   delivered (see above). Every adapter reports `not_configured` rather than faking data.
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
