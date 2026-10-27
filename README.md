# Fieldline

Fieldline is a multi-tenant platform for contractors with two first-class products:

- **Roof Measurements**: pick an address, confirm the building, sketch roof facets, enter pitch,
  check quantities, and produce a measurement report and quote.
- **Curb Cutting**: guided job-site photos, a calibrated reference, a corrected curb path, and an
  explicitly preliminary low/base/high estimate from contractor-managed regional price books, with
  hard gates for permits, right-of-way, unknown utilities and uncertain depth.

Both share customers, properties, proposals, signatures, invoices and payments. The product name
is defined once in [`packages/contracts/src/brand.ts`](packages/contracts/src/brand.ts).

> Status: foundation build. The repository skeleton, tooling, CI and API/web shells are in place;
> product features are implemented phase by phase and are shown as unavailable until verified.

## Architecture at a glance

| Part                    | Tech                                                                                                         | Port  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ | ----- |
| `apps/web`              | Next.js 16 App Router, React 19, installable PWA                                                             | 3000  |
| `apps/api`              | Fastify 5, zod, OpenAPI 3.1 (`/v1/openapi.json`, docs at `/v1/docs`), Drizzle + postgres.js, graphile-worker | 4000  |
| `infra/dev-idp`         | Stand-in OpenID Connect provider for local sign-in (dev/test only)                                           | 4100  |
| `services/vision`       | Python 3.13 FastAPI worker (photo quality; recognizers abstain)                                              | 4200  |
| PostgreSQL 17 + PostGIS | `fieldline_dev`, `fieldline_test`                                                                            | 54329 |
| `packages/*`            | `contracts` (zod DTOs), `pricing` (decimal.js), `geometry`, `ui`, `pdf`                                      | -     |

The browser talks only to the web app; `/v1/*` is proxied to the API so the session cookie stays
first-party. Details: [docs/architecture.md](docs/architecture.md) and the decision records in
[docs/adr/](docs/adr/). The previous app is kept, unused, in [legacy/](legacy/README.md).

## Local setup

Prerequisites: Node 24 (`.nvmrc`), npm 11, Python 3.13, and PostgreSQL 17 + PostGIS on port
54329 (either the portable install described below or Docker).

Run once, from the repository root (PowerShell shown; Git Bash equivalents work the same):

```powershell
# 1. JavaScript dependencies for every workspace
npm install

# 2. Database. On the Windows dev machine (portable Postgres, see below):
powershell -NoProfile -File infra\scripts\pg-start.ps1
#    Anywhere with Docker instead:
#    cp infra/.env.example infra/.env   # set the passwords
#    docker compose -f infra/docker-compose.yml --env-file infra/.env up -d

# 3. API settings: copy the example (never overwrite an existing one) and fill in DATABASE_URL,
#    TEST_DATABASE_URL, SESSION_SECRET and STORAGE_ENCRYPTION_KEY (generation commands are in it)
if (-not (Test-Path apps\api\.env.local)) { Copy-Item apps\api\.env.example apps\api\.env.local }

# 4. Vision worker virtual environment
& "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe" -m venv services\vision\.venv
services\vision\.venv\Scripts\python -m pip install -r services\vision\requirements-dev.txt

# 5. Schema and demo data
npm run db:migrate
npm run db:seed

# 6. Start web, API, dev IdP and vision worker together
npm run dev
```

Then open http://localhost:3000. The API is at http://localhost:4000/v1/health and its
interactive docs at http://localhost:4000/v1/docs.

On macOS/Linux the equivalents of steps 3-4 are:

```sh
[ -f apps/api/.env.local ] || cp apps/api/.env.example apps/api/.env.local
python3.13 -m venv services/vision/.venv
services/vision/.venv/bin/python -m pip install -r services/vision/requirements-dev.txt
```

`.env.local` files are git-ignored; only `.env.example` files are committed.

### Portable PostgreSQL on Windows (no Docker)

The Windows development machine runs PostgreSQL 17.11 + PostGIS 3.6 without an installer or
service:

| Item                             | Location                                                        |
| -------------------------------- | --------------------------------------------------------------- |
| Binaries (`psql`, `pg_ctl`, ...) | `%LOCALAPPDATA%\Programs\fieldline-pg\pgsql\bin`                |
| Data directory                   | `%LOCALAPPDATA%\fieldline-pg-data`                              |
| Log file                         | `%LOCALAPPDATA%\fieldline-pg.log`                               |
| Password for role `fieldline`    | `%LOCALAPPDATA%\fieldline-pg-pw.txt` (never commit or print it) |

Start/stop: `infra\scripts\pg-start.ps1` (no-op if already running) and `infra\scripts\pg-stop.ps1`.
The scripts need an execution policy that allows local scripts (e.g. `RemoteSigned`).

To reproduce it on another Windows machine: extract the PostgreSQL 17 Windows x64 binaries zip
into `%LOCALAPPDATA%\Programs\fieldline-pg` and add the matching PostGIS bundle; run
`initdb -D "%LOCALAPPDATA%\fieldline-pg-data" -U fieldline -A scram-sha-256 --pwfile=<file>`;
start it with `pg-start.ps1`; then `createdb -p 54329 -U fieldline fieldline_dev`, the same for
`fieldline_test`, and `CREATE EXTENSION postgis;` in both. With Docker, `infra/docker-compose.yml`
does all of this automatically (`postgis/postgis:17-3.5`, plus MinIO for S3-compatible storage).

## Everyday commands

| Command                          | What it does                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                    | Web, API, dev IdP and vision worker with live reload                                                             |
| `npm run lint`                   | ESLint across all workspaces                                                                                     |
| `npm run typecheck`              | TypeScript in every workspace                                                                                    |
| `npm test`                       | All tests, including API integration tests (needs the database)                                                  |
| `npm run test:unit`              | Tests that need no external services (what CI's node job runs)                                                   |
| `npm run test:integration`       | API tests against `fieldline_test` only                                                                          |
| `npm run test:vision`            | pytest for `services/vision`                                                                                     |
| `npm run test:e2e`               | Playwright journeys (build the web app first; install browsers once with `npx playwright install` in `apps/web`) |
| `npm run build`                  | Production builds (`apps/web` via Next.js, `apps/api` via tsup) and package type checks                          |
| `npm run db:migrate` / `db:seed` | Apply migrations / seed demo data to `DATABASE_URL`                                                              |
| `npm run db:reset:test`          | Wipe and re-migrate the test database (refuses any name not ending in `_test`)                                   |
| `npm run format`                 | Prettier                                                                                                         |

Next.js collects anonymous telemetry unless `NEXT_TELEMETRY_DISABLED=1` is set; CI sets it.

## Tests

- Unit tests (vitest) live next to the code (`*.test.ts[x]`).
- API integration tests are `*.int.test.ts`; vitest's global setup migrates `fieldline_test`
  before they run, and they never touch `fieldline_dev`.
- Python tests live in `services/vision/tests`.
- Acceptance journeys live in `apps/web/e2e` (Playwright).
- Test names carry blueprint requirement IDs (e.g. `CP-052-API: ...`).

## Requirements and traceability

The 100-page blueprint is the acceptance specification; each page is an epic with IDs
`STR-001..010`, `PLT-011..020`, `RF-021..030`, `RR-031..040`, `CV-041..050`, `CP-051..060`,
`OPS-061..070`, `BE-071..080`, `AIQ-081..090`, `LCH-091..100`, suffixed `-FE`, `-API`, `-QA` or
`-DOC`. Requirements will live in `docs/requirements/blueprint.yaml` and the generated matrix in
`docs/traceability.md` (see [docs/README.md](docs/README.md)). Reference the IDs in PR descriptions
(the template asks for them), test names and code comments.

## CI/CD

`.github/workflows/ci.yml` runs on every push and pull request: lint, typecheck, unit tests and
build; API integration tests against a PostGIS service container; pytest; and Playwright
(non-blocking until real journeys exist). `.github/workflows/deploy.yml` is a manual workflow that
builds versioned release artifacts for staging or production. It does not deploy anywhere until a
hosting provider is chosen and environment secrets are configured.
