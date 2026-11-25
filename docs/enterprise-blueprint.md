# Enterprise Blueprint

Open `/enterprise/blueprint` in the signed-in workspace. An owner or administrator enables the
Enterprise Suite for the company. Each Enterprise project belongs to one company. Blueprint records
carry an owner, due date, SLA target and exception queue so teams can work the daily queue, records
can be linked across packages for handoffs and impact analysis, a project playbook narrows the
catalog to the required work for one project, and each addendum control gate carries owned,
reviewed evidence and an exportable audit packet.

## Specification coverage

The 1,433-page master contains 100 core packages (pp. 11–510), 57 expansion packages (pp. 520–804),
312 implementation appendix pages (pp. 807–1118), and the 315-page control-level addendum
(pp. 1119–1433). The expanded v5 addendum reproduces those 315 pages and adds 247
pages of control contracts.

The catalog opens all 157 work packages with their specified fields, actions, lifecycle, exception
path, proposed persistence, and a source page reference. A package deep link takes the form
`/enterprise/blueprint?wp=148`. The addendum view indexes its 234 feature-control pages across 13
areas, 20 shared platform control pages, seven cross-module scenarios, and 52 granular matrices.
The takeoff action matrix spans two pages.

The [Enterprise verification ledger](requirements/enterprise/audit-ledger.md) tracks the v4 and
expanded v5 sources, implemented requirements, and passing tests.

## Operating workflows

| Surface             | Behavior                                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Blueprint records   | Track tenant-scoped work and evidence with an owner, due date and SLA. The server validates package fields and statuses, checks revisions, and records mutations in the Enterprise audit log.                                                      |
| Exception inbox     | On the Blueprint page, aggregate overdue, blocked and SLA-breached records across every package. Filter by owner and exception type, open a record, or clear an explicit block.                                                                    |
| Typed record links  | On each record, connect another package's record as blocks, evidence_for, billed_by or change_order_for. The panel shows direct links, upstream blockers, and downstream impact.                                                                   |
| Project playbook    | Pick a project, project type and phase. Review required package records, phase gates, package/record owners, and the next action for each missing or active record.                                                                                |
| Control compliance  | In the addendum view, assign an owner and refresh date to each of the 18 control gates, attach evidence with optional PDFs, and require an independent reviewer to accept it. Export a checksummed audit packet for the module or the whole suite. |
| Change order queue  | Search and paginate across the company at `/enterprise/change-orders/queue` or within a project at `/enterprise/projects/{projectId}/change-orders`.                                                                                               |
| Change order detail | Review scope, pricing delta, schedule impact, current revision and audit history at `/enterprise/change-orders/{id}`. Owner and administrator approval uses the existing revision-checked command and updates the revised contract calculation.    |
| Field Execution     | Create project punch items with a location and optional due date at `/enterprise/field`. Track work through review and closeout. Review decisions require the review permission and a note.                                                        |

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

- **Vendor Bidding** at `/enterprise/bids` creates project bid packages with a scope and quote due
  date, records quotes received by the builder, and compares price, lead time, validity, and
  qualifications. An owner or administrator can award a current quote or close the package with a
  decision note. The award locks the package and records an audit event. Owners and administrators
  can review scope, schedule, and qualification evidence. A responsive decision with an unmet
  criterion requires a documented exception. A quote marked nonresponsive is unavailable for award.
- **Purchase orders** implement award conversion from the v5 addendum (p. 524, Vendor Bidding
  A09). An owner or administrator creates project purchase cost codes and converts a confirmed
  award into a draft using the existing lump-sum quote and a delivery address snapshot. The draft
  keeps the awarded quote, vendor, amount and scope. Owners and administrators can revise delivery
  details and the cost code, then issue the order. Repeating either command returns the same
  record. Issued orders are immutable. `/enterprise/costing` reports committed amounts by project
  and purchase cost code, with a filter to view source orders. Issuance is recorded in FieldPro.
  The purchasing team handles vendor delivery separately.

- **Digital Takeoff** at `/enterprise/takeoff` accepts up to five plan PDF versions from a
  project's private Document Vault and imports up to 150 sheets per plan set. Each sheet retains
  its Vault version, PDF page, dimensions, and rotation. An unreadable source prevents the whole
  import. Users can open each sheet at the exact PDF revision, browse thumbnails, zoom, pan, rotate,
  fit the drawing, and download its Vault source. Zoom is saved on the device. Estimators can
  calibrate each sheet from two points and a known dimension. The workspace can verify the scale
  against another dimension and retains calibration history. Estimators can draw polylines,
  assign a measurement category, and save lengths. Earlier lengths retain their original values
  and show a review notice after recalibration. The area tool saves exterior and deduction
  boundaries and reports net area and separate perimeters. The object count tool stores one marker
  per item, warns about nearby draft markers, and retains the history of removed markers. Users
  can tag saved measurements with floor, room, material, phase, trade, and alternate, then show
  only the measurements tagged to a selected floor. Estimators can submit an exact measurement
  for review. Reviewers record a decision and reason. Incorrect or superseded scales and changed
  counts prevent approval. Earlier decisions remain visible in the review history.
  Users can align and compare two authorized plan revisions. The server checks both source file
  hashes and renders an overlay that marks added and removed drawing pixels while retaining the
  source drawings, calibrations, and decisions. Review notes stay anchored to their original
  sheet pair and alignment. An estimator can preview and export the approved length, area, and count
  layers for an exact sheet. The saved PDF includes the drawing, approved totals, scale, and revision.

- **Estimating** at `/enterprise/estimating` and `/enterprise/projects/{projectId}/estimate` supports
  blank commercial estimate drafts with a currency, quantity precision, and unit-specific line
  items. Authorized reviewers can freeze the recorded quantities with an approval reason. The
  approved snapshot remains available in the project workspace. Takeoff can push a current approved
  measurement into compatible draft lines. The conversion preview shows the quantity before rounding,
  and confirmation records the rounded quantity and its original measurement. Replacing an existing
  quantity requires a reason. A draft can also open its own list of current approved takeoff
  measurements and import from that list. Each line shows whether its quantity came from Takeoff.
  Estimators can create a new draft revision with a reason and retain the earlier read-only snapshot,
  including its quantities and takeoff source references. Draft lines can carry exact unit rates and
  be revised with a reason. The comparison shows changes to scope, quantities, and extended costs
  beside the original values.

The schedule uses calendar days and one predecessor per task. The vault serves files as attachments
after verifying tenant, project, and checksum. The routes preserve existing project records and
single-amount change orders through migrations `0041`–`0065`.

## Data and API

- Table: `enterprise_suite.work_package_records` (migrations `0039_enterprise_blueprint.sql` and
  `0045_enterprise_blueprint_workflow.sql`). Tenant-owned, RLS enabled, revision column, optional
  commercial project link, optional `client_request_id` for idempotent retries, owner, due date,
  SLA hours and explicit block reason.
- Table: `enterprise_suite.work_package_record_links` (migration
  `0050_enterprise_blueprint_links.sql`). Tenant-owned, RLS enabled, typed edges with a unique
  `(org_id, from_record_id, to_record_id, kind)` constraint and cascade from either record.
- Tables: `enterprise_suite.control_requirements` and `enterprise_suite.control_evidence`
  (migration `0053_enterprise_control_compliance.sql`). One requirement per organization, module
  and gate carries the owner, refresh date, note and revision. Evidence rows carry the evidence
  date, optional expiry, source reference, optional encrypted PDF attachment with its SHA-256 and
  size, and an immutable review decision. Both tables are tenant-owned with RLS enabled.
- `GET /v1/enterprise/blueprint` returns record counts by package and status.
- `GET /v1/enterprise/blueprint/records` searches records across packages for the link picker.
  Optional filters are `q`, `package` and `limit`.
- `GET /v1/enterprise/blueprint/records/:id/links` returns direct links plus upstream and downstream
  block impact.
- `POST /v1/enterprise/blueprint/records/:id/links` creates a typed link to `toRecordId`.
- `DELETE /v1/enterprise/blueprint/records/:id/links/:linkId` removes an outgoing link.
- `GET /v1/enterprise/blueprint/controls?module=<key>` returns the 18 gates for one module (or all
  13 modules) with their owner, refresh date, evidence, review state and derived compliance state.
- `PUT /v1/enterprise/blueprint/controls/:moduleKey/:gateKey` assigns an owner, refresh date or note.
  The owner must be an active member. Once the requirement exists, the write requires `If-Match`
  and a stale revision conflicts.
- `POST /v1/enterprise/blueprint/controls/:moduleKey/:gateKey/evidence` adds evidence, optionally
  with a PDF attachment up to 8 MiB. Uploaded bytes are scanned, stored under the tenant prefix,
  and recorded with their SHA-256 and size. Without an explicit expiry, the evidence expires after
  the gate's validity period counted from its evidence date.
- `POST /v1/enterprise/blueprint/control-evidence/:id/review` accepts or rejects pending evidence
  with `review_task:decide`. The submitter cannot accept their own evidence, and a decision is
  final.
- `GET /v1/enterprise/blueprint/control-evidence/:id/download` streams the attachment after
  verifying tenant ownership, size and checksum.
- `GET /v1/enterprise/blueprint/controls/audit-packet?module=<key>` downloads a JSON audit packet
  with the generated timestamp, organization, policy, every requirement and evidence record, and a
  SHA-256 digest over the canonical packet contents. The export itself is audited.
- `GET /v1/enterprise/projects/:projectId/playbook` returns the phase packages, gate state,
  owners and next actions for one project. It requires `type=residential|multifamily|commercial|remodel|land-development`
  and accepts an optional `phase=planning|preconstruction|construction|closeout`.
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

### Evidence-backed control gates

The addendum's 18 gates are requirements, not a static checklist. Each gate carries the outcome it
must prove and the evidence an auditor should expect. An organization assigns an active member as
owner, sets the date the evidence must be refreshed, and attaches evidence with its own evidence
date and expiry. If no expiry is supplied, it is set to the gate's validity period from the
evidence date, so accepted proof cannot remain current indefinitely. Evidence is submitted for
review; only a member with `review_task:decide` can
accept or reject it, and the submitter cannot accept their own evidence.

Gate status is derived, never set directly:

- `missing` — no owner, refresh date or evidence.
- `in_progress` — an owner or refresh date is set, but no accepted evidence exists.
- `pending_review` — evidence exists but no reviewer has accepted it.
- `satisfied` — at least one accepted evidence item is current.
- `expiring` — accepted evidence or the requirement expires within 30 days.
- `expired` — the requirement date or every accepted evidence item has passed.

Pending, rejected and expired evidence never satisfies a gate. The module summary counts each
state, assigned owners and attachment count. The exported audit packet records the policy, scope,
timestamp and every requirement/evidence field, then adds a SHA-256 digest over the canonical
contents so a recipient can detect a changed packet. Attachment bytes are not embedded in the
packet; each attachment keeps its recorded SHA-256 and can be downloaded separately.

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

## Typed record links

`packages/contracts/src/enterpriseBlueprintLinks.ts` defines the relation rules shared by the API and
web app. Link direction always reads from the source record to the target:

| Kind               | Rule                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `blocks`           | Any package; the source must finish before the target. Block links must remain acyclic.                                               |
| `evidence_for`     | Source must be an evidence-producing package (daily logs, inspections, RFIs, submittals, punch, takeoffs, completion, photos, forms). |
| `billed_by`        | Target must be AP (`072`), AR (`073`), progress billing (`074`) or contractor invoice (`114`).                                        |
| `change_order_for` | Source must be a change order (`048`); the target is the project, contract, commitment or work record it modifies.                    |

Evidence, billing and change-order links require both records to be on the same project when both
records have a project. A record cannot link to itself, the same source/target/kind pair cannot
repeat, and a block link that would complete a cycle is refused. Link creation and removal are
audited against the source record.

The record panel walks the block graph for impact: upstream records transitively block the current
record, downstream records are transitively blocked by it. The global record search backs the target
picker so a handoff can select a record from another work package by title or package code.

## Project playbook

`packages/contracts/src/enterpriseProjectPlaybook.ts` selects required package codes by project type
and delivery phase:

| Phase           | Gate                        | Required work                                                                                                     |
| --------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Plan & design   | Plan approval gate          | Project setup, WBS, schedule basis, estimate, takeoff, design/CAD and type-specific planning packages.            |
| Preconstruction | Field release gate          | Permits, submittals, bid packages, bid comparison, contract award, purchase orders and estimate-to-field handoff. |
| Construction    | Substantial completion gate | Daily logs, inspections, safety, RFIs, change orders, material receiving and type-specific field packages.        |
| Closeout        | Closeout gate               | Punch/turnover, budget and job costing, billing, retainage and lien-waiver records.                               |

The playbook joins the selection to records already assigned to the project. Each step reports the
latest record, record count, stage, package or record owner, and a next action (create, advance,
clear block, review or complete). A phase gate closes only when every required package in that phase
has a complete latest record; blocked or overdue records hold the gate as `blocked` or `at_risk`.
The project type is a planning lens and does not rewrite existing records.

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
formulas, ownership and SLA rules, the exception queue, typed links and block impact, project
playbook selection and live next actions, change order approval, tenant isolation, pagination, punch
item retries, stale revisions, reviewer permissions, recorded history, and concurrent purchase-order
conversion and issuance. The unit suite also covers the 157-package catalog, field-key uniqueness,
lifecycle ordering, typed-schema coverage, computed formulas, ownership/SLA/exception rules, link
rules, cycle prevention, project-type playbook coverage, and addendum-to-package links.

## Remaining work

The package catalog tracks evidence inside Field Pro. Customer approval and purchasing amendments
remain open in Change Orders. Scheduling still needs trade capacity, working calendars, and
external notifications. Field Execution still needs floor-plan pins, photo evidence, and offline
synchronization. Provider connections for payments, accounting, signatures, and external portals
require authorized environments and verified contracts. External RFQ invitations and vendor-side
purchase order delivery are still open. BIM still requires its domain workflows. Takeoff still needs high-resolution tiled rendering,
measurement conditions and estimate transfer.
