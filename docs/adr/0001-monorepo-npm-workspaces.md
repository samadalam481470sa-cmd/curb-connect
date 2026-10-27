# ADR 0001: One monorepo with npm workspaces

- Status: Accepted
- Date: 2026-10-26
- Requirements: BE-071, BE-072, LCH-097

## Context

The platform has a web app, an API, a Python vision worker, a stand-in identity provider and
several pure libraries (contracts, pricing, geometry, UI, PDF) that must stay in lockstep: a
change to a DTO or a pricing rule has to land in the API, the web app and the PDF templates in the
same reviewed change. The owner wants the existing `curb-connect` GitHub repository reused, the
code fully editable in Cursor, and changes shipped through GitHub CI/CD. The machine used for
development is Windows with Node 24 and npm; pnpm and Docker are not installed.

## Decision

- One repository. The previous app moves to `legacy/curb-connect-v1/` and is excluded from
  workspaces, lint and CI.
- npm workspaces (`apps/*`, `packages/*`, `infra/dev-idp`) with a single `package-lock.json`.
  No pnpm, Turborepo or Nx for now.
- Internal packages are consumed as TypeScript source (`"exports": { ".": "./src/index.ts" }`),
  so there is no package build step and no stale `dist/` to forget. Next.js compiles them via
  `transpilePackages`; the API runs them through `tsx` in development and `tsup` bundles them
  (and only them) into `apps/api/dist` for production.
- One shared `tsconfig.base.json` (strict, ES2023, `moduleResolution: Bundler`), one root ESLint
  flat config, one Prettier config. Root scripts fan out to workspaces
  (`npm run build|typecheck|test --workspaces --if-present`).
- The Python worker lives in `services/vision` with its own virtual environment and pinned
  requirements; root scripts call it through `infra/scripts/run-vision.mjs`.

## Consequences

- One `npm ci` installs everything; one PR can change a contract and all its consumers.
- Source-consumed packages mean every consumer type-checks the package source with its own
  tsconfig, so packages must stay compatible with the strictest consumer settings.
- Root `npm run build` type-checks each library (their `build` script is `tsc --noEmit`) and
  produces real artifacts only for `apps/api` and `apps/web`.
- npm has no task graph cache: full-repo runs re-run everything. Acceptable at the current size.
- tsup is in maintenance mode upstream; it is a thin, replaceable build step.

## Revisit triggers

- CI time for the `node` job regularly exceeds ~10 minutes: add a task runner with caching
  (Turborepo or Nx) on top of the same workspaces.
- A package must be published or consumed outside this repository: give it a compiled build.
- tsup stops working with a supported Node or TypeScript release: switch the API bundle to tsdown
  or plain esbuild.
