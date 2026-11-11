# Volume 2 — UI, screens, controls and interaction contracts

**Status:** first edition (2026-11-11). Covers every route in the route registry plus the public
screens and the homeowner portal. Read [master-engineering-directive.md](master-engineering-directive.md)
first; it governs this volume.

**Scope of this edition:** screen inventory, per-screen layout and states, a permanent control
registry with behaviour and connection contracts, the API catalogue those contracts reference, and
the test/traceability obligations. It does not contain visual design comps, copy decks, or the
component API reference (Volume 3).

**Authorities:** routes [`packages/contracts/src/routes.ts`](../../packages/contracts/src/routes.ts),
permissions [`rbac.ts`](../../packages/contracts/src/rbac.ts), flags
[`flags.ts`](../../packages/contracts/src/flags.ts), client paths
[`apps/web/src/lib/endpoints.ts`](../../apps/web/src/lib/endpoints.ts), handlers
[`apps/api/src/modules/`](../../apps/api/src/modules/).

## 1. Reading this volume

### 1.1 Control IDs

`<AREA>-UI-<NNN>` where AREA is one of `PLT` (platform, shell, auth, team, settings, search),
`RF` (roof), `CV` (curb), `OPS` (leads, customers, jobs, proposals, billing, portal),
`AIQ` (reports and analytics), `CP` (price books and curb pricing). IDs are permanent. Deleting a
control retires its ID; the number is never reused. New controls take the next free number in the
area block, not the next number in the screen.

### 1.2 Contract notation

| Notation                | Meaning                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `GET /v1/…` **live**    | Handler exists in an `apps/api` module registered in `modules/registry.ts`.                                    |
| `GET /v1/…` **planned** | No handler yet. The path is a proposal owned by the named module; it must be added to the registry before use. |
| `local-only`            | No server call by design (display preference, unsaved draft, device capability).                               |
| `API live / UI planned` | The endpoint exists, but the control that will use it is not built.                                            |

A control whose contract is planned is itself `planned`; the UI must not ship it as working.

### 1.3 Status values

`implemented` · `partial` · `planned` · `blocked_vendor` · `blocked_owner`, as defined in the
library index. `partial` means the screen renders honestly but lacks its data contract.

## 2. Global interaction rules

1. **Gate before render.** Every signed-in page is wrapped in `RouteGate`; it checks the registry
   permission and the org feature flag, then renders either the page, a denial explanation, or a
   flag-off explanation. Table row links to a denied detail route show the same explanation.
2. **Denied, not hidden, inside a page.** Buttons the role cannot use remain visible with a lock
   and a plain reason (`GuardedButton`, PLT-015 A). The API independently enforces the rule.
3. **Honest empty.** A screen with no records says what will appear and when; it never shows sample
   customers, fake counts, or illustrative measurements (STR-005).
4. **Errors are actionable.** Inline `ErrorNotice` with title, detail, field errors, correlation id,
   and a retry only when the error is retryable (BE-073). No raw stack traces.
5. **Every mutation confirms.** Optimistic UI is not used for money, approvals, or geometry.
   Success is announced by toast or live region; failures keep the form state.
6. **Concurrency is explicit.** Editable versioned records send `If-Match: <revision>`. A 412
   reloads the record and tells the user their edit was not saved (PLT-014 R).
7. **Units and money are display-only conversions.** Values are stored in SI and minor currency
   units; a display preference never mutates stored data (PLT-019 A).
8. **Keyboard and focus.** Route changes move focus to the page heading (`tabIndex=-1`), the route
   announcer reads the new page, and every dialog traps focus and closes on Escape.
9. **Phone parity.** Any control needed to complete a flow is reachable on a phone either on the
   page or through the menu sheet; at most five destinations sit in the bottom bar.
10. **Idempotency.** Creates that can be double-submitted send an `Idempotency-Key`; the button
    disables while pending and re-enables only on a definite failure.
11. **Audit.** Approvals, issues, voids, role changes, transfers, payments, and overrides produce an
    audit event in the same transaction as the change.
12. **No dead ends.** Every empty, error, and denied state offers a next step (retry, back, request
    access, choose another workspace).

## 3. Screen inventory

`Status` is the screen, not the whole feature. Requirement IDs cite the owning epic; the full list
is in `docs/requirements/blueprint.yaml`.

| Screen ID                 | Route ID                 | Path                                              | Permission                        | Flag                   | Requirements           | Status      |
| ------------------------- | ------------------------ | ------------------------------------------------- | --------------------------------- | ---------------------- | ---------------------- | ----------- |
| `PLT-signed-in-shell`     | —                        | all signed-in pages                               | session + route permission        | —                      | PLT-011, PLT-015       | implemented |
| `PLT-home`                | `home`                   | `/`                                               | `dashboard:read`                  | —                      | PLT-011, PLT-016       | partial     |
| `RF-01`                   | `roof`                   | `/roof`                                           | `roof_order:read`                 | `roof.orders`          | RF-021                 | planned     |
| `CV-01`                   | `curb`                   | `/curb`                                           | `curb_project:read`               | `curb.projects`        | CV-042                 | planned     |
| `OPS-01`                  | `leads`                  | `/leads`                                          | `lead:read`                       | `crm.leads`            | OPS-061                | planned     |
| `OPS-02`                  | `jobs`                   | `/jobs`                                           | `job:read`                        | `crm.jobs`             | OPS-062                | planned     |
| `OPS-03`                  | `proposals`              | `/proposals`                                      | `proposal:read`                   | `proposals`            | OPS-063                | planned     |
| `OPS-04`                  | `billing`                | `/billing`                                        | `invoice:read`                    | `billing.invoices`     | OPS-068                | planned     |
| `AIQ-01`                  | `reports`                | `/reports`                                        | `analytics:read`                  | —                      | AIQ-088                | planned     |
| `PLT-team`                | `team`                   | `/team`                                           | `team:read`                       | —                      | PLT-015                | implemented |
| `PLT-settings`            | `settings`               | `/settings`                                       | `org:read`                        | —                      | PLT-014, PLT-019       | implemented |
| `RF-02`                   | `roof.new`               | `/roof/new`                                       | `roof_order:create`               | `roof.orders`          | RF-021, PLT-017        | planned     |
| `RF-03`                   | `roof.order`             | `/roof/orders/:orderId`                           | `roof_order:read`                 | —                      | RF-021, RR-039         | planned     |
| `RF-04`                   | `roof.report`            | `/roof/reports/:reportId`                         | `roof_report:read`                | —                      | RF-025, RR-036, RR-037 | planned     |
| `RF-05`                   | `roof.report.editor`     | `/roof/reports/:reportId/edit`                    | `roof_report:edit_geometry`       | `roof.diy_canvas`      | RF-023, RR-032         | planned     |
| `RF-06`                   | `roof.review_queue`      | `/roof/review`                                    | `review_task:read`                | `roof.assisted_review` | RR-033, AIQ-086        | planned     |
| `CV-02`                   | `curb.new`               | `/curb/new`                                       | `curb_project:write`              | `curb.projects`        | CV-042                 | planned     |
| `CV-03`                   | `curb.project`           | `/curb/projects/:projectId`                       | `curb_project:read`               | —                      | CV-042, CV-050         | planned     |
| `CV-04`                   | `curb.capture`           | `/curb/projects/:projectId/capture`               | `curb_media:upload`               | `curb.guided_capture`  | CV-043, PLT-018        | planned     |
| `CV-05`                   | `curb.estimate`          | `/curb/projects/:projectId/estimates/:estimateId` | `estimate:read`                   | —                      | CP-052, CP-058, CP-059 | planned     |
| `OPS-05`                  | `leads.detail`           | `/leads/:leadId`                                  | `lead:read`                       | —                      | OPS-061                | planned     |
| `OPS-06`                  | `customers.detail`       | `/customers/:customerId`                          | `customer:read`                   | —                      | OPS-061                | planned     |
| `OPS-07`                  | `jobs.detail`            | `/jobs/:jobId`                                    | `job:read`                        | —                      | OPS-062, OPS-067       | planned     |
| `OPS-08`                  | `proposals.detail`       | `/proposals/:proposalId`                          | `proposal:read`                   | —                      | OPS-063, OPS-064       | planned     |
| `OPS-09`                  | `billing.invoice`        | `/billing/invoices/:invoiceId`                    | `invoice:read`                    | —                      | OPS-068                | planned     |
| `CP-01`                   | `settings.price_books`   | `/settings/price-books`                           | `price_book:read`                 | —                      | CP-057, OPS-065        | planned     |
| `PLT-notifications`       | `settings.notifications` | `/settings/notifications`                         | `notification:update_preferences` | —                      | PLT-020                | implemented |
| `PLT-onboarding`          | `onboarding`             | `/onboarding`                                     | `org:update`                      | —                      | PLT-014                | implemented |
| `PLT-search`              | `search`                 | `/search`                                         | `search:read`                     | —                      | PLT-016                | partial     |
| `PUBLIC-sign-in`          | —                        | `/sign-in`                                        | public                            | —                      | PLT-013                | implemented |
| `PUBLIC-select-workspace` | —                        | `/select-workspace`                               | authenticated, no active org      | —                      | PLT-004, PLT-014       | implemented |
| `PUBLIC-access`           | —                        | `/access`                                         | authenticated                     | —                      | PLT-003, PLT-015       | implemented |
| `PUBLIC-invite`           | —                        | `/invite/:token`                                  | public, token                     | —                      | PLT-015                | implemented |
| `PUBLIC-offline`          | —                        | `/offline`                                        | public                            | —                      | PLT-018                | implemented |
| `PUBLIC-portal`           | —                        | `/portal/:token`                                  | portal token scope                | `portal.homeowner`     | OPS-070                | planned     |

## 4. Shell and account screens

### 4.1 `PLT-signed-in-shell` — application frame

- **Layout.** Top bar (menu on phone, brand, workspace switcher, search on desktop, role label,
  sign out), sidebar on desktop, bottom bar on phone with at most five destinations, breadcrumbs
  for detail routes, page content region, route announcer.
- **States.** Confirming session (skeleton), session error (retry), redirect to onboarding,
  workspace choice, or sign-in when `/v1/me` has no active workspace, signed-in.
- **Tests.** `AppFrame.test.tsx`, `navigation.test.ts`, `routing.test.ts`.

| Control ID   | Control            | Behaviour                                                                                                                           | Contract                                            | Status      |
| ------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------- |
| `PLT-UI-001` | Sidebar item       | Opens the registry route; shows `aria-current` for the area; flag-off items render unavailable with a reason.                       | Route registry navigation; `GET /v1/flags` **live** | implemented |
| `PLT-UI-002` | Open menu          | Phone only; opens the menu sheet with search and every allowed area.                                                                | local-only                                          | implemented |
| `PLT-UI-003` | Workspace switcher | Lists active memberships; switching calls the endpoint and refreshes `/v1/me`; caches are keyed by org.                             | `POST /v1/session/active-org` **live**              | implemented |
| `PLT-UI-004` | Global search box  | Submits to `/search?q=`; empty and one-character queries do not navigate.                                                           | local navigation; see `PLT-search`                  | implemented |
| `PLT-UI-005` | Sign out           | Calls logout, clears query cache and shell caches, lands on `/sign-in?reason=…`; still clears the device if the API is unreachable. | `POST /v1/auth/logout` **live**                     | implemented |
| `PLT-UI-006` | Breadcrumbs        | Shows the registry parent chain; parameterised parents are unlinked.                                                                | route registry                                      | implemented |
| `PLT-UI-007` | Route announcer    | Announces the new page and moves focus to its heading after navigation.                                                             | local-only                                          | implemented |
| `PLT-UI-008` | Outbox sync notice | Shows queued offline writes and retries when connectivity returns.                                                                  | local-only; IndexedDB outbox                        | implemented |

### 4.2 `PLT-home` — Home

- **Layout.** Page heading with company display name, phone search, "Start work" product cards
  (Roof Measurements and Curb Cutting are equal peers), "Needs attention" queues in fixed urgency
  order, last-updated time.
- **Data.** `GET /v1/dashboard` is not implemented (module stub). Until it is, the screen shows
  "No data yet" per queue, not zeros that look like real counts.
- **States.** Loading queues, queues unavailable (honest empty, not an error), queue error with
  retry, queue with items, queue empty.
- **Tests.** `HomeDashboard` rendering and queue-order unit test (planned), browser journey
  `home.spec.ts`.

| Control ID   | Control                | Behaviour                                                                       | Contract                        | Status      |
| ------------ | ---------------------- | ------------------------------------------------------------------------------- | ------------------------------- | ----------- |
| `PLT-UI-010` | Open Roof Measurements | Navigates to `/roof`; requires permission and flag, otherwise shows the reason. | route registry                  | implemented |
| `PLT-UI-011` | Open Curb Cutting      | Navigates to `/curb`; same gating rules as above.                               | route registry                  | implemented |
| `PLT-UI-012` | Queue item link        | Opens the subject's href; item status is the blocking reason (PLT-016 B).       | `GET /v1/dashboard` **planned** | planned     |
| `PLT-UI-013` | Phone search           | Submits the global search query.                                                | local navigation                | implemented |

### 4.3 `PUBLIC-sign-in` — Sign in

- **Layout.** Brand, one-line purpose, provider buttons in policy order (Microsoft first,
  development providers last and labelled), retry on provider-load failure, error notice.
- **States.** Loading providers, no configured providers, provider error with retry, redirecting to
  the identity provider, `reason` messages for expired session, signed out, access denied.

| Control ID   | Control                    | Behaviour                                                                      | Contract                                                                    | Status      |
| ------------ | -------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------- |
| `PLT-UI-020` | Provider sign-in           | Navigates to the provider's login URL, preserving a safe `returnTo`.           | `GET /v1/auth/providers` **live** → `GET /v1/auth/login/:provider` **live** | implemented |
| `PLT-UI-021` | Retry provider list        | Refetches providers after an error.                                            | same as above                                                               | implemented |
| `PLT-UI-022` | Development provider label | Clearly marks the local stand-in IdP; it can never be mistaken for production. | `GET /v1/auth/providers` **live**                                           | implemented |

### 4.4 `PUBLIC-select-workspace` — Choose a workspace

- **Layout.** List of active memberships with role; "Set up a new company" secondary action.
- **States.** Loading, error with retry, no memberships (redirects to onboarding), switching.

| Control ID   | Control              | Behaviour                                              | Contract                               | Status      |
| ------------ | -------------------- | ------------------------------------------------------ | -------------------------------------- | ----------- |
| `PLT-UI-023` | Workspace button     | Sets the active org and returns to the requested page. | `POST /v1/session/active-org` **live** | implemented |
| `PLT-UI-024` | Set up a new company | Opens onboarding; requires `org:update` (owner/admin). | local navigation → `PLT-onboarding`    | implemented |

### 4.5 `PUBLIC-access` — Access explanation

- **Layout.** Reason-specific explanation (no access, expired session, revoked membership) and next
  steps. No tenant data is shown.
- **States.** `denied`, `expired`, `revoked`, `not_found` variants.

| Control ID   | Control                  | Behaviour                                       | Contract                                | Status      |
| ------------ | ------------------------ | ----------------------------------------------- | --------------------------------------- | ----------- |
| `PLT-UI-025` | Choose another workspace | Goes to workspace selection.                    | local navigation                        | implemented |
| `PLT-UI-026` | Sign in again            | Restarts sign-in with a safe return path.       | `GET /v1/auth/login/:provider` **live** | implemented |
| `PLT-UI-027` | Go to Home               | Returns to `/` when the session is still valid. | local navigation                        | implemented |

### 4.6 `PUBLIC-invite` — Accept an invitation

- **Layout.** Shows company display name, offered role, inviter, and expiry from the preview before
  the token is accepted. The token travels in the request body, never in a URL.
- **States.** Preview loading, invalid/expired token, already accepted, accepting, success,
  signed-in as the wrong account, failure.

| Control ID   | Control           | Behaviour                                                          | Contract                               | Status      |
| ------------ | ----------------- | ------------------------------------------------------------------ | -------------------------------------- | ----------- |
| `PLT-UI-028` | Accept invitation | Accepts with an idempotency key, then enters the workspace.        | `POST /v1/invitations/accept` **live** | implemented |
| `PLT-UI-029` | Not now           | Leaves without accepting; the invitation stays valid until expiry. | local navigation                       | implemented |

### 4.7 `PUBLIC-offline` — Offline

- **Layout.** Explains that the shell is available offline and that queued changes will sync.
- **States.** Offline, back online (offers return to the app).

| Control ID   | Control      | Behaviour                                           | Contract   | Status      |
| ------------ | ------------ | --------------------------------------------------- | ---------- | ----------- |
| `PLT-UI-030` | Back to Home | Returns to the cached shell; no data is fabricated. | local-only | implemented |

### 4.8 `PLT-onboarding` — Company setup

- **Layout.** Six-step wizard: Company, Trade focus, Work regions, Currency/units/tax, Logo, Finish.
  Steps can be resumed; leaving mid-way keeps completed server revisions.
- **States.** Loading, company already exists, validation errors per field, saving, partial save
  failure (retry the step, not the whole wizard), complete.
- **Contracts.** `POST /v1/orgs` **live**; `PUT /v1/orgs/current/settings/:section` **live**;
  `POST /v1/media/uploads` **live**, `POST /v1/media/uploads/:id/complete` **live**,
  `PUT /v1/storage/upload/:token` **live**.

| Control ID   | Control                  | Behaviour                                                                       | Status      |
| ------------ | ------------------------ | ------------------------------------------------------------------------------- | ----------- |
| `PLT-UI-040` | Setup progress (stepper) | Shows position and allows returning to completed steps.                         | implemented |
| `PLT-UI-041` | Legal company name       | Required; 1–200 characters; validated before the org is created.                | implemented |
| `PLT-UI-042` | Name customers see       | Optional display name; defaults to the legal name; escaped in all output.       | implemented |
| `PLT-UI-043` | Time zone                | IANA name; invalid zones are rejected inline.                                   | implemented |
| `PLT-UI-044` | Trade focus              | Roof, curb, or both; stored in the onboarding settings section.                 | implemented |
| `PLT-UI-045` | Work regions             | Cities, counties, or states the company serves; used for price-book scope.      | implemented |
| `PLT-UI-046` | Currency                 | ISO currency; stored prices remain exact minor units.                           | implemented |
| `PLT-UI-047` | Measurement system       | Imperial or metric for display; stored values stay SI.                          | implemented |
| `PLT-UI-048` | Default tax rate         | Percentage; 0–100 with at most three decimals.                                  | implemented |
| `PLT-UI-049` | Tax display mode         | Added on top, included in prices, or not charged.                               | implemented |
| `PLT-UI-050` | Company logo             | PNG/JPEG/WebP up to 5 MB; uploads through a signed URL; failure keeps the step. | implemented |
| `PLT-UI-051` | Back / Continue / Finish | Validates the current step, saves its section, advances; Finish enters Home.    | implemented |
| `PLT-UI-052` | Start a new setup        | Shown when a company already exists; requires confirmation before replacing.    | implemented |

### 4.9 `PLT-search` — Search

- **Layout.** Search box, result list grouped by record type, tenant-scoped only. Queries shorter
  than two characters do not run. Results are never service-worker cached.
- **Data.** `GET /v1/search` is not implemented (module stub); the screen shows "Search is not
  available yet", not an error and not fake results.
- **States.** Typing prompt, searching skeleton, unavailable, no results, results, error with retry.

| Control ID   | Control       | Behaviour                                                           | Contract                     | Status      |
| ------------ | ------------- | ------------------------------------------------------------------- | ---------------------------- | ----------- |
| `PLT-UI-060` | Search input  | Debounced navigation to `/search?q=…`; trims whitespace.            | local navigation             | implemented |
| `PLT-UI-061` | Result link   | Opens the record's href from the response; type and subtitle shown. | `GET /v1/search` **planned** | planned     |
| `PLT-UI-062` | Retry search  | Refetches after a retryable error.                                  | `GET /v1/search` **planned** | planned     |
| `PLT-UI-063` | Type guidance | Lists searchable types once indexing is live.                       | `GET /v1/search` **planned** | planned     |

### 4.10 `PLT-team` — Team and roles

- **Layout.** Member table (name, email, role, status, last active), role selector and save per
  member, deactivate with confirmation, invitations form (email + role), pending invitations with
  revoke, ownership transfer panel.
- **States.** Loading, error, empty team (only the owner), revision conflict on role change,
  invitation already pending, revoke failure, transfer confirmation.
- **Contracts.** `GET /v1/team/members` **live**; `PATCH /v1/team/members/:id` **live** with
  `If-Match`; `POST /v1/team/members/:id/deactivate` **live**; `POST /v1/team/invitations` **live**;
  `GET /v1/team/invitations` **live**; `POST /v1/team/invitations/:id/revoke` **live**;
  `POST /v1/team/transfer-ownership` **live**.
- **Tests.** `TeamView.test.tsx`, RBAC matrix tests.

| Control ID   | Control              | Behaviour                                                                           | Status                |
| ------------ | -------------------- | ----------------------------------------------------------------------------------- | --------------------- |
| `PLT-UI-070` | Role selector        | Offers all member roles; disabled without `team:update_role` with a reason.         | implemented           |
| `PLT-UI-071` | Save role            | PATCHes with the current revision; a 412 reloads and says the change was not saved. | implemented           |
| `PLT-UI-072` | Reactivate member    | Restores a suspended member to active; requires `team:update_role`.                 | implemented           |
| `PLT-UI-073` | Deactivate member    | Confirmation dialog; the last owner cannot be deactivated.                          | implemented           |
| `PLT-UI-074` | Invite email         | Validates an email address; duplicate pending invitations are explained.            | implemented           |
| `PLT-UI-075` | Invite role          | Defaults to the least privileged useful role; no owner option in the picker.        | implemented           |
| `PLT-UI-076` | Send invitation      | Creates with an idempotency key; shows the pending invitation on success.           | implemented           |
| `PLT-UI-077` | Revoke invitation    | Confirms, then revokes; the link stops working immediately.                         | implemented           |
| `PLT-UI-078` | Resend invitation    | Issues a new expiry for an unaccepted invitation.                                   | API live / UI planned |
| `PLT-UI-079` | New owner selector   | Lists active members; requires `org:transfer_ownership`.                            | implemented           |
| `PLT-UI-080` | Transfer ownership   | Confirms with the consequence stated ("you become Admin"); audited.                 | implemented           |
| `PLT-UI-081` | Approval delegations | Creates and revokes time-bounded approval delegations.                              | API live / UI planned |

### 4.11 `PLT-settings` — Settings

- **Layout.** Section subnav (Notifications, Price books, Team), company profile form, device
  display preferences with a live formatting preview.
- **States.** Loading profile, read-only for roles without `org:update`, save success, 412 conflict
  (reload newer revision), validation error, local preference change (no server call).
- **Contracts.** `GET /v1/orgs/current` **live**; `PATCH /v1/orgs/current` **live** with `If-Match`;
  display preferences `local-only`.
- **Tests.** Settings rendering and format preview (planned unit test), RBAC denial test.

| Control ID   | Control                     | Behaviour                                                            | Status      |
| ------------ | --------------------------- | -------------------------------------------------------------------- | ----------- |
| `PLT-UI-090` | Legal company name          | Required; edits the current revision.                                | implemented |
| `PLT-UI-091` | Name customers see          | Optional; affects customer-facing documents only after save.         | implemented |
| `PLT-UI-092` | Time zone                   | IANA name; invalid values are rejected with a field error.           | implemented |
| `PLT-UI-093` | Default currency            | Applies to new quotes; approved documents keep their currency.       | implemented |
| `PLT-UI-094` | Company measurement display | Imperial or metric default for the company; stored values stay SI.   | implemented |
| `PLT-UI-095` | Save company profile        | PATCH with revision; success toast; 412 reloads and explains.        | implemented |
| `PLT-UI-096` | Your units (this device)    | Company default, imperial, or metric; local only, with preview.      | implemented |
| `PLT-UI-097` | Language and region         | Date, number, and money formatting locale; local only, with preview. | implemented |
| `PLT-UI-098` | Notification preferences    | Opens `/settings/notifications`.                                     | implemented |
| `PLT-UI-099` | Price books                 | Opens `/settings/price-books`.                                       | implemented |
| `PLT-UI-100` | Team and roles              | Opens `/team`.                                                       | implemented |

### 4.12 `PLT-notifications` — Notification preferences

- **Layout.** Matrix of notification categories × channels (in-app, email; SMS only when the flag
  and consent exist). Save is enabled only when the matrix is dirty.
- **States.** Loading, no categories available, saving, saved toast, save error, unsupported channel
  explained rather than offered.
- **Contracts.** `GET /v1/notifications/preferences` **live**; `PUT /v1/notifications/preferences`
  **live**; delivery failures `GET /v1/notifications/delivery-failures` **live**.

| Control ID   | Control                     | Behaviour                                                               | Status                |
| ------------ | --------------------------- | ----------------------------------------------------------------------- | --------------------- |
| `PLT-UI-110` | Category × channel checkbox | Toggles one preference; announces the new state; disabled while saving. | implemented           |
| `PLT-UI-111` | Save preferences            | Sends the full matrix; success toast; failure keeps edits.              | implemented           |
| `PLT-UI-112` | Retry failed delivery       | Retries a failed notification delivery and shows the new status.        | API live / UI planned |

### 4.13 Feature-flag governance (no dedicated route yet)

Flags are read by the shell and set per organisation. There is no screen in the route registry for
managing them, which is a documented gap. Until one exists, a flag change is an API operation by an
owner/admin and must be audited.

| Control ID   | Control              | Behaviour                                                                                | Contract                        | Status             |
| ------------ | -------------------- | ---------------------------------------------------------------------------------------- | ------------------------------- | ------------------ |
| `PLT-UI-120` | Flag override select | Owner/admin sets a flag for the org; off shows the feature unavailable, never fake data. | `PUT /v1/flags/:key` **live**   | planned (no route) |
| `PLT-UI-121` | Flag history         | Shows who changed a flag and when.                                                       | `GET /v1/audit-events` **live** | planned (no route) |

## 5. Roof Measurements screens

Roof area prefix `RF`. All screens are `planned`; the current `/roof` page is an honest placeholder
(`AreaPage` → `ComingSoon`) and no roof handler exists yet.

### 5.1 `RF-01` — Roof Measurements list (`/roof`)

- **Layout.** Heading, "New roof order" primary action, filters (status, ordered by, date range),
  orders table, review-queue link when `roof.assisted_review` is on.
- **States.** Loading, empty (explains what an order is), filter with no matches, error, denied,
  flag off.

| Control ID  | Control           | Behaviour                                                      | Contract                              | Status  |
| ----------- | ----------------- | -------------------------------------------------------------- | ------------------------------------- | ------- |
| `RF-UI-001` | New roof order    | Opens `/roof/new`; requires `roof_order:create`.               | local navigation                      | planned |
| `RF-UI-002` | Filters           | Status, date range, and property search; reflected in the URL. | `GET /v1/roof/orders?…` **planned**   | planned |
| `RF-UI-003` | Order row         | Opens the order detail; shows status and last update.          | `GET /v1/roof/orders/:id` **planned** | planned |
| `RF-UI-004` | Review queue link | Opens `/roof/review`; hidden without `review_task:read`.       | local navigation                      | planned |

### 5.2 `RF-02` — New roof order (`/roof/new`)

- **Layout.** Address search, candidate list, property confirmation, structure selection, imagery
  rights summary and price indication, order options, create action.
- **States.** Searching, no candidates, candidate error, imagery not licensed for the parcel,
  order creation pending, duplicate address warning, success redirect to the order.
- **Requirements.** RF-021, PLT-017. Imagery licensing must follow
  `docs/product/licensing-register.md`; consumer tiles are never used for machine analysis.

| Control ID  | Control              | Behaviour                                                                          | Contract                                           | Status  |
| ----------- | -------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- | ------- |
| `RF-UI-010` | Address search       | Searches addresses worldwide from the licensed geocoder; debounced.                | `GET /v1/properties/address-search?q=` **planned** | planned |
| `RF-UI-011` | Address candidate    | Selects a candidate and frames it on the preview map; shows precision.             | same as above                                      | planned |
| `RF-UI-012` | Confirm property     | Creates or reuses a property and its structure.                                    | `POST /v1/properties` **planned**                  | planned |
| `RF-UI-013` | Imagery rights check | States whether imagery may be ordered and what it costs; requires `imagery:order`. | `GET /v1/imagery/candidates` **planned**           | planned |
| `RF-UI-014` | Create order         | Creates the order with an idempotency key and opens its detail.                    | `POST /v1/roof/orders` **planned**                 | planned |

### 5.3 `RF-03` — Roof order (`/roof/orders/:orderId`)

- **Layout.** Order summary (property, status, timeline), imagery preview, report versions, actions.
- **States.** Loading, not found, cancelled, awaiting imagery, report in progress, error.

| Control ID  | Control           | Behaviour                                                                           | Contract                                           | Status  |
| ----------- | ----------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------- | ------- |
| `RF-UI-020` | Status transition | Offers only transitions the order machine allows; requires `roof_order:transition`. | `POST /v1/roof/orders/:id/transitions` **planned** | planned |
| `RF-UI-021` | Open report       | Opens the latest report version, or starts one.                                     | `GET /v1/roof/reports/:id` **planned**             | planned |
| `RF-UI-022` | Cancel order      | Confirms and cancels; requires `roof_order:cancel`; audited.                        | `POST /v1/roof/orders/:id/cancel` **planned**      | planned |
| `RF-UI-023` | Order imagery     | Places the imagery order; spends credits; requires `imagery:order`.                 | `POST /v1/imagery/orders` **planned**              | planned |

### 5.4 `RF-04` — Roof report (`/roof/reports/:reportId`)

- **Layout.** Report header (property, date, provenance), totals, facet table, edges, materials,
  PDF preview/download, issue and send actions, review decision history.
- **States.** Draft, in review, approved, issued, superseded, failed generation, export error.

| Control ID  | Control              | Behaviour                                                             | Contract                                          | Status  |
| ----------- | -------------------- | --------------------------------------------------------------------- | ------------------------------------------------- | ------- |
| `RF-UI-030` | Download report PDF  | Generates and downloads the branded PDF; shows progress and failure.  | `POST /v1/exports` **planned**                    | planned |
| `RF-UI-031` | Issue report         | Freezes the version, requires `roof_report:issue`; audited.           | `POST /v1/roof/reports/:id/issue` **planned**     | planned |
| `RF-UI-032` | Edit sketch          | Opens the editor; requires `roof_report:edit_geometry`.               | local navigation                                  | planned |
| `RF-UI-033` | Approve report       | Requires `roof_report:approve` and no open review tasks.              | `POST /v1/roof/reports/:id/approve` **planned**   | planned |
| `RF-UI-034` | Override measurement | Requires `measurement:override` and a reason; recorded in provenance. | `POST /v1/roof/reports/:id/overrides` **planned** | planned |

### 5.5 `RF-05` — Roof sketch editor (`/roof/reports/:reportId/edit`)

- **Layout.** Satellite map (default), facet list, per-facet pitch, edge-length inputs, totals,
  undo/redo, save status, submit for review.
- **States.** Loading imagery, imagery unavailable (clear message, never a blank tinted map), drawing,
  invalid polygon (self-intersection), unsaved changes, saving, 412 conflict, submitted.
- **Requirements.** RF-023, RR-032. Geometry is stored per facet with a revision; pitch multiplies
  plan area; every total is recomputable from stored geometry.

| Control ID  | Control           | Behaviour                                                                                                            | Contract                                                        | Status  |
| ----------- | ----------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------- |
| `RF-UI-040` | Basemap selector  | Satellite is the default and must show ground detail at house zoom; labels optional. Licensing per imagery register. | `GET /v1/imagery/candidates` **planned**                        | planned |
| `RF-UI-041` | Draw facet        | Adds polygon vertices; double-click or explicit Finish closes the facet.                                             | local draft → `PATCH /v1/roof/reports/:id/geometry` **planned** | planned |
| `RF-UI-042` | Undo / redo point | Reverses the last vertex or geometry operation; never removes saved facets.                                          | local draft                                                     | planned |
| `RF-UI-043` | Facet pitch       | Pitch rise per 12; applies the multiplier to that facet only.                                                        | geometry patch **planned**                                      | planned |
| `RF-UI-044` | Edge lengths      | Ridge, hip, eave, and rake inputs in the display unit; stored in metres.                                             | geometry patch **planned**                                      | planned |
| `RF-UI-045` | Totals panel      | Plan area, surface area, squares with waste, bundles; updates live.                                                  | computed client-side from saved + draft geometry                | planned |
| `RF-UI-046` | Save revision     | Sends geometry with `If-Match`; 412 reloads and preserves the user's draft.                                          | `PATCH /v1/roof/reports/:id/geometry` **planned**               | planned |
| `RF-UI-047` | Submit for review | Requires `roof_report:submit`; locks editing pending the review decision.                                            | `POST /v1/roof/reports/:id/submit` **planned**                  | planned |

### 5.6 `RF-06` — Measurement review (`/roof/review`)

- **Layout.** Queue table (order, property, age, assignee, status), claim action, decision panel with
  reason codes.
- **States.** Empty queue, claimed by someone else, decision in progress, approved, rejected with
  reason, conflict.

| Control ID  | Control            | Behaviour                                                             | Contract                                  | Status  |
| ----------- | ------------------ | --------------------------------------------------------------------- | ----------------------------------------- | ------- |
| `RF-UI-050` | Claim task         | Assigns the task to the reviewer; requires `review_task:claim`.       | `POST /v1/reviews/:id/claim` **planned**  | planned |
| `RF-UI-051` | Approve            | Approves the measurement/report; requires `review_task:decide`.       | `POST /v1/reviews/:id/decide` **planned** | planned |
| `RF-UI-052` | Reject with reason | Requires a reason code and note; returns the report to the estimator. | same as above                             | planned |
| `RF-UI-053` | Assign reviewer    | Reassigns within the org; requires `review_task:assign`.              | `POST /v1/reviews/:id/assign` **planned** | planned |

## 6. Curb Cutting screens

Curb area prefix `CV`. All screens are `planned`; no curb handler exists yet.

### 6.1 `CV-01` — Curb Cutting list (`/curb`)

| Control ID  | Control          | Behaviour                                                      | Contract                                | Status  |
| ----------- | ---------------- | -------------------------------------------------------------- | --------------------------------------- | ------- |
| `CV-UI-001` | New curb project | Opens `/curb/new`; requires `curb_project:write`.              | local navigation                        | planned |
| `CV-UI-002` | Filters          | Status, work type, date range, property; reflected in the URL. | `GET /v1/curb/projects?…` **planned**   | planned |
| `CV-UI-003` | Project row      | Opens the project detail; shows status and estimate count.     | `GET /v1/curb/projects/:id` **planned** | planned |

### 6.2 `CV-02` — New curb project (`/curb/new`)

| Control ID  | Control          | Behaviour                                                                                 | Contract                                           | Status  |
| ----------- | ---------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------- | ------- |
| `CV-UI-010` | Property/address | Searches and confirms the site property.                                                  | `GET /v1/properties/address-search?q=` **planned** | planned |
| `CV-UI-011` | Work type        | Standard curb, cut curb, washout, retaining wall, sidewalk tie-in, ADA ramp, demo, other. | `POST /v1/curb/projects` **planned**               | planned |
| `CV-UI-012` | Create project   | Creates with an idempotency key and opens guided capture next.                            | same as above                                      | planned |

### 6.3 `CV-03` — Curb project (`/curb/projects/:projectId`)

- **Layout.** Site header, photo strip with quality badges, calibration card, curb path summary,
  risk flags, permit/utility checklist, estimate history.
- **States.** Needs photos, needs calibration, measurement in progress, blocked by gates, estimate
  ready, error.

| Control ID  | Control                  | Behaviour                                                                                | Contract                                              | Status  |
| ----------- | ------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------- |
| `CV-UI-020` | Capture photos           | Opens `/capture`; requires `curb_media:upload`.                                          | local navigation                                      | planned |
| `CV-UI-021` | Calibrate reference      | Records a known dimension and its uncertainty; requires `curb_calibration:write`.        | `POST /v1/curb/projects/:id/calibrations` **planned** | planned |
| `CV-UI-022` | Edit curb path           | Draws curb segments; requires `curb_measurement:write`.                                  | `POST /v1/curb/projects/:id/segments` **planned**     | planned |
| `CV-UI-023` | Add risk flag            | Records permit, right-of-way, utility, or depth uncertainty; requires `risk_flag:write`. | `POST /v1/curb/projects/:id/risks` **planned**        | planned |
| `CV-UI-024` | Permit/utility checklist | Tracks hard gates; unknown utilities block dispatch and approval.                        | `POST /v1/curb/projects/:id/permits` **planned**      | planned |
| `CV-UI-025` | Create estimate          | Opens the estimate form; disabled until geometry and calibration exist.                  | `POST /v1/curb/projects/:id/estimates` **planned**    | planned |

### 6.4 `CV-04` — Photo capture (`/curb/projects/:projectId/capture`)

| Control ID  | Control        | Behaviour                                                                     | Contract                                                                           | Status  |
| ----------- | -------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------- |
| `CV-UI-030` | Take photo     | Uses the device camera on phones; file picker elsewhere.                      | local-only (device API)                                                            | planned |
| `CV-UI-031` | Upload photo   | Requests a signed upload, puts the file, then completes the upload.           | `POST /v1/media/uploads` **live** → `POST /v1/media/uploads/:id/complete` **live** | planned |
| `CV-UI-032` | Quality result | Shows blur, exposure, glare, resolution, and duplicate findings.              | `GET /v1/media/:id` **live**                                                       | planned |
| `CV-UI-033` | Retake         | Discards the failed capture after confirmation; keeps the audit of the first. | local UI                                                                           | planned |

### 6.5 `CV-05` — Curb estimate (`/curb/projects/:projectId/estimates/:estimateId`)

- **Layout.** Low/base/high cards, quantity breakdown by curb profile and slab thickness, price book
  selector, gate checklist, approval and proposal actions.
- **States.** Gated (blockers listed), awaiting approval, approved, superseded, vendor-pricing
  unavailable, error.
- **Requirements.** CP-052, CP-058, CP-059. Values are explicitly preliminary until verified.

| Control ID  | Control           | Behaviour                                                                                | Contract                                       | Status  |
| ----------- | ----------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------- | ------- |
| `CV-UI-040` | Low / base / high | Shows the three scenarios with assumptions and confidence, never a single "final" price. | `GET /v1/estimates/:id` **planned**            | planned |
| `CV-UI-041` | Price book select | Chooses the regional price book revision; requires `price_book:read`.                    | `GET /v1/price-books` **planned**              | planned |
| `CV-UI-042` | Gating blockers   | Lists permits, utilities, right-of-way, and depth blockers with owners.                  | `GET /v1/estimates/:id/gates` **planned**      | planned |
| `CV-UI-043` | Approve estimate  | Requires `estimate:approve` and zero blockers; audited.                                  | `POST /v1/estimates/:id/approvals` **planned** | planned |
| `CV-UI-044` | Send proposal     | Turns the approved estimate into a proposal draft.                                       | `POST /v1/proposals` **planned**               | planned |

## 7. Commercial and field screens

Operations prefix `OPS`. All screens are `planned`; placeholder pages exist for the list routes.

### 7.1 `OPS-01` — Leads (`/leads`)

| Control ID   | Control       | Behaviour                                                | Contract                        | Status  |
| ------------ | ------------- | -------------------------------------------------------- | ------------------------------- | ------- |
| `OPS-UI-001` | New lead      | Opens the lead form; requires `lead:write`.              | `POST /v1/leads` **planned**    | planned |
| `OPS-UI-002` | Search/filter | Source, status, owner, date range; reflected in the URL. | `GET /v1/leads?…` **planned**   | planned |
| `OPS-UI-003` | Lead row      | Opens the lead detail.                                   | `GET /v1/leads/:id` **planned** | planned |

### 7.2 `OPS-05` — Lead (`/leads/:leadId`)

| Control ID   | Control      | Behaviour                                                                | Contract                                 | Status  |
| ------------ | ------------ | ------------------------------------------------------------------------ | ---------------------------------------- | ------- |
| `OPS-UI-010` | Edit lead    | Updates contact, source, and owner; revision checked.                    | `PATCH /v1/leads/:id` **planned**        | planned |
| `OPS-UI-011` | Add note     | Timestamped note visible to the team; requires `note:write`.             | `POST /v1/leads/:id/notes` **planned**   | planned |
| `OPS-UI-012` | Convert lead | Creates the customer and optional property/job; requires `lead:convert`. | `POST /v1/leads/:id/convert` **planned** | planned |

### 7.3 `OPS-06` — Customer (`/customers/:customerId`)

| Control ID   | Control       | Behaviour                                                   | Contract                              | Status  |
| ------------ | ------------- | ----------------------------------------------------------- | ------------------------------------- | ------- |
| `OPS-UI-015` | Edit customer | Name, contacts, billing address; requires `customer:write`. | `PATCH /v1/customers/:id` **planned** | planned |
| `OPS-UI-016` | Add property  | Adds an address/property with geocoding result.             | `POST /v1/properties` **planned**     | planned |
| `OPS-UI-017` | Create job    | Starts a job from this customer; requires `job:write`.      | `POST /v1/jobs` **planned**           | planned |

### 7.4 `OPS-02` — Jobs (`/jobs`)

| Control ID   | Control      | Behaviour                                                | Contract                       | Status  |
| ------------ | ------------ | -------------------------------------------------------- | ------------------------------ | ------- |
| `OPS-UI-020` | New job      | Opens the job form; requires `job:write`.                | `POST /v1/jobs` **planned**    | planned |
| `OPS-UI-021` | Stage filter | Pipeline stage, owner, date range; reflected in the URL. | `GET /v1/jobs?…` **planned**   | planned |
| `OPS-UI-022` | Job row      | Opens job detail; shows stage and blocking reason.       | `GET /v1/jobs/:id` **planned** | planned |

### 7.5 `OPS-07` — Job (`/jobs/:jobId`)

| Control ID   | Control              | Behaviour                                                                            | Contract                                                                 | Status  |
| ------------ | -------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------- |
| `OPS-UI-030` | Move stage           | Moves the job only along allowed transitions; requires `job:move_stage`.             | `POST /v1/jobs/:id/stage` **planned**                                    | planned |
| `OPS-UI-031` | Readiness checklist  | Permits, utility locates, safety plan, signed contract; each item links to evidence. | `GET /v1/jobs/:id/readiness` **planned**                                 | planned |
| `OPS-UI-032` | Release for dispatch | Blocked until readiness is complete; requires `dispatch:release`; audited.           | `POST /v1/jobs/:id/dispatch` **planned**                                 | planned |
| `OPS-UI-033` | Tasks                | Adds and completes tasks; requires `task:write`.                                     | `POST /v1/jobs/:id/tasks` **planned**                                    | planned |
| `OPS-UI-034` | Files                | Uploads and opens job documents and photos.                                          | `POST /v1/media/uploads` **live** → `/v1/storage/upload/:token` **live** | planned |

### 7.6 `OPS-03` — Proposals (`/proposals`)

| Control ID   | Control      | Behaviour                                                    | Contract                            | Status  |
| ------------ | ------------ | ------------------------------------------------------------ | ----------------------------------- | ------- |
| `OPS-UI-040` | New proposal | Starts from an approved estimate; requires `proposal:write`. | `POST /v1/proposals` **planned**    | planned |
| `OPS-UI-041` | Filter       | Status, customer, expiry, value range.                       | `GET /v1/proposals?…` **planned**   | planned |
| `OPS-UI-042` | Proposal row | Opens the proposal; shows sent/viewed/signed state.          | `GET /v1/proposals/:id` **planned** | planned |

### 7.7 `OPS-08` — Proposal (`/proposals/:proposalId`)

| Control ID   | Control            | Behaviour                                                                           | Contract                                     | Status  |
| ------------ | ------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------- | ------- |
| `OPS-UI-050` | Edit line items    | Scope, quantity, price, tax, expiry; totals recomputed server-side.                 | `PATCH /v1/proposals/:id` **planned**        | planned |
| `OPS-UI-051` | Send proposal      | Sends to the customer and enables the portal link; requires `proposal:send`.        | `POST /v1/proposals/:id/send` **planned**    | planned |
| `OPS-UI-052` | Void proposal      | Requires a reason; audited; requires `proposal:void`.                               | `POST /v1/proposals/:id/void` **planned**    | planned |
| `OPS-UI-053` | Approve discount   | Required when a discount drops below the margin floor; requires `proposal:approve`. | `POST /v1/proposals/:id/approve` **planned** | planned |
| `OPS-UI-054` | Create portal link | Creates a scoped, expiring homeowner link; requires `portal_link:create`.           | `POST /v1/portal-links` **planned**          | planned |

### 7.8 `OPS-04` — Billing (`/billing`)

| Control ID   | Control     | Behaviour                                                             | Contract                           | Status  |
| ------------ | ----------- | --------------------------------------------------------------------- | ---------------------------------- | ------- |
| `OPS-UI-060` | New invoice | Creates from an accepted proposal or a job; requires `invoice:write`. | `POST /v1/invoices` **planned**    | planned |
| `OPS-UI-061` | Filter      | Status, due date, customer, overdue only.                             | `GET /v1/invoices?…` **planned**   | planned |
| `OPS-UI-062` | Invoice row | Opens the invoice; shows open balance and overdue state.              | `GET /v1/invoices/:id` **planned** | planned |

### 7.9 `OPS-09` — Invoice (`/billing/invoices/:invoiceId`)

| Control ID   | Control        | Behaviour                                                                    | Contract                                  | Status  |
| ------------ | -------------- | ---------------------------------------------------------------------------- | ----------------------------------------- | ------- |
| `OPS-UI-070` | Issue invoice  | Assigns the number and freezes lines; requires `invoice:issue`.              | `POST /v1/invoices/:id/issue` **planned** | planned |
| `OPS-UI-071` | Record payment | Records amount, date, method, reference; requires `payment:record`; audited. | `POST /v1/payments` **planned**           | planned |
| `OPS-UI-072` | Void invoice   | Requires a reason and `invoice:void`; keeps the audit trail.                 | `POST /v1/invoices/:id/void` **planned**  | planned |
| `OPS-UI-073` | Print / PDF    | Generates the invoice PDF; failure is retryable.                             | `POST /v1/exports` **planned**            | planned |
| `OPS-UI-074` | Portal link    | Creates a pay-enabled homeowner link; requires `portal_link:create`.         | `POST /v1/portal-links` **planned**       | planned |

### 7.10 `AIQ-01` — Reports (`/reports`)

- **Layout.** Date range, KPI cards with baseline and target, queue totals, export.
- **Requirement.** AIQ-088. Every KPI states its derivation and window; no invented benchmark.

| Control ID   | Control         | Behaviour                                                  | Contract                             | Status  |
| ------------ | --------------- | ---------------------------------------------------------- | ------------------------------------ | ------- |
| `AIQ-UI-001` | Date range      | Sets the reporting window; reflected in the URL.           | `GET /v1/reports/kpis?…` **planned** | planned |
| `AIQ-UI-002` | KPI card        | Shows value, unit, baseline, target, and derivation.       | same as above                        | planned |
| `AIQ-UI-003` | Export          | Exports the current view as CSV; requires `export:create`. | `POST /v1/exports` **planned**       | planned |
| `AIQ-UI-004` | Provenance note | States the data sources and the last refresh time.         | same as above                        | planned |

## 8. Price books and portal

### 8.1 `CP-01` — Price books (`/settings/price-books`)

| Control ID  | Control             | Behaviour                                                                        | Contract                                                      | Status  |
| ----------- | ------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------- |
| `CP-UI-001` | New price book      | Creates a regional book; requires `price_book:write`.                            | `POST /v1/price-books` **planned**                            | planned |
| `CP-UI-002` | Region selector     | Scopes the book to a region; used by curb estimates.                             | `GET /v1/price-books` **planned**                             | planned |
| `CP-UI-003` | Edit draft revision | Changes rates on a draft only; requires `price_book:write`.                      | `PUT /v1/price-books/:id/revisions/:rev` **planned**          | planned |
| `CP-UI-004` | Approve revision    | Makes the revision immutable and usable; requires `price_book:approve`; audited. | `POST /v1/price-books/:id/revisions/:rev/approve` **planned** | planned |
| `CP-UI-005` | Retire price book   | Stops new estimates using the book; existing estimates keep their revision.      | `POST /v1/price-books/:id/retire` **planned**                 | planned |

### 8.2 `PUBLIC-portal` — Homeowner portal (`/portal/:token`)

- **Layout.** Resource summary for the token's scope, options, signing, payment, upload, and
  messaging as allowed by the scope.
- **States.** Invalid token, expired token, revoked, already used, resource unavailable, success.
- **Requirement.** OPS-070. The token is scoped to one resource and a fixed action set
  (`PORTAL_POLICY` in `rbac.ts`); it never grants membership or org access.

| Control ID   | Control       | Behaviour                                                                | Contract                                      | Status         |
| ------------ | ------------- | ------------------------------------------------------------------------ | --------------------------------------------- | -------------- |
| `OPS-UI-080` | View resource | Shows only the scoped proposal, invoice, report, job, or upload request. | `GET /v1/portal/:token` **planned**           | planned        |
| `OPS-UI-081` | Select option | Selects a proposal option when the scope allows it.                      | `POST /v1/portal/:token/select` **planned**   | planned        |
| `OPS-UI-082` | Sign          | Captures consent and signature when the scope allows it.                 | `POST /v1/portal/:token/sign` **planned**     | planned        |
| `OPS-UI-083` | Pay           | Starts the payment adapter; never captures card data in the app.         | `POST /v1/portal/:token/pay` **planned**      | blocked_vendor |
| `OPS-UI-084` | Upload        | Uploads requested photos/documents within the scope.                     | `POST /v1/portal/:token/uploads` **planned**  | planned        |
| `OPS-UI-085` | Message       | Sends a message to the contractor; no other org data is exposed.         | `POST /v1/portal/:token/messages` **planned** | planned        |

## 9. API contract catalogue

### 9.1 Live endpoints (handlers exist today)

All paths are under `/v1`. Authorization is session-based, with the module enforcing the RBAC action
and tenant scope; mutating endpoints accept `Idempotency-Key` where marked and versioned resources
accept `If-Match`.

| Method | Path                                         | Module        | Purpose                                       | Notes                             |
| ------ | -------------------------------------------- | ------------- | --------------------------------------------- | --------------------------------- |
| GET    | `/health`                                    | health        | Liveness                                      | public                            |
| GET    | `/health/ready`                              | health        | Readiness incl. database                      | public                            |
| GET    | `/auth/providers`                            | auth          | Configured identity providers                 | public list                       |
| GET    | `/auth/login/:provider`                      | auth          | Starts OIDC authorization-code + PKCE         | redirect                          |
| GET    | `/auth/link/:provider`                       | auth          | Links another identity to the session         | authenticated                     |
| GET    | `/auth/callback/:provider`                   | auth          | OIDC callback, session creation               | state + PKCE verified             |
| POST   | `/auth/logout`                               | auth          | Ends the server session                       | idempotent                        |
| GET    | `/me`                                        | session       | Session user, memberships, permissions, flags | cached per org                    |
| POST   | `/session/active-org`                        | session       | Switches the active workspace                 | membership checked                |
| GET    | `/orgs`                                      | orgs          | Memberships/organisations for the user        | tenant-scoped                     |
| POST   | `/orgs`                                      | orgs          | Creates an organisation and owner membership  | idempotency key                   |
| GET    | `/orgs/current`                              | orgs          | Active organisation profile                   | tenant-scoped                     |
| PATCH  | `/orgs/current`                              | orgs          | Updates profile                               | `If-Match` revision               |
| GET    | `/orgs/current/settings`                     | orgs          | Versioned settings envelope                   | tenant-scoped                     |
| PUT    | `/orgs/current/settings/:section`            | orgs          | Saves one settings section as a new revision  | `If-Match` optional               |
| GET    | `/orgs/current/settings/revisions`           | orgs          | Settings revision history                     | owner/admin/finance               |
| GET    | `/flags`                                     | flags         | Effective flags for the org/user              | tenant-scoped                     |
| PUT    | `/flags/:key`                                | flags         | Sets a flag override                          | owner/admin; audited              |
| GET    | `/team/members`                              | team          | Member list                                   | `team:read`                       |
| GET    | `/team/members/:id`                          | team          | Member detail                                 | `team:read`                       |
| PATCH  | `/team/members/:id`                          | team          | Role/status change                            | `If-Match`; `team:update_role`    |
| POST   | `/team/members/:id/deactivate`               | team          | Deactivates a member                          | audited                           |
| POST   | `/team/transfer-ownership`                   | team          | Transfers ownership                           | `org:transfer_ownership`; audited |
| GET    | `/team/invitations`                          | team          | Pending invitations                           | `team:read`                       |
| POST   | `/team/invitations`                          | team          | Creates an invitation                         | idempotency key; `team:invite`    |
| POST   | `/team/invitations/:id/revoke`               | team          | Revokes an invitation                         | `team:revoke`                     |
| POST   | `/team/invitations/:id/resend`               | team          | Resends/extends an invitation                 | `team:invite`                     |
| POST   | `/invitations/preview`                       | team          | Token preview before acceptance               | token in body                     |
| POST   | `/invitations/accept`                        | team          | Accepts an invitation                         | idempotency key                   |
| GET    | `/team/delegations`                          | team          | Approval delegations                          | `team:read`                       |
| POST   | `/team/delegations`                          | team          | Creates a delegation                          | `team:manage_delegations`         |
| POST   | `/team/delegations/:id/revoke`               | team          | Revokes a delegation                          | `team:manage_delegations`         |
| GET    | `/notifications`                             | notifications | In-app notifications                          | own records                       |
| POST   | `/notifications/:id/read`                    | notifications | Marks one read                                | own records                       |
| POST   | `/notifications/read-all`                    | notifications | Marks all read                                | own records                       |
| GET    | `/notifications/preferences`                 | notifications | Category × channel preferences                | own preferences                   |
| PUT    | `/notifications/preferences`                 | notifications | Saves preferences                             | own preferences                   |
| GET    | `/notifications/delivery-failures`           | notifications | Failed deliveries                             | owner/admin/finance               |
| POST   | `/notifications/delivery-failures/:id/retry` | notifications | Retries a delivery                            | audited                           |
| POST   | `/media/uploads`                             | media         | Creates an upload intent and signed URL       | idempotency key                   |
| POST   | `/media/uploads/:uploadId/complete`          | media         | Completes an upload, extracts metadata        | idempotency key                   |
| GET    | `/media`                                     | media         | Lists media for a subject                     | tenant-scoped                     |
| GET    | `/media/:id`                                 | media         | Media metadata and quality results            | tenant-scoped                     |
| GET    | `/media/:id/content`                         | media         | Streams/serves media content                  | signed or session                 |
| PUT    | `/storage/upload/:token`                     | storage       | Signed upload target                          | token                             |
| GET    | `/storage/object/:token`                     | storage       | Signed download target                        | token                             |
| GET    | `/audit-events`                              | audit         | Audit event query                             | `audit:read`                      |
| GET    | `/admin/queue`                               | admin         | Platform job queue health                     | platform admin                    |

### 9.2 Planned endpoints referenced by this volume

These paths are proposals owned by the module named; they must be registered in
`modules/registry.ts` and covered by contracts before a control may use them.

| Area        | Proposed endpoints                                                                                                                                                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dashboard   | `GET /v1/dashboard` (queues, counts, generatedAt)                                                                                                                                                                                                                 |
| search      | `GET /v1/search?q=&limit=` (tenant-scoped results)                                                                                                                                                                                                                |
| properties  | `GET /v1/properties/address-search?q=`, `POST /v1/properties`                                                                                                                                                                                                     |
| imagery     | `GET /v1/imagery/candidates`, `POST /v1/imagery/orders`                                                                                                                                                                                                           |
| roof        | `GET/POST /v1/roof/orders`, `GET /v1/roof/orders/:id`, `POST /v1/roof/orders/:id/transitions`, `POST /v1/roof/orders/:id/cancel`, `GET /v1/roof/reports/:id`, `PATCH /v1/roof/reports/:id/geometry`, `POST /v1/roof/reports/:id/{submit,approve,issue,overrides}` |
| reviews     | `POST /v1/reviews/:id/{claim,assign,decide}`                                                                                                                                                                                                                      |
| curb        | `GET/POST /v1/curb/projects`, `GET /v1/curb/projects/:id`, `POST /v1/curb/projects/:id/{calibrations,segments,risks,permits,estimates}`                                                                                                                           |
| estimates   | `GET /v1/estimates/:id`, `GET /v1/estimates/:id/gates`, `POST /v1/estimates/:id/approvals`                                                                                                                                                                        |
| price books | `GET/POST /v1/price-books`, `PUT /v1/price-books/:id/revisions/:rev`, `POST /v1/price-books/:id/revisions/:rev/approve`, `POST /v1/price-books/:id/retire`                                                                                                        |
| CRM         | `GET/POST /v1/leads`, `GET/PATCH /v1/leads/:id`, `POST /v1/leads/:id/{notes,convert}`, `PATCH /v1/customers/:id`                                                                                                                                                  |
| jobs        | `GET/POST /v1/jobs`, `GET /v1/jobs/:id`, `POST /v1/jobs/:id/{stage,tasks,dispatch}`, `GET /v1/jobs/:id/readiness`                                                                                                                                                 |
| proposals   | `GET/POST /v1/proposals`, `GET/PATCH /v1/proposals/:id`, `POST /v1/proposals/:id/{send,void,approve}`                                                                                                                                                             |
| invoicing   | `GET/POST /v1/invoices`, `GET /v1/invoices/:id`, `POST /v1/invoices/:id/{issue,void}`, `POST /v1/payments`                                                                                                                                                        |
| exports     | `POST /v1/exports` (PDF, CSV)                                                                                                                                                                                                                                     |
| portal      | `GET /v1/portal/:token`, `POST /v1/portal/:token/{select,sign,pay,uploads,messages}`, `POST /v1/portal-links`                                                                                                                                                     |
| reports     | `GET /v1/reports/kpis?from=&to=`                                                                                                                                                                                                                                  |

## 10. State conventions

| State          | Requirement                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Loading        | Skeleton with an accessible label; never a spinner-only page.                                   |
| Empty          | Says what will appear, why it is empty, and the first action to create a record.                |
| Not available  | Feature not built or not indexed: honest copy, no error tone, no fabricated rows.               |
| Denied         | Route-level explanation of the missing role; in-page controls stay visible with a reason.       |
| Flag off       | "Not enabled for your company yet" with request path; never partial fake data.                  |
| Error          | Title, safe detail, field errors, correlation id, retry if retryable.                           |
| Offline        | Cached shell plus queued-write notice; mutations are queued or blocked, never silently dropped. |
| Conflict (412) | Reload the newer revision, preserve the user's draft, state plainly that it was not saved.      |
| Success        | Toast or live-region message naming what changed; focus returns to a sensible place.            |
| Destructive    | Confirmation dialog naming the consequence; irreversible actions require typed confirmation.    |

## 11. Permissions and flags coverage

- Every control inherits its screen permission. Controls that need a stronger action name it:
  transfers, approvals, issuance, voids, payments, overrides, dispatch, price-book approval, and
  feature-flag management.
- Denied controls remain visible (`GuardedButton`) with the reason from `explainDenied`.
- Screen flags come from the route registry; per-control availability follows the same flag unless
  documented otherwise. `roof.diy_canvas`, `roof.assisted_review`, `curb.guided_capture`,
  `roof.auto_facets`, `curb.ai_measurement`, `billing.online_payments`, `ops.supplier_orders`,
  `notifications.sms`, and `portal.homeowner` gate their controls exactly as `flags.ts` describes.
- The API never trusts the UI gate: every handler re-evaluates role, override, tenant, and flag.

## 12. Test obligations

Existing evidence: `AppFrame.test.tsx`, `TeamView.test.tsx`, `navigation.test.ts`, `routing.test.ts`,
RBAC and resource contract tests in `packages/contracts`, API tests in `apps/api/src/app.test.ts`
and `security-probes.test.ts`, and the Playwright journey in `apps/web/e2e/home.spec.ts`.

For every screen in this volume, the following must exist before it is marked `implemented`:

1. A unit or component test for gating (permission denied, flag off, honest empty).
2. An API integration test for each endpoint the screen calls: success, validation failure,
   unauthorized role, cross-tenant access, and revision conflict where versioned.
3. A browser journey for the primary flow, including its error path, on desktop and a phone viewport.
4. An accessibility check for focus order, labels, dialog behaviour, and announcements.
5. A test that the screen never renders fabricated records when its endpoint is unavailable.

Test names carry the requirement IDs (for example `CP-052-API: …`, `PLT-015-FE: …`) as the root
README requires, and evidence is recorded in `docs/requirements/evidence.yaml`.

## 13. Traceability and change procedure

For each control, the traceability record is:

`control ID → screen route ID → frontend component/event → endpoint → handler module → tables →
permission → audit event → test → this document`.

Changing a screen requires, in one change set: the registry entry, the control row in this volume,
the endpoint and handler (or an explicit planned marker), the permission/flag decision, tests, and
the traceability evidence. Renaming or renumbering a control ID is prohibited; add a new ID and
retire the old one with a note in the Volume 2 change log below.

### Change log

| Date       | Change                                                                   |
| ---------- | ------------------------------------------------------------------------ |
| 2026-11-11 | First edition: 36 screens, control registry, live/planned API catalogue. |

## 14. Known gaps in this edition

1. The `dashboard` and `search` modules are stubs, so Home and Search are `partial` despite having
   real UI.
2. No product endpoints exist for roof, curb, leads, customers, jobs, proposals, invoices,
   payments, price books, reviews, exports, portal, or reports; every control in those areas is
   `planned`, and the list pages are honest placeholders.
3. There is no route for feature-flag governance, audit browsing, or admin queue monitoring; those
   are API-only today.
4. Payment, signature, mail, and imagery vendor choices are pending; controls that depend on them
   are `blocked_vendor` until `docs/product/licensing-register.md` and owner decisions record a
   provider.
5. Volume 2 does not yet include copy decks, visual specifications, or a generated control-registry
   export; those are Volume 3 deliverables.
