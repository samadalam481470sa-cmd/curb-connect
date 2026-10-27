# ADR 0002: Fastify instead of NestJS for the API

- Status: Accepted
- Date: 2026-10-26
- Requirements: BE-071, BE-072, BE-073

## Context

The owner's handoff suggests "NestJS or another typed TypeScript API with rigorously defined
OpenAPI". The API must publish an OpenAPI document generated from the same schemas that validate
requests (BE-073), share those schemas with the web app (`packages/contracts`, zod), and keep
tenant isolation, idempotency and auditing explicit and reviewable. The team is small and the code
must stay easy to change in Cursor.

## Decision

Use **Fastify 5** with **zod** schemas via `fastify-type-provider-zod`, `@fastify/swagger`
(OpenAPI 3.1 at `/v1/openapi.json`) and `@fastify/swagger-ui` (`/v1/docs`). Each feature area is
an encapsulated Fastify plugin in `apps/api/src/modules/<name>/`, listed in
`src/modules/registry.ts`. Cross-cutting concerns (correlation id, problem+json errors, security
headers, cookies, rate limits) are registered once in `buildApp()`. Dependencies (config,
database) are Fastify decorations rather than a DI container.

## Consequences

- One schema definition drives runtime validation, TypeScript types and the OpenAPI document; the
  web app imports the same zod schemas, so contract drift is a type error.
- Plain functions and plugins instead of decorators and a DI container: less framework to learn,
  explicit control over transactions and RLS setup, and fast tests with `app.inject()`.
- We give up Nest's built-in module conventions, guards and interceptors; the equivalent structure
  (module folders, a policy check helper, a write pipeline) is our responsibility and documented
  in `docs/architecture.md`.
- Fastify encapsulation means a module cannot accidentally register hooks on another module.

## Revisit triggers

- The API grows to the point where several teams own modules and need enforced boundaries that
  plugins plus code review do not provide.
- A required capability (e.g. a specific protocol or integration) is only practical in another
  framework.
- `fastify-type-provider-zod` or `@fastify/swagger` stops tracking Fastify or zod major versions.
