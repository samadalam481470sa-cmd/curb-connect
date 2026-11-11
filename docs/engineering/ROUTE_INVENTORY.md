# Route inventory

Two route surfaces exist: the Next.js App Router pages in `apps/web/src/app`, and the Fastify
modules under `/v1` in `apps/api/src/modules`. The **declared** route registry in
`packages/contracts/src/routes.ts` is larger than what is rendered — a declared but unbuilt route is
listed here as _declared, not built_ so nothing pretends to exist.

## 1. Web pages (21 `page.tsx` files)

| Path                      | File                                            | Renders                                           | Real data?                                    | Status                |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------- | --------------------------------------------- | --------------------- |
| `/`                       | `src/app/page.tsx`                              | Public landing/redirect shell                     | no                                            | EXISTS_VERIFIED       |
| `/` (app group)           | `src/app/(app)/page.tsx`                        | Home dashboard                                    | `/v1/dashboard` — **stub, shows unavailable** | PARTIALLY_IMPLEMENTED |
| `/home`                   | `src/app/(app)/home/page.tsx`                   | Alias to home dashboard                           | same                                          | PARTIALLY_IMPLEMENTED |
| `/roof`                   | `src/app/(app)/roof/page.tsx`                   | `AreaPage` coming-soon statement                  | no                                            | NOT_IMPLEMENTED       |
| `/curb`                   | `src/app/(app)/curb/page.tsx`                   | `AreaPage` coming-soon statement                  | no                                            | NOT_IMPLEMENTED       |
| `/leads`                  | `src/app/(app)/leads/page.tsx`                  | `AreaPage` coming-soon statement                  | no                                            | NOT_IMPLEMENTED       |
| `/jobs`                   | `src/app/(app)/jobs/page.tsx`                   | `AreaPage` coming-soon statement                  | no                                            | NOT_IMPLEMENTED       |
| `/proposals`              | `src/app/(app)/proposals/page.tsx`              | `AreaPage` coming-soon statement                  | no                                            | NOT_IMPLEMENTED       |
| `/billing`                | `src/app/(app)/billing/page.tsx`                | `AreaPage` coming-soon statement                  | no                                            | NOT_IMPLEMENTED       |
| `/reports`                | `src/app/(app)/reports/page.tsx`                | `AreaPage` coming-soon statement                  | no                                            | NOT_IMPLEMENTED       |
| `/search`                 | `src/app/(app)/search/page.tsx`                 | `SearchView`                                      | `/v1/search` — **stub**                       | PARTIALLY_IMPLEMENTED |
| `/team`                   | `src/app/(app)/team/page.tsx`                   | `TeamView` (members, invites, roles, delegations) | yes, `/v1/team/*`                             | EXISTS_VERIFIED       |
| `/settings`               | `src/app/(app)/settings/page.tsx`               | `SettingsView` (org profile, versioned sections)  | yes, `/v1/orgs/*`                             | EXISTS_VERIFIED       |
| `/settings/notifications` | `src/app/(app)/settings/notifications/page.tsx` | `NotificationsView`                               | yes, `/v1/notifications/preferences`          | EXISTS_VERIFIED       |
| `/settings/price-books`   | `src/app/(app)/settings/price-books/page.tsx`   | `AreaPage` coming-soon statement                  | no                                            | NOT_IMPLEMENTED       |
| `/sign-in`                | `src/app/(public)/sign-in/page.tsx`             | `SignInView` (providers, Microsoft first)         | yes, `/v1/auth/providers`                     | EXISTS_VERIFIED       |
| `/access`                 | `src/app/(public)/access/page.tsx`              | `AccessView` (no membership / no workspace)       | yes                                           | EXISTS_VERIFIED       |
| `/invite/[token]`         | `src/app/(public)/invite/[token]/page.tsx`      | `InviteView` preview + accept                     | yes, `/v1/invitations/*`                      | EXISTS_VERIFIED       |
| `/select-workspace`       | `src/app/(public)/select-workspace/page.tsx`    | `SelectWorkspaceView`                             | yes, active-org switch                        | EXISTS_VERIFIED       |
| `/onboarding`             | `src/app/(public)/onboarding/page.tsx`          | `OnboardingWizard` (6 steps, resumes)             | yes, org creation + settings                  | EXISTS_VERIFIED       |
| `/offline`                | `src/app/(public)/offline/page.tsx`             | Offline fallback page                             | no                                            | EXISTS_VERIFIED       |
| not found                 | `src/app/not-found.tsx`                         | 404                                               | no                                            | EXISTS_VERIFIED       |

Layout and providers: `src/app/layout.tsx`, `providers.tsx` (TanStack Query), `(app)/layout.tsx`
(`AppFrame` + `RouteGate`), `service-worker-registration.tsx`.

## 2. Declared routes that are not built

`packages/contracts/src/routes.ts` declares detail and flow routes with permissions, flags, analytics
events and requirement IDs. The following have **no page file**:

| Route id                                                                                          | Path                           | Requirement            |
| ------------------------------------------------------------------------------------------------- | ------------------------------ | ---------------------- |
| `roof.new`                                                                                        | `/roof/new`                    | RF-021, PLT-017        |
| `roof.order`                                                                                      | `/roof/orders/:orderId`        | RF-021, RR-039         |
| `roof.report`                                                                                     | `/roof/reports/:reportId`      | RF-025, RR-036, RR-037 |
| `roof.report.editor`                                                                              | `/roof/reports/:reportId/edit` | RF-023, RR-032         |
| further `curb.*`, `estimate.*`, `proposal.*`, `invoice.*`, `job.*` detail routes in the same file | —                              | various                |

Adding a page for one of these is _additive_: do not change the registry entry's id, path,
permission or requirement IDs.

## 3. API routes actually served (46)

All are under the `/v1` prefix. Each module is a Fastify plugin registered by
`apps/api/src/modules/registry.ts`, in its own encapsulation context.

| Module        | Method + path                                        | Purpose                                                                 |
| ------------- | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| auth          | `GET /v1/auth/providers`                             | configured providers, dev-only flagged                                  |
| auth          | `GET /v1/auth/login/:provider`                       | start OIDC code+PKCE flow                                               |
| auth          | `GET /v1/auth/link/:provider`                        | link an additional identity                                             |
| auth          | `GET /v1/auth/callback/:provider`                    | callback, session creation                                              |
| auth          | `POST /v1/auth/logout`                               | revoke session                                                          |
| session       | `GET /v1/me`                                         | user, active org, role, permissions, flags, memberships, session expiry |
| session       | `POST /v1/session/active-org`                        | switch workspace (membership re-checked)                                |
| orgs          | `POST /v1/orgs`                                      | create organisation (idempotent)                                        |
| orgs          | `GET /v1/orgs`                                       | list memberships' organisations                                         |
| orgs          | `GET /v1/orgs/current`                               | active organisation profile                                             |
| orgs          | `PATCH /v1/orgs/current`                             | update profile (`If-Match`)                                             |
| orgs          | `GET /v1/orgs/current/settings`                      | settings envelope + revision                                            |
| orgs          | `PUT /v1/orgs/current/settings/:section`             | versioned section write (`If-Match`)                                    |
| orgs          | `GET /v1/orgs/current/settings/revisions`            | settings history                                                        |
| team          | `GET /v1/team/members`                               | list members                                                            |
| team          | `GET /v1/team/members/:id`                           | member detail                                                           |
| team          | `PATCH /v1/team/members/:id`                         | role/status/title change (`If-Match`)                                   |
| team          | `POST /v1/team/members/:id/deactivate`               | deactivate membership                                                   |
| team          | `POST /v1/team/transfer-ownership`                   | owner-only transfer                                                     |
| team          | `POST /v1/team/invitations`                          | create invitation                                                       |
| team          | `GET /v1/team/invitations`                           | list invitations                                                        |
| team          | `POST /v1/team/invitations/:id/revoke`               | revoke                                                                  |
| team          | `POST /v1/team/invitations/:id/resend`               | resend                                                                  |
| team          | `POST /v1/invitations/preview`                       | unauthenticated token preview (token in body)                           |
| team          | `POST /v1/invitations/accept`                        | accept invitation                                                       |
| team          | `GET /v1/team/delegations`                           | approval delegations                                                    |
| team          | `POST /v1/team/delegations`                          | create delegation                                                       |
| team          | `POST /v1/team/delegations/:id/revoke`               | revoke delegation                                                       |
| flags         | `GET /v1/flags`                                      | resolved flags for the active org/jurisdiction                          |
| flags         | `PUT /v1/flags/:key`                                 | override a flag                                                         |
| audit         | `GET /v1/audit-events`                               | audit query                                                             |
| media         | `POST /v1/media/uploads`                             | create upload session (idempotent)                                      |
| media         | `POST /v1/media/uploads/:uploadId/complete`          | finalise, sniff, dedupe                                                 |
| media         | `GET /v1/media`                                      | list media metadata                                                     |
| media         | `GET /v1/media/:id`                                  | media detail                                                            |
| media         | `GET /v1/media/:id/content`                          | stream/subject to signed URL                                            |
| storage       | `PUT /v1/storage/upload/:token`                      | local adapter upload                                                    |
| storage       | `GET /v1/storage/object/:token`                      | local adapter download                                                  |
| notifications | `GET /v1/notifications`                              | inbox                                                                   |
| notifications | `POST /v1/notifications/:id/read`                    | mark read                                                               |
| notifications | `POST /v1/notifications/read-all`                    | mark all read                                                           |
| notifications | `GET /v1/notifications/preferences`                  | category × channel grid                                                 |
| notifications | `PUT /v1/notifications/preferences`                  | update preferences                                                      |
| notifications | `GET /v1/notifications/delivery-failures`            | failed deliveries                                                       |
| notifications | `POST /v1/notifications/delivery-failures/:id/retry` | retry delivery                                                          |
| admin         | `GET /v1/admin/queue`                                | platform support queue                                                  |

Non-route surfaces: `GET /v1/health`, `GET /v1/health/ready`, `GET /v1/openapi.json`,
`GET /v1/docs`.

Vision worker (separate service, port 4200): `GET /health`, `GET /v1/health`, `GET /v1/version`,
`POST /v1/photo-quality`, `POST /v1/curb/recognize`, `POST /v1/roof/detect`.

## 4. Stub modules (21) — registered, no routes

`approvals`, `billing`, `changeorders`, `crm`, `curb`, `dashboard`, `estimates`, `exports`,
`imagery`, `invoices`, `jobs`, `payments`, `portal`, `pricebooks`, `properties`, `proposals`,
`reviews`, `roof`, `search`, `signatures`, `vision`.

Each file is an 11-line plugin with the comment `Stub: no routes yet` and a pointer to its schema
file. **Consequence:** the web pages that call `/v1/dashboard` and `/v1/search` receive 404s and
render their unavailable state; every "not implemented" area page is honest about it.

## 5. Navigation registry (declared)

Ten primary areas, in registry order (`PRIMARY_ROUTES`): Home, Roof Measurements, Curb Cutting,
Leads, Jobs, Proposals, Billing, Reports, Team, Settings. Roof and Curb are adjacent, immediately
after Home, on every breakpoint — a deliberate product invariant (PLT-011 A). Four destinations are
flagged for the phone bottom bar (Home, Roof, Curb, Jobs, Settings → the first five eligible).

No blueprint `NAV-*` control can be added by deleting a registry entry. Adding navigation means
adding a `RouteDefinition` (or a settings route) plus its page.
