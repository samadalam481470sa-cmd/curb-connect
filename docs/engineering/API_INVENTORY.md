# API inventory

## 1. Conventions in force (do not change these to match a new blueprint)

Source: `apps/api/src/app.ts`, `apps/api/src/http/*`, `docs/architecture.md`.

| Convention          | Implementation                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base path           | `/v1`, JSON camelCase                                                                                                                                               |
| Typed schemas       | zod via `fastify-type-provider-zod`; OpenAPI 3.1 at `/v1/openapi.json`, UI at `/v1/docs`                                                                            |
| Module registration | one Fastify plugin per domain in `src/modules/<name>/index.ts`, registered only through `src/modules/registry.ts`                                                   |
| Errors              | `application/problem+json` `{ type, title, status, detail, code, correlationId, retryable, retryAfterSeconds?, errors? }`; thrown as `HttpProblem`                  |
| Correlation         | `X-Request-Id` accepted when 8–128 safe chars, else UUID; echoed, logged, written to audit                                                                          |
| Pagination          | cursor-based `{ items, nextCursor }`                                                                                                                                |
| Idempotency         | `Idempotency-Key` required on billing/order/estimate/proposal/invoice/payment POSTs; replay returns the stored response, same key with a different body returns 422 |
| Concurrency         | integer `revision` + `If-Match`, mismatch returns 412                                                                                                               |
| Write pipeline      | session → active membership → RBAC `can()` → zod → one transaction → `audit_events` → outbox job                                                                    |
| Tenant scope        | never from the client: `set_config('app.org_id', …)` inside the request transaction; `tenantTx()` helper                                                            |
| Auth                | first-party cookie session via Next rewrite; OIDC providers configured, not hardcoded                                                                               |
| Health              | `GET /v1/health` (liveness), `GET /v1/health/ready` (readiness), both unlogged                                                                                      |

## 2. Implemented endpoints (46)

See [ROUTE_INVENTORY.md §3](ROUTE_INVENTORY.md#3-api-routes-actually-served-46) for the full method +
path table. Distribution:

| Module        | Endpoints | File                             | Lines |
| ------------- | --------- | -------------------------------- | ----- |
| auth          | 5         | `modules/auth/index.ts`          | 321   |
| session       | 2         | `modules/session/index.ts`       | 105   |
| orgs          | 7         | `modules/orgs/index.ts`          | 428   |
| team          | 14        | `modules/team/index.ts`          | 1013  |
| flags         | 2         | `modules/flags/index.ts`         | 132   |
| audit         | 1         | `modules/audit/index.ts`         | 71    |
| media         | 5         | `modules/media/index.ts`         | 422   |
| storage       | 2         | `modules/storage/index.ts`       | 95    |
| notifications | 7         | `modules/notifications/index.ts` | 319   |
| admin         | 1         | `modules/admin/index.ts`         | 79    |

Total: 46 endpoints, ~3,000 lines of route code. These are the endpoints with tests in
`apps/api/test/platform/*` and `apps/api/src/*.test.ts`.

## 3. Stub modules (21)

| Module         | Intended surface                                                                                       | Schema file already present |
| -------------- | ------------------------------------------------------------------------------------------------------ | --------------------------- |
| `roof`         | roof orders, reports, geometry patch, takeoff                                                          | `db/schema/roof.ts`         |
| `curb`         | curb projects, observations, calibrations, segments, measurements, risk flags, permits, safety reviews | `db/schema/curb.ts`         |
| `properties`   | properties, structures, jurisdictions, service areas                                                   | `db/schema/properties.ts`   |
| `imagery`      | imagery candidates + rights engine                                                                     | `db/schema/imagery.ts`      |
| `pricebooks`   | price books, revisions, items, production rates                                                        | `db/schema/pricebooks.ts`   |
| `estimates`    | estimates, revisions, gating, approvals request                                                        | `db/schema/estimates.ts`    |
| `approvals`    | approval records, withdrawal                                                                           | `db/schema/approvals.ts`    |
| `crm`          | customers, contacts, leads, notes, tasks                                                               | `db/schema/crm.ts`          |
| `jobs`         | jobs, pipeline stages, crews, schedules, dispatch, supplier orders                                     | `db/schema/jobs.ts`         |
| `proposals`    | proposals, versions, options, selections                                                               | `db/schema/proposals.ts`    |
| `signatures`   | envelopes, events, adapter                                                                             | `db/schema/signatures.ts`   |
| `invoices`     | invoices + lines                                                                                       | `db/schema/invoices.ts`     |
| `payments`     | payments, provider webhooks, ledger                                                                    | `db/schema/payments.ts`     |
| `changeorders` | change orders                                                                                          | `db/schema/changeorders.ts` |
| `portal`       | homeowner portal routes                                                                                | `db/schema/portal.ts`       |
| `dashboard`    | KPI aggregation                                                                                        | `db/schema/dashboard.ts`    |
| `search`       | tenant-scoped global search                                                                            | `db/schema/search.ts`       |
| `billing`      | subscription, entitlements, usage ledger                                                               | `db/schema/billing.ts`      |
| `exports`      | PDF/CSV export jobs                                                                                    | `db/schema/exports.ts`      |
| `reviews`      | human review queues                                                                                    | `db/schema/reviews.ts`      |
| `vision`       | API → vision worker client                                                                             | `db/schema/vision.ts`       |

Each stub is:

```ts
const dashboardModule: FastifyPluginAsyncZod = async () => {};
export default dashboardModule;
```

with a doc comment naming its responsibility and schema file. **Implementing a stub means filling
that file**, not creating a second module with a different name.

## 4. Contract ownership

`packages/contracts/src/resources.ts` (169 exported schemas) is the DTO source of truth. Route
handlers must import from `@fieldline/contracts`, never redefine a shape locally. Two schemas in
`apps/web/src/lib/endpoints.ts` are explicitly marked as not yet in contracts (auth providers,
invitation preview, notification preference envelope) — moving them into contracts is a cleanup
task, not a blocker.

## 5. API work implied by the blueprint, in dependency order

1. `dashboard` + `search` (already-called by the web app; fixes two unavailable screens).
2. `properties` + `imagery` (needed by both roof and curb intake).
3. `roof` (orders → reports → geometry patch → takeoff → export).
4. `curb` (projects → observations → calibrations → segments → measurements → risk → permit → safety).
5. `pricebooks` → `estimates` → `approvals` (the gating chain).
6. `crm` → `jobs` → `proposals` → `signatures` → `invoices` → `payments` → `changeorders`.
7. `portal`, `reviews`, `exports`, `billing`, `vision`.

Blueprint endpoint families `POST /v1/curb/projects/{id}/measurements` etc. are compatible with this
layout; deliver them inside the existing module, preserving the conventions in §1.
