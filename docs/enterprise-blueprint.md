# Enterprise Blueprint

Open `/enterprise/blueprint` in the signed-in workspace. An owner or administrator enables the
Enterprise Suite for the company. Each Enterprise project belongs to one company. Blueprint records
carry an owner, due date, SLA target and exception queue so teams can work the daily queue.

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
| Blueprint records   | Track tenant-scoped work and evidence with an owner, due date and SLA. The server validates package fields and statuses, checks revisions, and records mutations in the Enterprise audit log.                                                   |
| Exception inbox     | On the Blueprint page, aggregate overdue, blocked and SLA-breached records across every package. Filter by owner and exception type, open a record, or clear an explicit block.                                                                 |
| Change order queue  | Search and paginate across the company at `/enterprise/change-orders/queue` or within a project at `/enterprise/projects/{projectId}/change-orders`.                                                                                            |
| Change order detail | Review scope, pricing delta, schedule impact, current revision and audit history at `/enterprise/change-orders/{id}`. Owner and administrator approval uses the existing revision-checked command and updates the revised contract calculation. |
| Field Execution     | Create project punch items with a location and optional due date at `/enterprise/field`. Track work through review and closeout. Review decisions require the review permission and a note.                                                     |

Change order queue and detail access requires `job:read` and Enterprise enrollment. The punch list
uses the same entitlement and scopes reads to a verified project in the active company. Creates
require `job:write`; retried creates return the original row when the project and request ID match.
A status write requires `If-Match` and the permission for the relevant workflow stage. Migration
`0040_enterprise_punch_items.sql` adds the table and its tenant policy.

### Scheduling, document control, and change pricing

- **Scheduling** at `/enterprise/scheduling` keeps planned, forecast, and actual dates distinct.
  Successors use finish-to-start dependencies with a calendar-day lag. Editors preview all forecast
  changes before applying a new revision. Company owners and administrators can save forecast
  baselines and reusable templates. Templates carry task offsets and dependency links and create
  new tasks on application.
- **Document Vault** at `/enterprise/vault` stores company-internal PDFs through the configured
  encrypted storage adapter. Each upload fixes the file bytes and checksum to a version. It
  supports downloads of earlier versions and records reviewer decisions for the current version.
  Uploads accept PDFs up to 8 MiB, subject to the configured storage limit. The UI shows the
  actual scan result. Durable production files require a persistent storage backend.
- **Change order pricing** on the change-order detail page supports additions, deductions,
  quantities, markup, tax, revision notes, schedule impact, and a linked vault version. It computes
  totals on the server and keeps prior pricing revisions. Submission locks edits. Approved
  totals flow through the existing revised contract and Schedule of Values calculation.

- **Daily site reports** in Field Execution record weather, crew hours, completed work, safety
  notes, and delays. A report can link to a schedule task from its project. Submitted reports
  lock until a reviewer approves them or asks for changes. Revision checks protect edits, and
  review decisions are audited.

The schedule uses calendar days and one predecessor per task. The vault serves files as attachments
after verifying tenant, project, and checksum. The routes preserve existing project records and
single-amount change orders through migrations `0041`–`0045`.

## Data and API

- Table: `enterprise_suite.work_package_records` (migrations `0039_enterprise_blueprint.sql` and
  `0045_enterprise_blueprint_workflow.sql`). Tenant-owned, RLS enabled, revision column, optional
  commercial project link, optional `client_request_id` for idempotent retries, owner, due date,
  SLA hours and explicit block reason.
- `GET /v1/enterprise/blueprint` returns record counts by package and status.
- `GET /v1/enterprise/blueprint/exceptions` returns the daily exception queue. Optional filters are
  `kind=all|overdue|blocked|sla`, `owner=<uuid>|unassigned`, `package=<code>` and `limit`.
- `GET /v1/enterprise/blueprint/:code/records` lists one package's records with owner names.
- `POST /v1/enterprise/blueprint/:code/records` creates a record. The server rejects unknown field
  keys, indexed-only packages and projects from another tenant; when `clientRequestId` repeats, the
  original record is returned.
- `PATCH /v1/enterprise/blueprint/records/:id` changes status, fields, notes, owner, due date, SLA or
  block reason. Status must belong to the package lifecycle, stale `If-Match` revisions conflict,
  and each change is audited.
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

## Ownership, SLAs and exceptions

- `ownerUserId` must be an active member of the same company, or `null` to unassign.
- `dueOn` is a calendar date (`YYYY-MM-DD`); due dates in the past are allowed so imported or
  backfilled records can surface immediately.
- `slaHours` is a whole number from 1 to 8,760. The SLA target is derived from `createdAt` plus
  those hours, so reporting does not depend on a client clock.
- `blockedReason` is explicit and can be used on any package. A package's native `blocked` status
  also counts as blocked. Finished records cannot stay blocked; moving to a finished status clears
  the block and removes the record from the queue.

`packages/contracts/src/enterpriseBlueprintWorkflow.ts` owns the shared rules. The exception inbox
includes a record when it is overdue, blocked, or past its SLA target. A record can have more than
one reason and is counted once in the queue total. The dashboard reports separate overdue, blocked
and SLA-breached counts plus the unassigned count; the list sorts blocked records first, then by due
date and SLA target.

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
formulas, ownership and SLA rules, the exception queue, change order approval, tenant isolation,
pagination, punch item retries, stale revisions, reviewer permissions, and recorded history. The unit
suite also covers the 157-package catalog, field-key uniqueness, lifecycle ordering, typed-schema
coverage, computed formulas, ownership/SLA/exception rules, and addendum-to-package links.

## Remaining work

The package catalog tracks evidence inside Field Pro. Customer approval and purchasing amendments
remain open in Change Orders. Scheduling still needs trade capacity, working calendars, and
external notifications. Field Execution still needs floor-plan pins, photo evidence, and offline
synchronization. Provider connections for payments, accounting, signatures, and external portals
require authorized environments and verified contracts. BIM and full plan takeoff still require
their domain workflows.
