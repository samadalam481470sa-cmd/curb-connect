# Architecture

This document explains how the platform is put together and why. It is written for engineers
joining the project; the binding acceptance specification is the 100-page blueprint (one epic per
page, requirement IDs such as `CP-052-API`). Decisions with lasting consequences are recorded as
ADRs in [`docs/adr/`](adr/).

## What we are building

A multi-tenant contractor platform with two first-class, equally prominent products that share
customer, property, quote, proposal, invoice and payment infrastructure:

- **Roof Measurements**: choose an address, confirm the structure, sketch or import roof facets,
  enter pitch, review quantities, and produce a deterministic measurement report and quote.
- **Curb Cutting** (cutting or modifying concrete street/driveway curbs): guided job-site photos,
  a calibrated reference dimension, a corrected curb path, and a clearly preliminary
  low/base/high estimate from contractor-managed regional price books, with hard gates for
  permits, right-of-way, unknown utilities and uncertain depth.

Two principles shape every layer:

1. **Never fabricate.** Unknown values are an explicit `unknown` state, not zero. Unfinished
   features are visibly unavailable (feature flags). There is no trained computer-vision model,
   so recognizers abstain unless a registered model is enabled. Photo-quality scoring is
   deterministic and real.
2. **Everything is versioned and traceable.** Images, calibrations, roof geometry, curb
   dimensions, price-book revisions, estimates, reports, approvals and signed contracts are
   immutable revisions linked by id, and every write produces an audit event with a
   correlation id.

## System overview

```
 Browser / installed PWA (phone, desktop)
        |  same-origin HTTPS; /v1/* proxied by Next.js rewrites
        v
 apps/web  (Next.js 16 App Router, React 19)          port 3000
        |
        v
 apps/api  (Fastify 5 + zod + OpenAPI 3.1)            port 4000
   |   |        |                 |
   |   |        |                 +--> services/vision (FastAPI, Python 3.13)   port 4200
   |   |        +--> object storage (LocalEncryptedStorage in dev, S3 in prod)
   |   +--> graphile-worker jobs (same PostgreSQL; transactional outbox)
   v
 PostgreSQL 17 + PostGIS (RLS on tenant tables)       port 54329 locally

 infra/dev-idp (stand-in OpenID Connect provider, dev/test only)            port 4100
 Microsoft Entra ID (production identity provider)
```

The browser only ever talks to the web origin. Next.js rewrites `/v1/*` to the API, so the
session cookie stays first-party (`SameSite=Lax`, `httpOnly`).

## Repository layout

npm workspaces ([ADR 0001](adr/0001-monorepo-npm-workspaces.md)):

| Path                 | What it is                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`           | Next.js App Router PWA: `app/manifest.ts`, hand-written `public/sw.js`, MapLibre GL, TanStack Query, IndexedDB offline outbox.                                                              |
| `apps/api`           | Fastify API: modules under `src/modules/*`, Drizzle schema under `src/db/schema/*`, SQL migrations in `drizzle/`.                                                                           |
| `services/vision`    | Python FastAPI worker: deterministic photo quality, abstaining recognizers, pytest.                                                                                                         |
| `packages/contracts` | zod schemas and inferred types for every DTO, enums/state machines, problem+json taxonomy, RBAC policy matrix, route registry, the `BRAND` constant, feature-flag keys, requirement IDs.    |
| `packages/pricing`   | Pure decimal calculation library (money, roof takeoff, waste, packs, curb cost model, overhead/contingency/tax, markup vs margin). Exports `ENGINE_VERSION`. No I/O.                        |
| `packages/geometry`  | Pure geometry: canonical SI units, polygons, roof topology and validation, edge totals, editor command log, curb segments, calibration (reference scale, homography), geodesic/local plane. |
| `packages/ui`        | Design tokens and accessible React components (original visual design).                                                                                                                     |
| `packages/pdf`       | `@react-pdf/renderer` templates rendered deterministically from snapshot JSON.                                                                                                              |
| `infra/dev-idp`      | Local stand-in OIDC provider with seeded test identities. Never deployed.                                                                                                                   |
| `infra/`             | `docker-compose.yml` (PostGIS, MinIO) for machines with Docker; Windows Postgres scripts.                                                                                                   |
| `docs/`              | This file, ADRs, requirements and traceability, product docs, runbooks.                                                                                                                     |
| `legacy/`            | The superseded v1 app, kept for reference; excluded from workspaces and CI.                                                                                                                 |

Workspace packages are consumed as TypeScript source (`"exports": { ".": "./src/index.ts" }`).
Next.js transpiles them (`transpilePackages`); the API runs them through `tsx` in development and
`tsup` bundles them into `apps/api/dist` for production while leaving `node_modules` external.

## API conventions

- **Versioned REST under `/v1`**, JSON in camelCase, OpenAPI 3.1 generated from the zod route
  schemas at `/v1/openapi.json` (interactive docs at `/v1/docs`). Liveness `GET /v1/health`,
  readiness `GET /v1/health/ready`.
- **Modules.** Every feature area is a Fastify plugin in `src/modules/<name>/` registered by
  `src/modules/registry.ts`, each in its own encapsulation context
  ([ADR 0002](adr/0002-fastify-over-nestjs.md)).
- **Errors** are `application/problem+json`:
  `{ type, title, status, detail, code, correlationId, retryable, retryAfterSeconds?, errors? }`.
  Throw `HttpProblem` from `src/http/problem.ts`; 5xx details stay in logs.
- **Correlation id.** `X-Request-Id` is accepted when well-formed (8-128 safe characters),
  otherwise a UUID is generated. It is echoed on every response, logged as `correlationId`, and
  written to audit events.
- **Pagination** is cursor-based: `{ items, nextCursor }`.
- **Idempotency.** `Idempotency-Key` is required on billing/order/estimate/proposal/invoice/payment
  POSTs; stored per org + key with a request hash. A replay returns the original response; the same
  key with a different body returns 422.
- **Optimistic concurrency.** Mutable resources carry an integer `revision`; PATCH requires
  `If-Match`, and a mismatch returns 412.
- **Write pipeline.** Verified session -> active org membership -> server-side RBAC policy check
  -> zod validation -> one transaction -> `audit_events` row (actor, action, resource, before/after,
  correlation id) -> outbox job if side effects are needed.

## Identity, sessions and authorization

Provider-neutral OIDC ([ADR 0006](adr/0006-oidc-provider-neutral-identity.md)): authorization code
flow with PKCE, state and nonce via `openid-client`. Providers come from configuration
(`MICROSOFT_*` for Entra ID, `DEV_IDP_*` for the local stand-in). `external_identities(issuer,
subject)` maps to an internal `users.id`; email is never an identity key, so changing identity
provider never changes internal user ids.

Sessions are server-side: an opaque random token in the `fl_session` cookie (only its SHA-256 is
stored), idle and absolute expiry, rotation on login. Unsafe methods require a same-origin request
(Origin / Sec-Fetch-Site). The active workspace is stored on the session and re-validated against
membership on every request; a user in several organizations must pick one explicitly. A revoked
membership or deactivated user takes effect on the next request.

Roles: `owner`, `admin`, `estimator`, `reviewer`, `salesperson`, `crew_manager`, `finance`,
`read_only`, plus the homeowner portal principal, which is never an organization member. The
policy matrix lives in `packages/contracts` and is enforced by the API; the UI only mirrors it.

## Data conventions

- PostgreSQL 17 + PostGIS. UUID primary keys (`gen_random_uuid()`); `timestamptz` in UTC,
  `date` for date-only fields.
- **Tenancy** ([ADR 0007](adr/0007-rls-and-composite-fks-for-tenancy.md)): every tenant-owned
  table has `org_id uuid NOT NULL` (indexed). Child tables use composite foreign keys
  `(org_id, parent_id) -> parent(org_id, id)`, so a cross-tenant reference cannot exist. Row-Level
  Security policies compare `org_id` with `current_setting('app.org_id')`, which the API sets with
  `set_config(..., true)` at the start of each request transaction. The API still filters by
  organization (defense in depth).
- **Units and money** ([ADR 0005](adr/0005-canonical-si-units-and-minor-unit-money.md)):
  canonical meters, square meters and cubic meters; pitch stored as a rise/run ratio plus the
  original input (e.g. 6 in 12). Money is integer minor units (`bigint`) plus ISO currency; unit
  rates are `numeric(18,6)` strings; rounding happens at named stages, half-up to minor units.
  JavaScript floating point is never used for money.
- **Unknown values**: `{ state: "unknown" }` or
  `{ state: "known", value, unit, source, measuredAt, precision }`, with provenance
  `machine_estimated | imagery_derived | user_entered | field_verified | survey_supplied`.
- Migrations are SQL files in `apps/api/drizzle/`, generated by drizzle-kit from
  `src/db/schema/*` and reviewed by hand (RLS policies and composite FKs are written in SQL).
  They are forward-only.

## Domain rules that the architecture protects

- **Roof.** Each facet is stored separately. `sloped_area = plan_area * sqrt(1 + (rise/run)^2)`.
  Waste is applied once. One roofing square is 100 sq ft. Exact quantities stay separate from
  rounded order packs.
- **Curb.** Photos only suggest. Buried thickness, reinforcement, utility clearance, right-of-way
  authorization and municipal approval are never inferred.
  `direct_cost = mobilization + cutting + demolition + disposal + restoration + traffic + permits +
other verified allowances`; then overhead, contingency and taxes, and either markup or target
  margin (`selling_price = cost_basis / (1 - m)`), computed with decimal.js against immutable
  price-book revisions.
- **Gating.** Permit-implicated, right-of-way, unknown-utility, uncertain-depth or otherwise
  unverified jobs get only a labeled budgetary range or review-required status, never a binding
  automatic quote, and nothing is dispatched while mandatory permits, utility checks, professional
  reviews or safety prerequisites are missing.
- **Imagery licensing.** Consumer map tiles are never used for machine analysis. The imagery
  rights engine (`visualize`, `analyze`, `cache`, `embedInExports`, `redistribute`, `expiresAt`) is
  enforced in code at ingestion, inference, cache and PDF export.

## Background work

Durable jobs run on graphile-worker inside the same PostgreSQL database
([ADR 0003](adr/0003-postgres-backed-jobs-graphile-worker.md)). Because a job is inserted in the
same transaction as the business change, the job table doubles as a transactional outbox: no
email, webhook, PDF or vision request is ever sent for a change that rolled back.

## Storage and media

A `StorageAdapter` interface with two implementations
([ADR 0004](adr/0004-local-encrypted-storage-vs-s3.md)): `LocalEncryptedStorage` (AES-256-GCM
files under `apps/api/.data/objects`, short-lived HMAC-signed URLs served by the API) for
development and tests, and `S3Storage` (presigned PUT/GET, server-side encryption) for production.
Object keys are tenant-prefixed; uploads are deduplicated by SHA-256, MIME-sniffed with
`file-type`, size-limited and passed through a malware-scan adapter (a no-op in development that
honestly records `scanStatus: "not_scanned"`). Thumbnails and EXIF use `sharp`/`exifr`; EXIF GPS is
kept in a restricted field and stripped from shared copies.

## Web app and offline use

The web app is an installable PWA without a native app
([ADR 0008](adr/0008-pwa-without-native-app.md)): `app/manifest.ts`, original icons in
`public/icons`, and a hand-written `public/sw.js` that never caches tenant API responses. Drafts
survive reloads and partial connectivity through an IndexedDB outbox (`idb-keyval`) that replays
writes with their idempotency keys. Server state uses TanStack Query; maps use MapLibre GL with
licensed or visualization-only tile sources.

## Observability

Structured pino logs (pretty in development, JSON elsewhere) with credentials redacted and the
correlation id on every line. OpenTelemetry API hooks are in place; exporting is enabled by
`OTEL_EXPORTER_OTLP_ENDPOINT`. Health probes are not request-logged.

## Testing

- **Unit** (vitest): pure packages and API units with no external services
  (`npm run test:unit`). Every formula gets positive, negative, boundary and rounding tests.
- **API integration** (vitest, `integration` project): runs against `fieldline_test` only. The
  global setup refuses any database whose name does not end in `_test`, then applies migrations;
  files run serially with per-test cleanup.
- **Vision** (pytest).
- **Acceptance journeys** (Playwright, `apps/web/e2e`).
- Test names and code comments carry requirement IDs so the traceability matrix can be generated.

## Environments and delivery

Ports: web 3000, API 4000, dev IdP 4100, vision 4200, PostgreSQL 54329. CI
(`.github/workflows/ci.yml`) runs lint, typecheck, unit tests and build; API integration tests
against a `postgis/postgis:17-3.5` service container; pytest; and Playwright. The manual
`deploy.yml` workflow builds versioned artifacts for staging or production; it does not deploy
until the owner chooses hosting and configures environment secrets.
