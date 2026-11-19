# Engineering audit (repository preservation baseline)

This folder is the **repository audit and additive feature registry** required by the Curb Connect
master blueprint (§2.1, §18 step 1). It records what the repository actually contains at the audited
commit, so that later work extends the application instead of duplicating or replacing it.

Scope of this milestone: **audit and inventory only**. No product behaviour was changed, no routes,
tables, tests or workflows were removed, and no blueprint feature was implemented. The inventory is
the input to the implementation phases described in [MIGRATION_PLAN.md](MIGRATION_PLAN.md).

## Audit facts

| Item                                                      | Value                                                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Repository                                                | `samadalam481470sa-cmd/curb-connect`                                                         |
| Audited commit                                            | `c91a8cc` (`docs: add live Field Pro website and full-stack technology summary`)             |
| Working branch                                            | `freebuff/cb04db85235829e44956f913`                                                          |
| Tracked files (excluding `node_modules`, `.git`, `.vite`) | 507                                                                                          |
| Monorepo root                                             | `apps/*`, `packages/*`, `infra/dev-idp` (npm workspaces)                                     |
| Node / npm used for the baseline                          | Node v26.13.0, npm 11.20.0                                                                   |
| Phase-0 baseline (19 Nov 2026, `0f3bcc6`)                 | unit 604 · integration 177 · vision 29 · E2E 10 — all exit 0 (see REGRESSION_TEST_MATRIX.md) |
| Database used for integration                             | PostgreSQL 16.15 + PostGIS 3.4.2, assembled unprivileged (CI uses postgis:17-3.5)            |
| Python used for the vision suite                          | 3.13 via `uv` (the audit pass had no 3.13 and did not run pytest)                            |

### Documents

| Document                                                     | Purpose                                                                                                                                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [EXISTING_FEATURE_REGISTRY.md](EXISTING_FEATURE_REGISTRY.md) | Every existing feature with a permanent ID and status. The source of truth for "does it already exist?"                                                                 |
| [FEATURE_GAP_ANALYSIS.md](FEATURE_GAP_ANALYSIS.md)           | Blueprint scope versus reality, gap size, dependencies and acceptance tests.                                                                                            |
| [ROUTE_INVENTORY.md](ROUTE_INVENTORY.md)                     | Web routes, API routes and what each one really renders or serves.                                                                                                      |
| [COMPONENT_INVENTORY.md](COMPONENT_INVENTORY.md)             | Pages, feature views, shell components and the `packages/ui` design system.                                                                                             |
| [API_INVENTORY.md](API_INVENTORY.md)                         | The 46 implemented endpoints, conventions, and the 21 stub modules.                                                                                                     |
| [DATABASE_INVENTORY.md](DATABASE_INVENTORY.md)               | Schema: 88 tables in migration 0001, 104 in the migrated database; tenancy/RLS, append-only triggers, units and money.                                                  |
| [INTEGRATION_INVENTORY.md](INTEGRATION_INVENTORY.md)         | OIDC, storage, vision worker, jobs/outbox, mail, imagery, payments, signatures and what is unwired.                                                                     |
| [PERMISSION_MATRIX.md](PERMISSION_MATRIX.md)                 | Where authority lives, role mapping against the blueprint's proposed roles, enforcement points.                                                                         |
| [REGRESSION_TEST_MATRIX.md](REGRESSION_TEST_MATRIX.md)       | The measured phase-0 baseline (604 unit, 177 integration, 29 vision, 10 E2E tests passing) and every test gap, including the blueprint's 16 mandatory regression items. |
| [MIGRATION_PLAN.md](MIGRATION_PLAN.md)                       | Additive-only implementation sequence, per-phase entry/exit gates and rollback.                                                                                         |
| [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)       | Decisions taken during the audit and conflicts needing an owner decision.                                                                                               |
| [RELEASE_READINESS.md](RELEASE_READINESS.md)                 | The blueprint's 36-item tracker scored against evidence.                                                                                                                |

## Status vocabulary

The blueprint's four statuses are used unchanged, always about the **repository**, never about the
blueprint:

- `EXISTS_VERIFIED` — implemented and its behaviour was exercised during this audit.
- `EXISTS_NEEDS_IMPROVEMENT` — implemented and working, but incomplete or unverified in some respect.
- `PARTIALLY_IMPLEMENTED` — some layers exist (for example schema + contracts + pure engine) but the
  feature is not reachable or not usable end to end.
- `NOT_IMPLEMENTED` — nothing beyond an agreed placeholder.

Each row additionally carries a **verification** value so a missing test run is never reported as a
passing test:

- `unit` — covered by the executed baseline (`npm run test:unit`, 604 passing).
- `static` — read and confirmed in source, not executed.
- `unrun` — a test exists but was not executed in the environment where the row was written.
- `none` — no test exists.

## Rules for the next agent

1. Search the registry and the codebase before writing anything. If an ID exists, extend it.
2. Never rename `Field Pro` back to `Curb Connect` in code: the brand lives in
   `packages/contracts/src/brand.ts` and is referenced by routes, PDFs and the manifest.
3. Do not delete `legacy/curb-connect-v1`. It is the only surviving implementation of some
   measurement/estimate UI and is deliberately excluded from workspaces and CI.
4. `apps/web/AGENTS.md` applies to `apps/web`: this Next.js version differs from older conventions —
   read the bundled docs under `node_modules/next/dist/docs/` before writing app-router code.
5. Update the affected inventory in the same change that alters it. A route, endpoint, table or
   permission that is not in these files does not exist as far as traceability is concerned.
