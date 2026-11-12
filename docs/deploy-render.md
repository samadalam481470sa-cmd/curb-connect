# Deploying on Render

`render.yaml` deploys three resources in the Ohio region:

| Resource           | What it runs                                                                 |
| ------------------ | ---------------------------------------------------------------------------- |
| `curb-connect-db`  | PostgreSQL 17 with PostGIS (private network only)                            |
| `curb-connect-api` | The API. `apps/api/scripts/render-start.mjs` migrates, then starts it        |
| `curb-connect-web` | The Next.js app. It proxies `/v1/*` to the API, so the browser uses one site |

The app is used at `https://curb-connect-web.onrender.com`. It installs on a laptop, iPhone, iPad
and Android device from the browser.

## Database roles on managed Postgres

The API connects as `fieldline_app`, which never bypasses Row-Level Security. Cross-tenant platform
operations, such as creating a company, run as `fieldline_platform`.

Render does not give the database owner superuser. Only a superuser can create a BYPASSRLS role.
The migration runner (`src/db/migrator.ts`) handles this:

1. Before migrating, it creates `fieldline_platform` without BYPASSRLS.
2. After migrating, it adds one permissive policy, `fieldline_platform_all`, for that role on every
   table with Row-Level Security. Every tenant policy is permissive, so the platform role reaches
   the same rows BYPASSRLS would give it.
3. `fieldline_app` is unchanged and stays restricted.

The same policy is added to the job queue's private tables in the `graphile_worker` schema. That
library enables Row-Level Security on them without any policies. The job-queue install re-runs this
step, because those tables do not exist yet during the first migration.

On databases where the role has BYPASSRLS (local, CI), these steps do nothing.

### Testing managed-Postgres mode

The integration suite can run the API's platform path as a non-superuser owner, the same way it
runs on Render. Fixtures and cleanup keep using the superuser in `TEST_DATABASE_URL`.

1. Create a separate PostgreSQL cluster, so the `fieldline_*` roles do not already exist.
2. Create a login role with `CREATEROLE` and without `BYPASSRLS`, and a database ending in `_test`
   owned by it. Create the `postgis` extension as a superuser.
3. Migrate as that role: `TEST_DATABASE_URL=<that role> npx tsx src/db/migrate.ts --test`.
4. Give `fieldline_app` a login password.
5. Run `npm run test:integration` with `TEST_DATABASE_URL` set to the superuser,
   `TEST_PLATFORM_DATABASE_URL` set to the non-superuser owner, and `TEST_APP_DATABASE_URL` set to
   `fieldline_app`.

All 163 integration tests pass in this mode.

This was rehearsed on a fresh non-superuser PostgreSQL cluster. The platform role saw both test
companies. The app role, set to one company, saw only that company's rows. Its insert into another
company's rows was refused.

`render-start.mjs` then sets a login password for `fieldline_app` from the generated
`APP_DB_PASSWORD` and starts the API with `APP_DATABASE_URL`.

## Sign-in

Production has no stand-in identity provider. Sign-in needs a Microsoft Entra app registration.
Set these three variables on `curb-connect-api` together:

- `MICROSOFT_TENANT_ID`
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`

The registration's redirect URI is `https://curb-connect-web.onrender.com/v1/auth/callback/microsoft`.

## Free plan limits

- Free services sleep after inactivity. The first request wakes them in about a minute.
- The free database expires 30 days after creation unless it is upgraded.
- `STORAGE_DRIVER=local` writes uploads to the service disk. Free services have no persistent
  disk, so uploads are lost on restart. Set `STORAGE_DRIVER=s3` with a bucket for real use.
- Background jobs (`src/worker.ts`) are not deployed, because free plans have no background
  workers. Email notifications and queued tasks wait until a worker runs.
