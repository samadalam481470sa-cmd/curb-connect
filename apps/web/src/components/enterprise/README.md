# Commercial project controls — frontend integration

This add-on is isolated under `/enterprise` and does not replace the existing
roof, curb, jobs or billing applications. It uses the **existing** Next.js App Router,
Fieldline design tokens, session-scoped API client, React Query and role checks.
The supplied example used Tailwind, but Tailwind is **not** installed in this monorepo.

## Rollout state

**Not production-ready yet.** The `enterprise.project_controls` feature flag is
**off by default**. The frontend screens and typed client contracts exist; the
backend routes below do not. The existing `changeorders` Fastify module is a
stub, and no commercial RFI module exists. The UI intentionally displays an
error instead of fabricating RFI/CO data if routes are unavailable.

### Proposed /v1 API

All calls must be scoped to the user's active organization, verified server-side.
The `projectId` path segment identifies an existing project that belongs to it.

| Method | Path | Response |
| --- | --- | --- |
| GET | /v1/projects/:projectId/rfis | RFI[] |
| PATCH | /v1/projects/:projectId/rfis/:rfiId | Updated RFI or 204 |
| GET | /v1/projects/:projectId/change-orders | ChangeOrder[] |
| PATCH | /v1/projects/:projectId/change-orders/:coId | Updated CO or 204 |

RFI and ChangeOrder JSON field shapes are defined in
`src/types/enterprise.ts`. For PATCH, send `{status, official_response?}`
for RFIs and `{status}` for change orders. Use problem+json for failures.

**Backend schema compatibility:** The existing change_orders table attaches to
`job_id` and uses a different status enum and `amount_delta_minor`. Do
not directly expose it as the proposed DTO: decide whether a commercial
project maps to a job, define an explicit status mapping/migration, and convert
money from minor units into decimal currency amounts without floating-point
rounding errors. RFI persistence and audit schema must be added separately.

### Required backend launch gates

- Verify the active organization, project membership, per-resource ownership
  and effective permissions for **every** request.
- Authorize official RFI answers specifically for designated architect/engineer
  responders. `job:write` is only a provisional **frontend** visibility check.
- Validate transitions in a database transaction (including concurrent edits);
  reject stale writes via revisions/If-Match, and keep an immutable audit history.
- Treat `submitted_to_owner -> approved` as an actual owner authorization:
  verify the approver identity, external owner consent/signature (if applicable),
  signed date, and project contract terms. A UI role or button is not consent.
- Enforce data validation, stable project-specific sequence numbers, rate limits,
  safe notification delivery and attachment access controls.
- Implement API integration tests for tenant isolation, unauthorized approvals,
  concurrent transition conflicts, rejection and retry behavior.
- Only enable `enterprise.project_controls` after migrations, API routes,
  authorization, test coverage and product acceptance checks pass.

There is no synthetic fallback to localStorage or seeded approvals.
