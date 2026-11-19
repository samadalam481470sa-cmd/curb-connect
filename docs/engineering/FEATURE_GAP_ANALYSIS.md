# Feature gap analysis

Blueprint scope versus repository reality at `c91a8cc`. Gap size is engineering effort for the
missing part only, assuming the existing schema, contracts and engines are reused: **S** ≤ 3 days,
**M** ≤ 2 weeks, **L** > 2 weeks.

Legend for "current state": `engine` = pure logic exists and is tested; `schema` = tables + DTOs +
enums exist; `http` = reachable over the API; `ui` = usable in the app; `none` = absent.

## 1. Blueprint volume coverage

| Volume | Subject                               | Current state                                                          | Gap                                                                           | Size |
| ------ | ------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---- |
| 1      | Architecture and product requirements | `docs/architecture.md`, 8 ADRs, product docs, 100-epic requirement set | Product docs for the new business modules only                                | S    |
| 2      | UI/UX and control specifications      | Design system (22 components), route registry, gate/announcer          | All product screens; control-ID registry; no `data-control-id` convention yet | L    |
| 3      | Roofing measurement                   | engine + schema + state machine + PDF template                         | `roof` HTTP module, canvas/editor UI, report viewer, exports                  | L    |
| 4      | Curb cutting                          | engine + schema + gating matrix                                        | `curb` HTTP module, capture/calibration/trace UI                              | L    |
| 5      | Calculations and material engine      | `packages/pricing` (roof takeoff + curb cost model), decimal money     | Material catalogue data, supplier comparison, waste policy UI                 | M    |
| 6      | AI and computer vision                | quality scoring + abstaining recognisers + registry                    | API client, review UI, document intelligence, assistant                       | L    |
| 7      | Projects, CRM, customers              | schema + contracts                                                     | `crm`/`jobs` routes, pipeline UI, duplicate detection, import/export          | L    |
| 8      | Estimates, proposals, contracts       | schema + contracts + pricing                                           | `pricebooks`/`estimates`/`proposals`/`signatures` routes + UI                 | L    |
| 9      | Invoicing, payments, accounting       | schema + enums + `stripe` dependency                                   | `invoices`/`payments` routes, webhook verification, ledger UI, AR aging       | L    |
| 10     | Scheduling and workforce              | `crews`, `schedules`, `dispatches` tables                              | routes + calendar UI, time tracking (no timesheet table), conflict detection  | L    |
| 11     | Supplier marketplace                  | `supplier_orders` table, flag off                                      | supplier directory, catalogues, quotes, POs, performance                      | L    |
| 12     | Inventory and equipment               | none (no inventory/equipment tables)                                   | full module, additive tables                                                  | L    |
| 13     | Field operations and mobile           | PWA, uploads, outbox, camera via input capture                         | field check-in/out, guided capture UI, offline conflict resolution UI         | L    |
| 14     | Documents and plans                   | media pipeline, attachments/contracts/export tables                    | document versioning UI, OCR, retention policy                                 | M    |
| 15     | Permits, safety, compliance           | permit/safety tables + gate matrix                                     | routes + checklist UI + jurisdiction rules loading                            | M    |
| 16     | Backend services and API contracts    | Fastify modular monolith, 46 endpoints, OpenAPI 3.1                    | fill 21 stubs; document every endpoint's contract fields                      | L    |
| 17     | Database and tenant isolation         | 104 tables migrated, RLS on 94, 107 policies, composite FKs, triggers  | schema drift check; retention/deprecation policy                              | M    |
| 18     | Integrations and providers            | adapters/seams only                                                    | provider selection then implementation per seam                               | L    |
| 19     | Analytics and reporting               | `export_records`, dashboard stub                                       | KPI queries, report builder, exports                                          | M    |
| 20     | Security and privacy                  | OIDC+PKCE, sessions, RBAC, RLS, audit, rate limit, helmet              | MFA claims, device management, malware scanning, fraud checks                 | M    |
| 21     | Testing and reliability               | 604 unit + 177 integration + 29 vision + 10 E2E tests, all green       | canvas/capture UI tests, performance/load, reliability drills, backups        | L    |
| 22     | Deployment and operations             | manual artifact workflow, logs, probes                                 | hosting decision, real deploy, backups/restore, monitoring, runbooks          | L    |

## 2. Roofing extension coverage (blueprint §4.1, items 1–40)

| Item  | Capability                                                                                    | Current state                            | Gap                                                              |
| ----- | --------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| 1     | Multiple building selection                                                                   | `structures` table                       | routes/UI                                                        |
| 2     | Multiple roof sections                                                                        | facets per report                        | UI                                                               |
| 3     | Individual facet management                                                                   | `packages/geometry` editor commands      | UI                                                               |
| 4     | Satellite imagery calibration                                                                 | rights engine only                       | provider + UI                                                    |
| 5     | Polygon editing                                                                               | geometry editor + command log            | UI                                                               |
| 6     | Edge snapping                                                                                 | not confirmed in `editor.ts`             | **verify before claiming**                                       |
| 7–11  | Ridge / valley / hip / gable / eave identification                                            | `RoofEdgeType` enum, `classify_edge` op  | manual classification UI; automatic detection is V2 and flag-off |
| 12    | Pitch entry                                                                                   | `PitchSchema`, pitch module              | UI                                                               |
| 13    | Pitch verification                                                                            | not implemented                          | manual review + evidence                                         |
| 14    | Slope-aware area                                                                              | `sloped = plan × √(1+(rise/run)²)`       | — (engine done)                                                  |
| 15    | Perimeter                                                                                     | edge totals                              | — (engine done)                                                  |
| 16    | Roof plane area                                                                               | facet areas                              | —                                                                |
| 17    | Total roof area                                                                               | totals schema                            | —                                                                |
| 18    | Squares conversion                                                                            | pricing units (100 ft²)                  | display                                                          |
| 19    | Waste allowance config                                                                        | `waste_policies` + engine (applied once) | routes/UI                                                        |
| 20–27 | Shingle, underlayment, ice/water, drip edge, ridge cap, flashing, valley, fastener quantities | generic takeoff lines in pricing         | material catalogue + named line mapping                          |
| 28    | Tear-off                                                                                      | pricing components                       | named rules                                                      |
| 29    | Disposal                                                                                      | curb has disposal; roofing path unclear  | explicit roof disposal rule                                      |
| 30    | Labour                                                                                        | pricing                                  | production-rate data                                             |
| 31    | Equipment                                                                                     | pricing                                  | production-rate data                                             |
| 32    | Material pricebooks                                                                           | `price_books*` schema                    | routes/UI                                                        |
| 33    | Supplier price comparison                                                                     | none                                     | supplier module                                                  |
| 34    | Low/base/high scenarios                                                                       | `ScenarioTotalsSchema` + engine          | routes/UI                                                        |
| 35    | Customer-facing quote                                                                         | proposal schema                          | routes/UI                                                        |
| 36    | Measurement confidence                                                                        | `ConfidenceLabel`, provenance vocab      | per-measurement confidence field use                             |
| 37    | Manual correction                                                                             | `measurement_overrides` (append-only)    | routes/UI                                                        |
| 38    | Measurement revision history                                                                  | `roof_report_versions` + lock trigger    | UI                                                               |
| 39    | PDF report                                                                                    | `packages/pdf/templates/roof-report.tsx` | wire to export job                                               |
| 40    | Customer approval                                                                             | proposal + signature schema              | routes/UI                                                        |

## 3. Curb extension coverage (blueprint §4.2)

| Group                             | Present                                                                                                                                                              | Missing                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Project capture (9 service types) | `curb_service_code` enum covers the taxonomy                                                                                                                         | intake wizard, service-type UI                                                               |
| Measurement                       | segments, measurements, calibrations, uncertainty in schema + geometry lib                                                                                           | routes/UI, revision history UI                                                               |
| Image intelligence                | photo-quality scoring; recognisers abstain by design; perspective/homography math in `packages/geometry`                                                             | API wiring, annotation UI, before/after view, curb-type classifier (needs a validated model) |
| Cost estimation                   | full cost model incl. mobilization, cutting, demolition, disposal, restoration, traffic, permits, minimum charges, overhead, contingency, tax, margin, low/base/high | price-book content per region, estimate UI                                                   |
| Site safety                       | `risk_flags`, `permit_requirements`, `safety_reviews` tables + 12-gate matrix                                                                                        | routes/UI, jurisdiction rule source, dispatch gating enforcement in `jobs`                   |

## 4. Shared business modules (blueprint §5)

| Module                 | Present                                                                                                                                                                                                              | Missing                                                                                  | Size |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---- |
| CRM                    | customers, contacts, leads, notes, tasks, tags field, duplicate hints in schema                                                                                                                                      | routes, UI, communication history, import/export, lifetime value                         | L    |
| Projects/jobs          | jobs, stage definitions, events, owners, priorities                                                                                                                                                                  | routes, board UI, budgets, milestones, dependencies, profitability                       | L    |
| Estimates/proposals    | estimates+revisions, scenarios, gating, proposals+versions+options, signature envelopes                                                                                                                              | routes, builders, PDF proposal template, e-sign adapter                                  | L    |
| Invoices/payments      | invoices+lines, payments+events, ledger, change orders                                                                                                                                                               | routes, numbering, deposits/progress billing, AR aging, webhook verification, statements | L    |
| Scheduling/workforce   | crews, crew_members, schedules, dispatches                                                                                                                                                                           | routes, availability, time tracking/timesheets, conflict detection                       | L    |
| Suppliers/procurement  | supplier_orders                                                                                                                                                                                                      | directory, catalogues, quotes, POs, approvals, performance                               | L    |
| Inventory/equipment    | none                                                                                                                                                                                                                 | all tables and UI                                                                        | L    |
| Documents              | media pipeline, attachments, contracts                                                                                                                                                                               | versioning, sharing, OCR, retention                                                      | M    |
| Additional trades (12) | Only roofing and curb engines exist (`packages/pricing/src/{roof,curb}.ts`); no plumbing, electrical, HVAC, concrete-volume, excavation, framing, drywall, painting, flooring, masonry, siding or landscaping engine | all 12 trade quantity engines plus a shared trade interface                              | L    |

## 5. What the blueprint assumes exists but does not

| Blueprint assumption                                         | Reality                                                  | Action                                                          |
| ------------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------- |
| `marketing-site/` in this repo                               | Present as static HTML, deployed separately to Vercel    | Leave it a separate deployment; do not merge it into `apps/web` |
| The contractor app already has a roofing/curb UI to preserve | Only schema, engines and a legacy prototype              | Build the UI additively; keep the legacy prototype untouched    |
| Next.js + Fastify + PostgreSQL/PostGIS + Python/FastAPI      | Matches the repository                                   | No framework change                                             |
| Microsoft Entra in production                                | OIDC built provider-neutral; Entra app not registered    | Owner action D-10                                               |
| Live supplier prices, payments, signatures                   | Not configured                                           | Adapters only; never fabricate                                  |
| 500,000-word documentation set                               | 100-epic requirement set exists; new volumes not written | Treat blueprint as specification, not as shipped docs           |

## 6. Acceptance tests each gap must carry

Every item above ships with, at minimum:

1. A unit test for the calculation or policy it introduces (fixtures, boundaries, rounding).
2. An API integration test proving tenant scoping, permission denial and revision conflict.
3. A UI test for loading, empty, error and permission-denied states.
4. A traceability entry: requirement ID → route → control → endpoint → table → audit event → tests.

Gaps without these are not "done", regardless of compilation.
