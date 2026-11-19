# Regression test matrix

## 1. Measured baseline — phase 0 executed

Run on 19 November 2026 at commit `0f3bcc6`, in the Cloud sandbox (no root, no Docker access).
All four suites that this document previously listed as blocked have now been executed.

| Suite                   | Command                                 | Result                          | Evidence                                                                                                  |
| ----------------------- | --------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Unit (all 8 workspaces) | `npm run test:unit`                     | **604 tests, 70 files, exit 0** | 77 api · 218 web · 81 contracts · 71 geometry · 16 pdf · 45 pricing · 89 ui · 7 dev-idp                   |
| API integration         | `npm run test:integration`              | **177 tests, 16 files, exit 0** | includes `idor` (25), `security-review` (5), `auth` (31), `orgs-team` (28), `media` (13), `pipeline` (11) |
| Vision worker           | `python -m pytest` in `services/vision` | **29 tests, exit 0**            | Python 3.13.0 via `uv`, `requirements-dev.txt`                                                            |
| E2E journeys            | `npm run test:e2e`                      | **10 passed, exit 0**           | 5 specs × desktop-chromium and mobile-chromium                                                            |
| Migrations              | `npm run db:migrate`                    | **clean on a fresh database**   | 0000–latest applied in order, `db:migrate` then reports up to date                                        |

Migrated-database facts measured from the running instance: **104 tables**, **119 enums**,
**107 policies**, **94 tables with `relrowsecurity`**. `0001_core_schema.sql` itself still contains
the 88 tables and 112 enums the audit counted; later migrations added the rest.

### How the environment was built (repeatable, non-root)

The sandbox has no root, no working Docker socket and no PostgreSQL, so the suites were run against
locally assembled toolchains rather than skipped:

- **PostgreSQL 16.15 + PostGIS 3.4.2** unpacked from Ubuntu 24.04 packages with
  `apt-get --print-uris` + `dpkg-deb -x` into `/tmp/pgroot`; cluster initialised on port 54329 with
  the repository's real migrations. The extension control file needed the
  `postgis.control → postgis-3.control` symlink that `postgresql-common` would normally create.
- **Python 3.13** installed with `uv venv --python 3.13`; the worker's pinned requirements installed
  into that venv.
- **Chromium** via `npx playwright install chromium`, plus the missing shared libraries and a
  DejaVu font set extracted the same way (this container ships no fonts at all, which made every
  text node measure 0px tall until `FONTCONFIG_FILE` pointed at the extracted fonts).

Difference from CI to record honestly: CI runs `postgis/postgis:17-3.5`, this run used 16.15/3.4.2.
The migration set applied without modification, but the exact CI image was not reproduced.

### A failure that was environmental, not a regression

The first E2E run reported three failures (`sign-in`, `access`, `offline` headings hidden). The cause
was the missing font stack, not the application: a bare `<h1>` on a blank page also measured 0px and
`document.fonts.size` was 0. With fonts installed, all 10 E2E tests pass. This is recorded because the
"inventories must never present an unverified pass" rule cuts both ways — an environment defect must
not be reported as a product failure either.

## 2. Blueprint mandatory regression items (16)

Status from the executed suites above. **PASS** = asserted by a test that ran in this baseline.
**PARTIAL** = the feature exists and is exercised somewhere, but no automated test covers the claim as
worded. **UNRUN** = test exists but was not executed here.

| #   | Mandatory check                     | Reality                                                                                                  | Test                                                                  | Status   |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------- |
| 1   | Existing login works                | OIDC dev-provider flow                                                                                   | `test/platform/auth.int.test.ts` (31)                                 | **PASS** |
| 2   | Existing dashboard loads            | command-centre home renders                                                                              | `page.test.tsx`, `AppFrame.test.tsx`, E2E shell journeys              | **PASS** |
| 3   | Existing roofing page loads         | roof workspace is live; no page-level test                                                               | `navigation.test.ts` (gate only)                                      | PARTIAL  |
| 4   | Satellite imagery integration works | map-based roof tracing + footprint service exist; analysis contract abstains without a licensed provider | `roof-footprint.int.test.ts` (2), `roof-analysis.test.ts`             | PARTIAL  |
| 5   | Roof drawing works                  | client map editor; no automated canvas test                                                              | —                                                                     | PARTIAL  |
| 6   | Roof calculations correct           | geometry + pricing + roof API                                                                            | `basics`, `topology`, `engine`, `trades`, `roof-measurements.int` (9) | **PASS** |
| 7   | Curb module loads                   | curb workspace exists; maths unit-tested                                                                 | `arMeasureMath.test.ts` (3)                                           | PARTIAL  |
| 8   | Curb geometry correct               | geometry + calibration libs                                                                              | `curb-calibration`, `editor`                                          | **PASS** |
| 9   | Curb pricing correct                | pricing curb model                                                                                       | `engine.test.ts`, `trades.test.ts`                                    | **PASS** |
| 10  | Photo upload works                  | upload sessions, encrypted local storage, EXIF                                                           | `media.int.test.ts` (13)                                              | **PASS** |
| 11  | Manual measurement review works     | roof report approval/revisions tested; no review queue UI                                                | `roof-measurements.int.test.ts` (9)                                   | PARTIAL  |
| 12  | Project records load                | jobs + bidding API                                                                                       | `jobs-bidding.int.test.ts` (3), `pipeline.int.test.ts` (11)           | **PASS** |
| 13  | Customer records load               | customer job-status sharing tested; CRM module still a stub                                              | `job-customer-status.int.test.ts` (4)                                 | PARTIAL  |
| 14  | Mobile functionality available      | PWA manifest, service worker, offline outbox                                                             | `pwa.test.ts`, `outbox.test.ts`, E2E mobile project                   | **PASS** |
| 15  | Marketing site isolated             | `marketing-site/` now exists in-repo as a separate Vercel deployment                                     | —                                                                     | PARTIAL  |
| 16  | CI workflows function               | workflow files valid; CI itself not executed here                                                        | `.github/workflows/ci.yml`                                            | UNRUN    |

Score: **8 PASS, 7 PARTIAL, 1 UNRUN.** The previous audit's 5 "NO TEST" rows are gone: those
features either now have tests (roof, jobs, media) or are honestly partial.

## 3. Critical end-to-end scenarios (blueprint §14.3)

| Scenario                                                                                      | Blocking dependency                          | Status                                                                         |
| --------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ |
| A — Roofing lead → satellite → sketch → pitch → estimate → proposal                           | proposals, signatures, PDF export chain      | not runnable end to end                                                        |
| B — Curb photos → calibration → path → dimensions → checklist → preliminary estimate → review | curb HTTP surface, review queue              | not runnable end to end                                                        |
| C — Accept proposal → invoice → verified payment → dashboard update                           | payment provider not configured              | not runnable                                                                   |
| D — Two companies cannot see each other                                                       | RLS + composite FKs + restricted role        | **PASS** — `idor.int.test.ts` (25) green against `fieldline_app` (NOBYPASSRLS) |
| E — Offline field work syncs without duplicates                                               | outbox logic only, no field endpoints        | partial (unit only)                                                            |
| F — Duplicate payment webhook recognised once                                                 | idempotency infrastructure, no payment route | not runnable                                                                   |
| G — Unresolved utility verification blocks execution release                                  | risk/permit tables + gate matrix, no routes  | not runnable                                                                   |

Scenario D is the one that matters most for tenancy, and it is now evidence rather than a claim: the
suite connects as the restricted runtime role, so RLS is proven rather than bypassed.

## 4. Regression gates for every future change

1. `npm run test:unit` must stay green (**604 tests today**; the number may only grow).
2. Any change touching `packages/geometry` or `packages/pricing` additionally runs its full suite and
   adds a fixture for the changed formula.
3. Any change to a route, permission or table updates the matching inventory file in this folder in
   the same commit.
4. Any change to tenancy, sessions or RBAC re-runs `test/platform/{idor,security-review}.int.test.ts`
   against PostgreSQL **as the restricted role** — a passing unit suite is not evidence for these.
5. `test:integration` requires the database to be named `*_test`; the global setup refuses anything
   else, so a mistyped URL cannot run destructive tests against a real database.
6. No test may be deleted, skipped or weakened to make a change pass. If a test encodes behaviour
   that must change, the inventory and the blueprint requirement must change with it, and the reason
   must appear in the pull request.

## 5. Still missing (unchanged by this baseline)

- The CI image (`postgis/postgis:17-3.5`) was not reproduced locally; PG 16 was used instead.
- No automated test covers map/canvas drawing, the curb capture flow, or a full commercial chain.
- No performance, load, or restore-drill evidence exists.
- `axe-core` runs on policy pages and design-system primitives, not every route.
- Camera multi-device Playwright suite (`test:camera`) was not part of the phase-0 scope and was not
  executed.
