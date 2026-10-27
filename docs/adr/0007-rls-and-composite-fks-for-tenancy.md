# ADR 0007: Row-Level Security and composite foreign keys for tenant isolation

- Status: Accepted
- Date: 2026-10-26
- Requirements: STR-004, PLT-015, BE-074, BE-078, LCH-091

## Context

Sprint-0 acceptance requires that a company "cannot access another company's records". A single
missed `where org_id = ?` in application code would be a cross-tenant data breach. Tenants share
one database for operational simplicity.

## Decision

Defense in depth at three layers:

1. **Schema.** Every tenant-owned table has `org_id uuid NOT NULL`, indexed. Child tables
   reference parents with composite foreign keys `(org_id, parent_id) -> parent(org_id, id)`
   (parents expose a unique `(org_id, id)`), so a row can never point at another tenant's row.
2. **Row-Level Security.** Tenant tables enable RLS with policies comparing `org_id` to
   `current_setting('app.org_id', true)::uuid`. The API runs each request in a transaction that
   first calls `set_config('app.org_id', <active org>, true)` (transaction-local, so pooled
   connections cannot leak context). The application connects with a role that does not bypass RLS.
3. **Application.** Repositories still filter by organization and the RBAC policy check runs before
   any write.

## Consequences

- A forgotten filter returns no rows instead of another tenant's rows; cross-tenant writes fail at
  the foreign-key or policy level.
- Every request that touches tenant data must open a transaction and set the org context; helpers
  make this the default path, and integration tests assert isolation across two seeded tenants.
- Migrations, seeds and maintenance jobs that legitimately span tenants need an explicit,
  audited privileged path.
- Composite keys add a column to every child foreign key and index.

## Revisit triggers

- Contractual or regulatory demand for physical isolation (schema- or database-per-tenant).
- RLS policy evaluation shows up as a significant query cost.
- Cross-tenant features (e.g. a supplier marketplace) that need carefully scoped sharing rules.
