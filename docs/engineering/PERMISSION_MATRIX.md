# Permission matrix (engineering view)

**Source of truth is code:** `packages/contracts/src/rbac.ts` (`POLICY`, `can`,
`effectivePermissions`, `PORTAL_POLICY`), enforced by the API on every request. The human-readable
transcription already exists at [docs/product/permission-matrix.md](../product/permission-matrix.md)
and must not be duplicated here; this file records enforcement, the role-model gap against the
blueprint, and the audit-relevant facts.

## 1. Enforcement chain

1. Session cookie → server-side session row (opaque token, SHA-256 stored, idle + absolute expiry).
2. `external_identities(issuer, subject)` → `users.id`.
3. Active organisation from the session, re-validated against `memberships` (status must be active).
4. Role from the membership + active per-member overrides (deny wins; owner cannot be locked out of
   team/ownership actions).
5. `can(role, action)` gate before the handler body; `assertCan()` for stricter sub-checks.
6. Tenant transaction sets `app.org_id` / `app.user_id` so RLS also applies.
7. Audit row written in the same transaction.

The web app uses the same matrix **only** to hide controls and explain denials
(`apps/web/src/components/RouteGate.tsx`, `lib/navigation.ts`). Hiding a button is not
authorization.

## 2. Roles in code

| Code role      | Label                      | Intended scope                                                               |
| -------------- | -------------------------- | ---------------------------------------------------------------------------- |
| `owner`        | Owner                      | full control, ownership transfer, closing the company                        |
| `admin`        | Admin                      | team, settings, pricing, workflows except ownership                          |
| `estimator`    | Estimator                  | measures roofs/curbs, prepares estimates and proposals; cannot approve       |
| `reviewer`     | Reviewer                   | verifies measurements, resolves risk flags, approves gated estimates/reports |
| `salesperson`  | Salesperson                | leads, customers, proposals, sending for signature                           |
| `crew_manager` | Crew manager               | crews, schedules, supplier orders, dispatch release                          |
| `finance`      | Finance                    | invoices, payments, refunds, price books, billing settings                   |
| `read_only`    | Read-only                  | view only; no internal costs                                                 |
| —              | Homeowner portal principal | not a member; token scoped to one resource via `PORTAL_POLICY`               |

## 3. Role-model gap against the blueprint

The blueprint proposes Owner, Administrator, Manager, Estimator, Field Supervisor, Crew Member,
Accountant, Sales, Customer, Subcontractor, Read-only. Mapping:

| Blueprint role   | Nearest existing role                        | Gap                                                                                                                       |
| ---------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Owner            | `owner`                                      | none                                                                                                                      |
| Administrator    | `admin`                                      | none                                                                                                                      |
| Manager          | `admin` (partly `reviewer`)                  | **no separate manager role**; project/operational approvals are split across `admin`/`reviewer`                           |
| Estimator        | `estimator`                                  | none                                                                                                                      |
| Field Supervisor | `crew_manager` + `reviewer`                  | **no field-supervisor role**; `curb_measurement:verify` and `safety_review:sign` are granted to `reviewer`/`crew_manager` |
| Crew Member      | — (`crew_manager` is management, not member) | **no crew-member role**; no field-task-only scope exists                                                                  |
| Accountant       | `finance`                                    | naming only                                                                                                               |
| Sales            | `salesperson`                                | none                                                                                                                      |
| Customer         | portal principal                             | equivalent, but not an organisation member (by design)                                                                    |
| Subcontractor    | —                                            | **absent**; no scoped external-worker principal exists                                                                    |
| Read-only        | `read_only`                                  | none                                                                                                                      |

Adding roles is a product decision (it changes `MEMBER_ROLES`, the Postgres enum
`member_role`, the permission matrix page, the matrix tests and every gated UI). It must be an
additive enum value plus policy rows, never a rename of an existing role. Until decided, new features
must map onto the existing eight roles.

## 4. Actions gated by more than the role check

| Action                    | Additional server-side condition                                    | Source                             |
| ------------------------- | ------------------------------------------------------------------- | ---------------------------------- |
| `estimate:approve`        | zero gating blockers on the revision                                | CP-059, `docs/product/journeys.md` |
| `dispatch:release`        | permits, utility locates, safety plan, signed contract all resolved | OPS-067                            |
| `proposal:approve`        | discount below the margin floor requires approval                   | OPS-065                            |
| `curb_measurement:verify` | requires a documented site check (field_verified provenance)        | curb gate matrix                   |
| `safety_review:sign`      | named reviewer + evidence                                           | CP-055                             |
| `payment:refund`          | owner or finance only                                               | policy                             |

## 5. Audit findings and rules

| ID       | Finding                                                                               | Rule for later work                                                                                            |
| -------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| PERM-001 | RBAC policy, overrides and portal scopes are real and unit-tested                     | Extend `POLICY`; never special-case authorization in a handler                                                 |
| PERM-002 | 21 modules have no routes, so most blueprint permissions are declared but unexercised | When implementing a module, use the existing action names; add new actions to policy + docs + tests together   |
| PERM-003 | Tenant isolation has two independent layers (RLS + org filter)                        | Never query a tenant table outside `tenantTx`/`withTenant`; new tables must call `fieldline_enable_tenant_rls` |
| PERM-004 | Portal tokens are resource-scoped and cannot act as members                           | Keep portal routes in the `portal` module with `platformTx`-style token resolution, never a fake membership    |
| PERM-005 | `read_only` cannot see internal costs (`estimate:view_cost`)                          | Preserve this when building estimate UI and exports                                                            |
| PERM-006 | Owner lockout protection exists for team/ownership actions                            | Keep `OWNER_PROTECTED_ACTIONS` in sync if new ownership actions are added                                      |
| PERM-007 | No subcontractor or crew-member principal exists                                      | Do not fake one with `read_only`; propose the additive enum value first                                        |
