# SPEC-ENTERPRISE-CONTROLS.md
## Field Pro — isolated commercial construction add-on (architecture and release 1)

**Non-destructive invariant:** Existing roofing, curb, plumbing, billing, jobs and their API paths, approval flows, and database tables remain unchanged. The only edits to existing app files are an additive sidebar entry, a new stylesheet import, schema export, and registration of a new API module. The enterprise migration only creates objects within the new enterprise_suite PostgreSQL namespace. Organization owners must opt in.

## Release 1 / module status

| Module | Status and actual deliverables |
|---|---|
| Enterprise overview | Opt-in per company, separate commercial projects, responsive six-module navigation |
| BIM & Parametric 3D | Isolated section created; CAD conversion, accurate geometry and IFC import **not yet built** |
| Digital Takeoff | Isolated section created; PDF.js calibration, markups, bill of materials **not yet built** |
| Project Controls | Durable tenant-scoped RFIs, submittals, PCOs/change orders with server state machines |
| Field Execution | Isolated section; offline queue, photo evidence, pinning and sync **not yet built** |
| Document Vault | Tenant-isolated metadata and append-only audit tables prepared, no file storage or WORM guarantees yet |
| Job Costing | Preliminary durable Schedule of Values lines, retainage and approved-only CO budget revisions; no certified AIA forms |

## Compatibility and deployment

The backend needs the new SQL migration applied before the enterprise API plugin is served. Deploying the web alone will show a clear error state for /enterprise. Never reset production databases or bypass the existing RLS model. Migration includes CREATE SCHEMA, new tables and grants only. Follow the existing Drizzle migrator/CI. Deploy API and web in a coordinated change; preserve old services in case of rollback.

The user's suggested public.projects FK was not used because Field Pro does not have a universal public.projects table. Each enterprise commercial project uses its own UUID and org_id. Every child points to the enterprise project via composite (org_id,project_id) foreign keys, preventing cross-tenant relationships. Every table uses the existing fieldline_enable_tenant_rls function with app.org_id derived only from the authenticated workspace.

The settings table is an additive feature gate, not an ALTER of public.organizations. Only org:settings_update can toggle; other users see a disabled message. Any connected app and existing roofing user remains as-is.

## State transitions and permissions

RFI: draft -> open -> answered -> closed, or open -> closed with official response. Answer and closure require the review_task:decide permission. Project creation requires job:write. Change order: pco_draft -> pricing_requested -> priced -> submitted_to_owner -> approved, plus rejection before approval. Only an owner/admin can approve, and approved COs cannot be changed through the status API. Submittal: required -> submitted -> under_review -> approved / approved_as_noted / revise_and_resubmit / rejected, with resubmission increments. Submittal references are manual and **not verified file uploads**.

All transitions use If-Match with the actual record revision, enforced inside a row-lock transaction. Missing/stale revisions return precondition errors; all successful transitions append an audit event within the same transaction. These events have database-level UPDATE/DELETE prevention. This is not a claim of legally certified WORM retention without independent object-storage controls.

## API routes (behind /v1/enterprise)

- GET /status and PUT /status: company opt-in state (owner/admin writes).
- GET /projects, POST /projects: separate commercial projects.
- GET /projects/{projectId}/records: project records and provisional financial summary.
- POST /projects/{projectId}/rfis, PATCH /rfis/{id}/status: numbered RFIs and guarded transitions.
- POST /projects/{projectId}/change-orders, PATCH /change-orders/{id}/status: PCO approval pipeline.
- POST /projects/{projectId}/submittals, PATCH /submittals/{id}/status: metadata review workflow.
- POST /projects/{projectId}/sov: Schedule of Values entry in integer minor units.

All GETs require an active signed-in organization and appropriate read permissions; mutations require job/write/reviewer/owner powers. Routes use the existing first-party cookie, never accept an organization ID from the client, and use the new schema only.

## Cost arithmetic and accuracy

Money is bounded in integer cents with retainage in basis points. For each SOV line, completed = work_completed_previous + work_completed_this_period + materials_stored. It must not exceed the scheduled value. Retainage is computed from completed * retainage_bps / 10000 and rounded to the nearest cent. Revised contract = original contract + sum of approved enterprise change order deltas. Total earned less retainage = sum(completed - retainage).

The first release produces a **preliminary** progress summary, not actual G702/G703 paperwork, accounting postings, or a payment certificate. Formal pay applications need period versioning, previous certificate balances, owner review, payment reconciliation, and licensed AIA forms where applicable. Do not put sample or unapproved figures into the existing company ledger.

## Future engineering milestones (not shipped)

1. BIM: isolated geometry service, plan-to-world calibration, IFC/glTF, multi-story structural/MEP layers, geometry validation, collision checks and LOD. A single raster blueprint is not proof of dimensional accuracy.
2. Takeoff: secure original PDF storage, page-level calibration, polygon/linear/count measurement, cutouts, snap controls, reproducible assemblies, regional supplier pricing and audited re-estimating.
3. Field: browser/native local queue, signed offline mutations, server revision reconciliation, conflict resolution UI, immutable evidence object uploads and optional GPS/weather consent.
4. Vault: enterprise object-storage prefix, signed multi-part uploads, MIME validation, malware scanning, SHA-256 verification, access/retention governance, scoped transmittals and COI expiry evidence.
5. ERP: licensed or properly sourced CSI cost code catalogue, tracked PO/subcontract commitments, actual costs, labor, cost-to-complete, margin projection and certified pay applications. CSI code naming alone is not a verified full standard.
6. Cross-module events: use a tenant-scoped transactional outbox, idempotent subscribers, observable failed deliveries and replay. Consider the already-installed Graphile worker before adopting another queue.

## Acceptance criteria and rollout controls

- Existing roof and curb business flows have identical behavior and no rewritten endpoints.
- Concurrent RFI number allocation is unique per project under row lock.
- Cross-tenant UUID access and unapproved transitions fail under the app's actual restricted DB role.
- RFI, CO and submittal state changes use revision preconditions with database audit entries in the same transaction.
- Approved CO only affects the *enterprise provisional* contract summary.
- New navigation is additive and available on desktop/mobile; disabled organization only sees opt-in prompt.
- Staging migration, lint, typecheck, unit tests, PostGIS integration, app build, Playwright and Render service checks must pass before calling the release verified in production.

This foundation is phase 1 of the longer six-phase proposal. A route or metadata table does not imply the remaining geometry, upload, compliance or offline features are finished.
