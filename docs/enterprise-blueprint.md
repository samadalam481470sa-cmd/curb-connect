# Enterprise Blueprint

Open `/enterprise/blueprint` in the signed-in workspace. An owner or administrator enables the
Enterprise Suite for the company. Each Enterprise project belongs to one company.

## Specification coverage

The 1,433-page master contains 100 core packages (pp. 11–510), 57 expansion packages (pp. 520–804),
312 implementation appendix pages (pp. 807–1118), and the 315-page control-level addendum
(pp. 1119–1433). The separately supplied addendum duplicates the last section of the master.

The catalog opens all 157 work packages with their specified fields, actions, lifecycle, exception
path, proposed persistence, and a source page reference. A package deep link takes the form
`/enterprise/blueprint?wp=148`. The addendum view indexes its 234 feature-control pages across 13
areas, 20 shared platform control pages, seven cross-module scenarios, and 52 granular matrices.
The takeoff action matrix spans two pages.

## Operating workflows

| Surface             | Behavior                                                                                                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blueprint records   | Track tenant-scoped work and evidence. The server validates package fields and statuses, checks revisions, and records mutations in the Enterprise audit log.                                                                                   |
| Change order queue  | Search and paginate across the company at `/enterprise/change-orders/queue` or within a project at `/enterprise/projects/{projectId}/change-orders`.                                                                                            |
| Change order detail | Review scope, pricing delta, schedule impact, current revision and audit history at `/enterprise/change-orders/{id}`. Owner and administrator approval uses the existing revision-checked command and updates the revised contract calculation. |
| Field Execution     | Create project punch items with a location and optional due date at `/enterprise/field`. Track work through review and closeout. Review decisions require the review permission and a note.                                                     |

Change order queue and detail access requires `job:read` and Enterprise enrollment. The punch list
uses the same entitlement and scopes reads to a verified project in the active company. Creates
require `job:write`; retried creates return the original row when the project and request ID match.
A status write requires `If-Match` and the permission for the relevant workflow stage. Migration
`0040_enterprise_punch_items.sql` adds the table and its tenant policy.

## Data and API

- Table: `enterprise_suite.work_package_records` (migration `0039_enterprise_blueprint.sql`).
  Tenant-owned, RLS enabled, revision column, optional commercial project link, optional
  `client_request_id` for idempotent retries.
- `GET /v1/enterprise/blueprint` returns record counts by package and status.
- `GET /v1/enterprise/blueprint/:code/records` lists one package's records.
- `POST /v1/enterprise/blueprint/:code/records` creates a record. The server rejects unknown field
  keys and projects from another tenant. If `clientRequestId` repeats, the server returns the
  original record.
- `PATCH /v1/enterprise/blueprint/records/:id` changes status, fields or notes. Status must belong to
  the package lifecycle, stale `If-Match` revisions conflict, and each change is audited.
- Permission: `job:read` for reads, `job:write` for writes. The Enterprise Suite must be enabled for
  the company (`/v1/enterprise/status`).

## Typed fields

Ten high-frequency packages use schemas from `packages/contracts/src/enterpriseFieldSchemas.ts`
instead of free-text fields. The catalog still shows the documented labels, while the record API and
form use the typed definition.

| Package              | Code  | Computed fields                             |
| -------------------- | ----- | ------------------------------------------- |
| Lead capture         | `007` | —                                           |
| Opportunity pipeline | `009` | `weighted-value`                            |
| Sales proposals      | `014` | `net-price`                                 |
| Project creation     | `028` | —                                           |
| RFIs                 | `039` | `days-open`                                 |
| Submittals           | `040` | —                                           |
| Purchase orders      | `046` | `total`                                     |
| Change orders        | `048` | `revised-contract`                          |
| AP invoice capture   | `072` | `balance-due`                               |
| Progress billing     | `074` | `completed-to-date`, `retainage`, `net-due` |

- `money` values are integer minor units (US cents); the web form accepts dollars and converts.
- `date` values are `YYYY-MM-DD`; malformed and impossible dates are rejected.
- `enum` values must match the package's documented option list.
- `reference` values are UUIDs checked in the same tenant: `project` must exist, `user` must be an
  active member, and `record` must belong to the configured package when one is named. A typed
  `project` reference also fills the record's project link.
- `computed` fields are derived server-side after validation. Client-supplied computed values are
  rejected; missing optional inputs default to zero where the formula allows it.
- Packages without a typed schema keep the legacy free-text validation, so existing records and
  packages continue to work.

## Verification

Run the workspace typecheck, lint, build, unit suites and Enterprise API integration suite. The API
integration suite uses the configured PostgreSQL/PostGIS test database.

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build
npm run test:integration -w @fieldline/api -- src/modules/enterprise/
```

The Enterprise integration tests cover catalog record persistence, typed field validation, server-side
formulas, change order approval, tenant isolation, pagination, punch item retries, stale revisions,
reviewer permissions, and recorded history.

## Remaining work

The package catalog tracks evidence inside Field Pro. The full draft, line-item, customer approval,
and purchasing amendment workflows in the change order addendum remain open. Field Execution still
needs floor-plan pins, photo evidence, and offline synchronization. The other domains require their
own operational APIs and workflow tests. Provider connections for payments, accounting, signed
documents, and external portals require authorized environments and verified contracts.
