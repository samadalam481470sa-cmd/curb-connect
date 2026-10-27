# legacy/

`curb-connect-v1/` is the previous version of this repository: a Vite + React single-page project
tracker with a small Python (FastAPI + SQLAlchemy) API. It has been **superseded** by the platform
in `apps/`, `packages/`, `services/` and `infra/` (see the root `README.md`).

It is kept only as a reference for past behavior and data shapes:

- It is **not** an npm workspace (`package.json` workspaces list only `apps/*`, `packages/*` and
  `infra/dev-idp`), so `npm install` at the root ignores it.
- It is excluded from ESLint, Prettier, TypeScript and every CI job.
- Do not import from it, extend it, or fix bugs in it. Port an idea into the new code instead,
  with tests.

To look at it in isolation, copy the folder somewhere else and follow its own README there; do
not run `npm install` inside this directory, which would create a second lockfile and
`node_modules` in the monorepo.

It may be deleted once nothing in it is needed for reference.
