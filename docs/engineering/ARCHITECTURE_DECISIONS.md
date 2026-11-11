# Architecture decisions (audit period)

Binding decisions already exist as ADRs 0001–0008 in [`docs/adr/`](../adr/). This file records the
decisions taken **during the audit**, the conflicts between the blueprint and the repository, and
which items need a formal ADR before code is written. New ADRs continue at 0009.

## 1. Decisions taken in this audit

| ID     | Decision                                                                                       | Rationale                                                                                                                  | Reversible?           |
| ------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| AUD-01 | Treat the repository (`c91a8cc`) as the source of truth, not the blueprint's description of it | The blueprint assumes products, files and roles that are not present; guessing would create duplicates                     | n/a                   |
| AUD-02 | Keep the product name **Field Pro**; do not rename to "Curb Connect"                           | Brand lives in one constant and is referenced by routes, PDFs and the manifest; a rename is churn with no functional value | Yes, product decision |
| AUD-03 | Do not create a `marketing-site/` directory                                                    | The public site is a separate deployment and its source is not in this repository; adding one would fork the site          | Yes                   |
| AUD-04 | Preserve `legacy/curb-connect-v1` untouched                                                    | It is the only surviving prototype of measurement/estimate UI and is excluded from workspaces/CI                           | Yes                   |
| AUD-05 | Implement future work by filling the 21 stub modules; no parallel modules                      | The registry, schema files and contracts already reserve these boundaries                                                  | Yes, but costly       |
| AUD-06 | Reuse the 88-table schema and 169 DTOs; no second modelling layer                              | Duplicate tables/DTOs are the main way an additive project breaks itself                                                   | Yes, but costly       |
| AUD-07 | Keep the modular monolith with an isolated Python vision worker                                | Matches ADR 0002/0003 and the actual repo; microservices would add risk without a workload justification                   | Yes                   |
| AUD-08 | Keep feature flags as the mechanism for incomplete or unvalidated capability                   | Flag-off shows "unavailable", which satisfies the never-fabricate rule                                                     | n/a                   |
| AUD-09 | Any vendor integration must keep honest unconfigured behaviour                                 | No credentials exist; a fake success would be a defect                                                                     | n/a                   |
| AUD-10 | Documentation lives in this folder and is updated with the code it describes                   | The blueprint's traceability chain requires an inventory that is not stale                                                 | n/a                   |
| AUD-11 | Use the four blueprint statuses exactly, plus the separate verification value                  | Prevents "implemented" being claimed without an executed check                                                             | n/a                   |
| AUD-12 | Do not run destructive or production actions as part of the audit                              | Audit is read-only on the product and on git history                                                                       | n/a                   |

## 2. Conflicts needing an owner or product decision

| ID     | Conflict                                                                                                                         | Options                                                                                 | Interim behaviour                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------- |
| CON-01 | Blueprint proposes 11 roles; code has 8 + a portal principal. No manager, field supervisor, crew member, subcontractor principal | additive enum values + policy rows, or map onto existing roles                          | map onto existing roles; do not fake a role       |
| CON-02 | Blueprint calls roof/curb "existing features"; the running app has schema+engines but no screens                                 | build additively, or restore the legacy UI as a stopgap                                 | build additively; legacy stays reference          |
| CON-03 | Blueprint wants a 500,000-word 22-volume document set                                                                            | write volumes progressively, or treat the 100-epic requirement set as the specification | 100-epic set remains the acceptance specification |
| CON-04 | Blueprint uses `NAV-###`/control IDs; the repo uses route ids and has no control-ID convention                                   | introduce `data-control-id` for new controls only                                       | do not retrofit IDs onto existing UI              |
| CON-05 | Blueprint endpoint families (`/v1/curb/projects/{projectId}/measurements`) vs current module layout                              | adopt the blueprint paths inside existing modules                                       | compatible; paths are additive                    |
| CON-06 | Blueprint wants payments/signatures/imagery live                                                                                 | vendors unchosen (D-07, D-03)                                                           | adapters + flags; no live capture                 |
| CON-07 | Blueprint expects a marketing site in the repo                                                                                   | separate deployment                                                                     | do not create one                                 |
| CON-08 | Blueprint's 22-volume structure does not map 1:1 to the 100 epics                                                                | map volumes to epics when writing each volume                                           | epics remain canonical                            |

## 3. Decisions that must become ADRs before implementation

| Proposed ADR | Subject                                                                               | Why it needs a record                                                    |
| ------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 0009         | Role model extension (crew member, field supervisor, subcontractor, manager)          | changes a Postgres enum, RBAC policy, docs and tests; affects every gate |
| 0010         | Dashboard and search aggregation strategy (derived-from-events vs materialised views) | affects performance targets and auditability                             |
| 0011         | Payment provider and webhook verification model                                       | financial integrity and idempotency                                      |
| 0012         | E-signature provider and document-hash binding                                        | legal evidence and contracts                                             |
| 0013         | Imagery provider and the rights enforcement points                                    | licensing risk; must cover ingestion, inference, cache and export        |
| 0014         | Offline conflict-resolution policy for measurements                                   | data integrity when two crew members edit the same record                |
| 0015         | Control-ID convention for new UI                                                      | traceability chain in the blueprint                                      |

## 4. Invariants that no later phase may break

1. Money is integer minor units with decimal arithmetic; never floating point.
2. Canonical units are SI; imperial is display only.
3. Unknown is a value, not a null guess, and carries provenance.
4. Photographs cannot prove buried utilities, reinforcement, thickness, authorization or approval.
5. An AI result never overwrites an approved measurement; suggestions are stored separately.
6. Accepted proposals, approved price books and issued reports are immutable revisions.
7. Every tenant-owned row has `org_id`, and RLS applies to new tables.
8. Every write produces an audit event with a correlation id.
9. A feature that is not verified shows as unavailable behind its flag, never as sample data.
10. Roof and Curb remain first-class, adjacent peers sharing business infrastructure but keeping
    separate geometry, evidence and verification rules.
