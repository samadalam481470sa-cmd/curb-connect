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

## Deploys do not start by themselves

The Blueprint and both services were created from the repository's public URL. Render deploys
services set up that way only on request. Its automatic deploys need a GitHub account connected to
Render ([Render docs: Deploying on Render](https://render.com/docs/deploy-a-commit)). A push to
`main` therefore does not redeploy either service. This was observed on 2026-11-12: five minutes
after a push, neither service had started a deploy.

To deploy, open each service in the Render Dashboard and choose "Manual Deploy", then "Deploy latest
commit". To turn on automatic deploys, connect a GitHub account to Render and link both services to
the repository through it.

## Uploads

`STORAGE_DRIVER=local` encrypts every upload with `STORAGE_ENCRYPTION_KEY`. The Blueprint marks it
`sync: false`, so it is entered once in the Render dashboard and never overwritten. Generate it
with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Without it the API starts, but every upload fails. `render-start.mjs` warns about this at boot.

## Background jobs

Free plans have no background workers, so `render-start.mjs` runs the job worker
(`dist/worker.js`) next to the API in the same instance unless `WORKER_INLINE=false` is set. It
is restarted if it exits. Invitations, notifications and member-removal jobs are processed within a
few seconds of being queued.

Emails are only sent when `SMTP_URL` and `MAIL_FROM` are set. Until then the worker records each
message under `MAIL_OUTBOX_DIR` and marks the notification as sent by the `dev-outbox` adapter.

## Free plan limits

- Free services sleep after 15 minutes without traffic. Waking takes about a minute, and Render
  holds incoming requests while a service wakes. The web app and the API sleep separately, so
  three things keep the first visit from failing:
  - `apps/web/src/instrumentation.ts` pings the API's health endpoint when the web server starts,
    so both services wake together.
  - `experimental.proxyTimeout` in `apps/web/next.config.ts` lets the `/v1` proxy wait two minutes
    for a waking API. The default is 30 seconds, which is shorter than the API's cold start.
  - `render-start.mjs` runs the built migrator (`dist/migrate.js`). Starting `tsx` took about 20
    seconds of every cold start on a free instance.
- The free database expires 30 days after creation unless it is upgraded. Upgrade it before that
  date or the data is deleted.
- Free services have no persistent disk, so uploads under `STORAGE_DRIVER=local` are lost on every
  restart and deploy. Set `STORAGE_DRIVER=s3` with a bucket (`S3_BUCKET`, `S3_REGION`, keys) for
  real use.
- One instance runs the API and the worker together. Move the worker to a Render background worker
  service (`startCommand: cd apps/api && node dist/worker.js`) once the plan allows it, and set
  `WORKER_INLINE=false` on the API.
