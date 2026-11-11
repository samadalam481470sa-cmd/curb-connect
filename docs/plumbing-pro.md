# Plumbing Pro (ConstructionOS module 10)

This repository now contains a working **release-1 estimating slice** of the Plumbing Pro
specification: a deterministic quantity engine, a fixture/pipe-run estimator screen, priced takeoff,
labour calculation and a printable preliminary proposal. It is a real, tested calculation tool — not
a claim that all 40 features are built. The estimating backbone is persisted: company-owned projects,
calibrated plan pages, immutable design revisions, server-computed estimates and audited approvals
live in the API database under tenant row-level security.

Open **Plumbing** in the signed-in app (route `/plumbing`, permission `plumbing:read`).

## What works

| Spec                                           | Delivered                                                                                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| PL-004 (fixture schedule, partial)             | Add/remove fixtures with quantity, live DFU/WSFU totals                                                                       |
| PL-009 (pipe and fitting library, partial)     | System, material, nominal size and stock-length catalog; material compatibility is not yet enforced                           |
| PL-011 (pipe length)                           | 3D centreline length in mm; printed as purchase metres                                                                        |
| PL-012 (fitting quantities, partial)           | Elbows from topology + field-verified count, couplings from stock sticks, tees from three-way endpoints                       |
| PL-013 (fixture demand, input only)            | Fixture-unit totals; no demand method is applied                                                                              |
| PL-016 (material takeoff)                      | Traceable, deterministically ordered takeoff; every line lists its source runs                                                |
| PL-017 (price catalog, minimal)                | Editable unit prices keyed by takeoff line; sample prices clearly marked                                                      |
| PL-018 (labour estimating)                     | Hours from production rates × quantities, priced at a burdened hourly rate                                                    |
| PL-019 (proposal, partial)                     | Deterministic totals with documented rounding, copy summary and print; no signature or PDF service                            |
| PL-002 (plan calibration, partial)             | Records the reference distance, measured pixels and derived `ft/px` for a plan page; binary upload/storage is not wired       |
| PL-001/004/009 (project + fixtures, persisted) | Projects, fixtures and runs are stored per company; another tenant gets 404                                                   |
| PL-010/016 (revisions, partial)                | Each save is an immutable numbered revision; estimates pin the revision they were computed from. No geometric diff viewer yet |
| PL-040 (approvals, partial)                    | Estimate approval is permissioned (`plumbing:approve`), audited, and blocked while lines are unpriced                         |

All maths lives in [`packages/contracts/src/plumbing.ts`](../packages/contracts/src/plumbing.ts) and is
covered by reference-case tests in `plumbing.test.ts` (12 m polylines, 5 % waste with 6 m sticks,
3-way tees, fixture-unit reconciliation, labour conversion, rounding).

### Documented rounding order (PL-019)

1. Direct costs add exactly in minor units: `material + labour + equipment`.
2. Contingency and overhead are each `round(direct × percent / 100)`.
3. Markup is `round((direct + contingency + overhead) × percent / 100)`.
4. Tax is `round(preTax × percent / 100)`; total is `preTax + tax`.

The same input therefore always produces the same total, and no step reuses a rounded intermediate
for two different calculations.

### Server records and permissions

| Route                            | Permission                         | What it stores                                                     |
| -------------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| `POST/GET /v1/plumbing/projects` | `plumbing:write` / `plumbing:read` | Project name and jurisdiction                                      |
| `GET /v1/plumbing/projects/:id`  | `plumbing:read`                    | Project with its plans, revisions and estimates                    |
| `POST …/plan`                    | `plumbing:write`                   | Reference distance and measured pixels; the server derives `ft/px` |
| `POST …/revisions`               | `plumbing:estimate`                | The next immutable revision of fixtures and runs                   |
| `POST …/estimates`               | `plumbing:estimate`                | Prices, inputs and server-recomputed totals pinned to a revision   |
| `POST …/estimates/:id/approve`   | `plumbing:approve`                 | Approval and an audit event; refused while any line is unpriced    |

The client sends inputs only — `ComputeEstimateRequestSchema` has no totals field — so stored totals
always come from the engine in `@fieldline/contracts`. The save panel reuses the project it already
created, so saving again appends a revision instead of creating a duplicate project.

## Not built (and not claimed)

- **Server records exist for the estimating backbone.** `/v1/plumbing/projects` (create, list,
  detail), `…/plan` (calibration), `…/revisions` (immutable design snapshots), `…/estimates`
  (server-computed, stored) and `…/estimates/:id/approve` (audited, refused while any line is
  unpriced) persist tenant-owned rows in `plumbing_projects`, `plumbing_plan_versions`,
  `plumbing_revisions` and `plumbing_estimates`, protected by the platform's tenant RLS policies.
  Binary plan files, design drawing, BIM, routing, revisions _of geometry edits_, procurement,
  field/service, portal, analytics, AI and integrations are still not implemented.
- **Still not built: binary plan upload and on-plan calibration UI (PL-002), fixture detection
  (PL-003), 2D/3D pipe editing (PL-006/007), routing (PL-008), geometric revision diffing (PL-010),
  supply sizing (PL-014), drainage review (PL-015), procurement (PL-020), field work (PL-021…025),
  service (PL-026…030), job costing (PL-031), change orders (PL-032), invoicing (PL-033), portal
  (PL-034), analytics (PL-035), AI/code assistants (PL-036/037), sensors (PL-038) and ERP integrations
  (PL-039).**
- **Approvals are a single recorded step.** `plumbing:approve` freezes one estimate, sets
  `approved_by`/`approved_at` and writes an audit event; there is no multi-role sign-off chain,
  signature capture or customer acceptance record.
- **No prices effective-dating or supplier import.** Unit prices are entered by hand.
- Offline editing, AutoCAD/IFC import, React Native, PostGIS, Three.js and FastAPI services from the
  specification are not part of this repository's stack and were not added.

## Honesty rules baked into the module

- Fixture units and labour productivity are labelled **sample planning values** in code, UI and this
  document. They are not a compliance claim; PL-013/014/015 require a jurisdiction-selected, reviewed
  method.
- Takeoff lines without a price are counted and surfaced; the screen states the proposal cannot be
  sent while any remain.
- The screen repeats, in the header and near the totals, that a licensed professional must review
  design, code compliance and final pricing.
- No AI is used to produce a quantity. Every number is a pure function of the inputs.

## Verification

```sh
npm run test:unit -w @fieldline/contracts   # engine reference cases
npm run typecheck
npm run lint
npm run build -w @fieldline/web
```

`npm run test:integration -w @fieldline/api` runs against a real PostgreSQL database with PostGIS:
`TEST_DATABASE_URL` is the owner connection used for fixtures/assertions and
`TEST_APP_DATABASE_URL` connects as the restricted `fieldline_app` role, so Row-Level Security is
exercised rather than bypassed. The Plumbing Pro suite (`test/platform/plumbing.int.test.ts`)
applies migration `0004` and then proves: forced RLS on all four tables, 404 for every cross-company
read or write, a database-level rejection of a cross-company insert, calibration storing the
measured pixels and the scale derived from exactly them, consecutive immutable revisions, totals
recomputed only on the server (a client-sent total is a 400), draft supersede behaviour, and the
approval rules — `plumbing:approve` required, unpriced lines refused, no second approval, and the
grand total written to the audit trail. CI runs this suite on every push in the `api-integration`
job against the `postgis/postgis:17-3.5` service; because migration `0002` creates `fieldline_app`
as `NOLOGIN`, the job enables it with a throwaway CI-only password so the tests connect as that
restricted role.
