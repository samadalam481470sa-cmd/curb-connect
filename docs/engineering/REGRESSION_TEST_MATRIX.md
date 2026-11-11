# Regression test matrix

## 1. Measured baseline (this audit)

Command: `npm run test:unit` at commit `c91a8cc`, Node v26.13.0, after `npm ci`.

| Workspace                                                                | Test files | Tests | Result                  |
| ------------------------------------------------------------------------ | ---------- | ----- | ----------------------- |
| (8 workspaces: api, contracts, geometry, pdf, pricing, ui, web, dev-idp) | 30         | 337   | **all passing, exit 0** |

This is the only executed evidence in this audit. It is a real green baseline for pure logic,
parsing, rendering and policy.

### Not run, and why

| Suite                                                                          | Command                                              | Blocker                                                            |
| ------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------ |
| API integration (incl. RLS, IDOR, media, auth, notifications worker, pipeline) | `npm run test:integration`                           | no PostgreSQL/PostGIS in the audit environment (`psql` absent)     |
| Database schema/integrity tests                                                | `vitest` integration project                         | same                                                               |
| Vision worker                                                                  | `npm run test:vision`                                | Python 3.13 required, 3.12.3 available; dependencies not installed |
| Playwright journeys                                                            | `npm run test:e2e`                                   | browsers not installed; web build not produced                     |
| Lint / typecheck / build                                                       | `npm run lint`, `npm run typecheck`, `npm run build` | not executed in this audit (documentation-only change)             |

Reporting any of these as passing would be false. They are the first gate of phase 0 in
[MIGRATION_PLAN.md](MIGRATION_PLAN.md).

## 2. Test files that exist (44, excluding `legacy/`)

| Area                     | Files                                                                                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API units                | `app.test.ts`, `config.test.ts`, `security-probes.test.ts`                                                                                                                       |
| API schema               | `db/schema.int.test.ts`, `test/database.int.test.ts`                                                                                                                             |
| API platform integration | `test/platform/{auth,idor,media,notifications-worker,orgs-team,pipeline,security-review}.int.test.ts`                                                                            |
| Web                      | `app/page.test.tsx`, `components/shell/AppFrame.test.tsx`, `features/team/TeamView.test.tsx`, `lib/{api,format,navigation}.test.ts`, `lib/offline/outbox.test.ts`, `pwa.test.ts` |
| Web e2e                  | `e2e/home.spec.ts` (5 cases, non-blocking in CI)                                                                                                                                 |
| Contracts                | `index.test.ts`, `machines.test.ts`, `rbac.test.ts`, `resources.test.ts`                                                                                                         |
| Geometry                 | `basics.test.ts`, `topology.test.ts`, `editor.test.ts`, `curb-calibration.test.ts`, `index.test.ts`                                                                              |
| Pricing                  | `engine.test.ts`, `trades.test.ts`, `index.test.ts`                                                                                                                              |
| PDF                      | `index.test.tsx`                                                                                                                                                                 |
| UI                       | `tokens.test.ts`, `components/{inputs,overlays,display}.test.tsx`, `VisuallyHidden.test.tsx`                                                                                     |
| Dev IdP                  | `src/index.test.ts`                                                                                                                                                              |
| Vision                   | `tests/test_{health,photo_quality,registry,service}.py`                                                                                                                          |

## 3. Blueprint mandatory regression items (16)

Status: **PASS** = covered by the executed unit baseline; **UNRUN** = test exists, needs services;
**NO TEST** = the feature it would protect does not exist.

| #   | Mandatory check                     | Reality                                                  | Test                                        | Status                      |
| --- | ----------------------------------- | -------------------------------------------------------- | ------------------------------------------- | --------------------------- |
| 1   | Existing login works                | OIDC dev-provider flow implemented                       | `test/platform/auth.int.test.ts` (24 cases) | UNRUN                       |
| 2   | Existing dashboard loads            | page renders; `/v1/dashboard` is a stub                  | `page.test.tsx`, `AppFrame.test.tsx`        | PASS (rendering only)       |
| 3   | Existing roofing page loads         | coming-soon gate only                                    | `navigation.test.ts`                        | PASS (gate only)            |
| 4   | Satellite imagery integration works | no provider exists                                       | —                                           | NO TEST                     |
| 5   | Roof drawing works                  | no canvas in the app                                     | —                                           | NO TEST                     |
| 6   | Roof calculations correct           | geometry/pricing engines                                 | `basics`, `topology`, `engine`, `trades`    | PASS                        |
| 7   | Curb module loads                   | coming-soon gate only                                    | `navigation.test.ts`                        | PASS (gate only)            |
| 8   | Curb geometry correct               | geometry + calibration libs                              | `curb-calibration`, `editor`                | PASS                        |
| 9   | Curb pricing correct                | pricing curb model                                       | `engine.test.ts`, `trades.test.ts`          | PASS                        |
| 10  | Photo upload works                  | upload sessions + local encrypted storage                | `test/platform/media.int.test.ts`           | UNRUN                       |
| 11  | Manual measurement review works     | review tables + contracts only                           | —                                           | NO TEST                     |
| 12  | Project records load                | no project/job routes                                    | —                                           | NO TEST                     |
| 13  | Customer records load               | no CRM routes                                            | —                                           | NO TEST                     |
| 14  | Mobile functionality available      | PWA manifest, SW, offline outbox                         | `pwa.test.ts`, `outbox.test.ts`             | PASS (static/offline logic) |
| 15  | Marketing site isolated             | no marketing site in repo                                | —                                           | PASS (by absence)           |
| 16  | CI workflows function               | workflow files valid; last CI result not observable here | `ci.yml`, `deploy.yml`                      | UNRUN                       |

Score: 7 PASS, 4 UNRUN, 5 NO TEST. The "NO TEST" rows correspond to `NOT_IMPLEMENTED` registry
entries, not to broken features.

## 4. Critical end-to-end scenarios (blueprint §14.3)

| Scenario                                                                                      | Blocking dependency                                                          | Status                                             |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------- |
| A — Roofing lead → satellite → sketch → pitch → estimate → proposal                           | properties, imagery, roof, pricebooks, estimates, proposals, signatures, PDF | not runnable                                       |
| B — Curb photos → calibration → path → dimensions → checklist → preliminary estimate → review | curb, media, vision wiring, pricebooks, estimates, reviews                   | not runnable                                       |
| C — Accept proposal → invoice → verified payment → dashboard update                           | proposals, signatures, invoices, payments, dashboard                         | not runnable                                       |
| D — Two companies cannot see each other                                                       | RLS + composite FKs exist; `idor.int.test.ts` exists                         | **test exists, unrun** — highest-value early check |
| E — Offline field work syncs without duplicates                                               | outbox with idempotency keys exists; no field capture UI                     | partial (logic only)                               |
| F — Duplicate payment webhook recognised once                                                 | idempotency infrastructure exists; no payment route                          | not runnable                                       |
| G — Unresolved utility verification blocks execution release                                  | risk flags/permit tables + gate matrix exist; no routes                      | not runnable                                       |

## 5. Regression gates for every future change

1. `npm run test:unit` must stay green (337 tests today; the number may only grow).
2. Any change touching `packages/geometry` or `packages/pricing` additionally runs its full suite and
   adds a fixture for the changed formula.
3. Any change to a route, permission or table updates the matching inventory file in this folder in
   the same commit.
4. Any change to tenancy, sessions or RBAC re-runs `test/platform/{idor,security-review}.int.test.ts`
   against PostgreSQL — a passing unit suite is not evidence for these.
5. No test may be deleted, skipped or weakened to make a change pass. If a test encodes behaviour
   that must change, the inventory and the blueprint requirement must change with it, and the reason
   must appear in the pull request.

## 6. Missing test infrastructure to add (additive)

- A disposable PostGIS service for local integration runs (the CI service container already defines
  the right image and port).
- Playwright browsers installed in CI (already in the workflow) and one real journey replacing the
  home smoke test once flows exist.
- A schema drift check comparing drizzle schema to migrations.
- Visual/axe accessibility checks for the design system (the tokens test covers contrast only).
