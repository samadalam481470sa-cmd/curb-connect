# @fieldline/web

Next.js 16 App Router shell for Field Pro (installable PWA). It talks only to its own origin;
`/v1/*` is rewritten to the API (`API_PROXY_TARGET`, default `http://localhost:4000`) so the
`fl_session` cookie stays first-party.

```
npm run dev -w @fieldline/web        # http://localhost:3000
npm run typecheck|lint|test -w @fieldline/web
npm run build -w @fieldline/web
npm run test:e2e -w @fieldline/web   # needs `npx playwright install` and a running API
```

## Layout

| Path                    | What                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `src/app/(app)/*`       | Signed-in areas inside `AppFrame` (session + active workspace required)                   |
| `src/app/(public)/*`    | `/sign-in`, `/access`, `/select-workspace`, `/invite/[token]`, `/onboarding`, `/offline`  |
| `src/components/shell/` | AppFrame, workspace switcher, search box, route-change focus/announcer, link interception |
| `src/features/*`        | Home dashboard, team, settings, notifications, search, onboarding, auth views             |
| `src/lib/api.ts`        | Typed fetch client: credentials, X-Request-Id, Idempotency-Key, If-Match, problem+json    |
| `src/lib/endpoints.ts`  | Every API path the web calls, typed against `@fieldline/contracts`                        |
| `src/lib/offline/`      | IndexedDB draft store and write/upload outbox (idempotency keys reused on retry)          |
| `public/sw.js`          | Service worker: caches the app shell and `/_next/static` only, never `/v1` or navigations |

Navigation, breadcrumbs, permissions and analytics names come from the contracts route registry
(`PRIMARY_ROUTES`, `DETAIL_ROUTES`); `/v1/me` supplies effective permissions and flags. The UI only
hides or explains actions; the API decides.

## API contract assumptions (for the API / contracts owners)

These endpoints are called as written in `src/lib/endpoints.ts`. Where contracts has no DTO yet,
the web defines the schema locally (marked "Proposed contract"):

- `GET /v1/auth/providers` -> `{ providers: [{ id, label, available, developmentOnly }] }` (unavailable ones are hidden)
- `GET /v1/auth/login/:provider?returnTo=` (browser navigation, starts OIDC + PKCE); `POST /v1/auth/logout`
- `GET /v1/me` -> `MeResponse` (note: `flags` is a zod record over the flag enum, so **every** flag key must be present)
- `POST /v1/session/active-org` `{ orgId }` -> `MeResponse`
- `POST /v1/orgs` (Idempotency-Key) -> `Organization`; `GET|PATCH /v1/orgs/current` (If-Match `"revision"`)
- `GET /v1/orgs/current/settings`; `PUT /v1/orgs/current/settings/:section` `{ settings, changeReason }` -> `OrgSettings`
  (sections: general, estimating, billing, notifications, onboarding; each is strictly validated and versioned)
- `GET /v1/team/members`, `PATCH /v1/team/members/:id` (If-Match), `GET|POST /v1/team/invitations`,
  `POST /v1/team/invitations/:id/revoke`, `POST /v1/team/transfer-ownership` `{ toMembershipId }`
- `POST /v1/invitations/preview` `{ token }` -> `{ orgDisplayName, role, status, expiresAt, invitedByName }`;
  `POST /v1/invitations/accept` `{ token }` (Idempotency-Key) -> `MembershipSummary`
- `GET /v1/dashboard` -> `DashboardResponse`; `GET /v1/search?q=` -> `SearchResponse`
- `GET|PUT /v1/notifications/preferences` -> `{ preferences: NotificationPreference[] }`
- `POST /v1/media/uploads` (Idempotency-Key) -> `CreateUploadResponse`, then `PUT uploadUrl`

A `404` from dashboard, search or notification preferences is shown as "not available yet",
never as fake data.
