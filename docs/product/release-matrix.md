# Release matrix (MVP / V1 / V2)

Requirement: STR-005 (page 005). Generated from `docs/requirements/blueprint.yaml` on 2026-10-26; the YAML is
authoritative, regenerate this list if releases change.

Page 005 sequence:

- **MVP**: address/manual roof reports and assisted curb quotes, plus the shared platform (customer, property,
  quote and payment infrastructure; Roof and Curb as independent entry points).
- **V1**: automation and commerce.
- **V2**: advanced computer vision and supplier integrations.

Explicitly deferred to qualified people in every release (page 005 UX-B): unsupported jurisdictions,
automatic code-compliance certification, site-safety approval.

## Exit gates (page 005)

A release ships only when, for every enabled feature:

1. User documentation exists.
2. Test evidence exists (linked in docs/traceability.md via evidence.yaml).
3. An incident owner is named.
4. Unvalidated vision engines and vendor dependencies are behind feature toggles scoped by tenant and
   jurisdiction (page 005 rule); unfinished algorithms lead to manual review or clear unavailability, never a
   fabricated measurement or price (page 005 S).
5. Release records include migration plan and rollback conditions (page 005 data).

Assignment notes: release values are planning assignments made from the page 005 definitions (the blueprint
does not tag each page). Notable choices: RF-026 automatic facet detection and CV-046 curb profile
recognition are V2 (advanced CV); RR-038 exports, RR-039 SLA/credits, OPS-* commerce and BE-079 billing are
V1 except OPS-061 records (MVP, shared customer/property infrastructure) and OPS-066 supplier orders (V2).
Owner should confirm (owner-decisions.md D-04).

## MVP (77 epics)

| ID      | Title                                                   | Slice       | Priority |
| ------- | ------------------------------------------------------- | ----------- | -------- |
| STR-001 | Executive blueprint and reading guide                   | process-doc | P0       |
| STR-002 | Competitive functional parity map                       | process-doc | P0       |
| STR-003 | Vision and success metrics                              | process-doc | P0       |
| STR-004 | User types and jobs to be done                          | process-doc | P0       |
| STR-005 | Release boundaries and non-goals                        | process-doc | P0       |
| STR-006 | Roof customer journey from lead to payment              | process-doc | P0       |
| STR-007 | Curb-cutting customer journey from photos to job        | process-doc | P0       |
| STR-008 | Revenue model and unit economics                        | process-doc | P0       |
| STR-009 | Intellectual property and imagery licensing             | process-doc | P0       |
| STR-010 | Glossary, assumptions, and engineering decisions        | process-doc | P0       |
| PLT-011 | Navigation and information architecture                 | sprint0     | P0       |
| PLT-012 | Original design system and reusable components          | sprint0     | P0       |
| PLT-013 | Authentication with Microsoft and future providers      | sprint0     | P0       |
| PLT-014 | Organization setup and first-run wizard                 | sprint0     | P0       |
| PLT-015 | RBAC interfaces and team management                     | sprint0     | P0       |
| PLT-016 | Home dashboard, queues, and universal search            | sprint0     | P0       |
| PLT-017 | Address selection and property confirmation             | sprint0     | P0       |
| PLT-018 | Camera, uploads, and media experience                   | sprint0     | P0       |
| PLT-019 | Accessibility, language, and units                      | sprint0     | P0       |
| PLT-020 | Notifications, preferences, and support                 | sprint0     | P0       |
| RF-021  | Create roof measurement order                           | A-roof      | P0       |
| RF-022  | Imagery procurement and rights                          | A-roof      | P0       |
| RF-023  | Interactive roof mapping canvas                         | A-roof      | P0       |
| RF-024  | Structures, parcels, and multi-building scope           | A-roof      | P0       |
| RF-025  | Roof geometry and topology model                        | A-roof      | P0       |
| RF-027  | Pitch estimation and calibration                        | A-roof      | P0       |
| RF-028  | Roof edge categories and linear takeoff                 | A-roof      | P0       |
| RF-029  | Roof units, areas, and rounding rules                   | A-roof      | P0       |
| RF-030  | Review, overrides, and uncertainty                      | A-roof      | P0       |
| RR-031  | Imagery ingestion and image normalization               | A-roof      | P0       |
| RR-032  | DIY tracing with snapping and blueprints                | A-roof      | P0       |
| RR-033  | Assisted measurement review queue                       | A-roof      | P0       |
| RR-034  | Roof materials and quantity takeoff                     | A-roof      | P0       |
| RR-035  | Waste factor rules and recommendations                  | A-roof      | P0       |
| RR-036  | Measurement report document design                      | A-roof      | P0       |
| RR-037  | Report editing, versioning, and reissues                | A-roof      | P0       |
| RR-040  | Convert roof measurements into quotes                   | A-roof      | P0       |
| CV-041  | Curb-cutting service taxonomy                           | B-curb      | P0       |
| CV-042  | Curb project wizard and eligibility                     | B-curb      | P0       |
| CV-043  | Guided curb photo capture protocol                      | B-curb      | P0       |
| CV-044  | Photo quality, privacy, and security                    | B-curb      | P0       |
| CV-045  | Scale calibration and perspective geometry              | B-curb      | P0       |
| CV-047  | Curb trace, segments, and obstructions                  | B-curb      | P0       |
| CV-048  | Driveway access, slopes, and accessible transitions     | B-curb      | P0       |
| CV-049  | Utilities, drainage, and pavement dependencies          | B-curb      | P0       |
| CV-050  | AI confidence, overrides, and human verification        | B-curb      | P0       |
| CP-051  | Curb quantity and measurement engine                    | B-curb      | P0       |
| CP-052  | Configurable curb cost model                            | B-curb      | P0       |
| CP-053  | Saw cutting production and equipment costs              | B-curb      | P0       |
| CP-054  | Demolition, hauling, disposal, and restoration          | B-curb      | P0       |
| CP-055  | Traffic control, access, and crew safety                | B-curb      | P0       |
| CP-056  | Right-of-way permits and inspection rules               | B-curb      | P0       |
| CP-057  | Regional labor and material price books                 | B-curb      | P0       |
| CP-058  | Uncertainty bands, contingency, and profitability       | B-curb      | P0       |
| CP-059  | Quote authorization and change control                  | B-curb      | P0       |
| CP-060  | Worked example: measured curb-cut estimate              | B-curb      | P0       |
| OPS-061 | Lead, contact, property, and job records                | C-workflow  | P1       |
| BE-071  | Reference system architecture                           | sprint0     | P0       |
| BE-072  | Repository, modules, and coding standards               | sprint0     | P0       |
| BE-073  | API design, contracts, and error semantics              | sprint0     | P0       |
| BE-074  | Transactional data model and migrations                 | sprint0     | P0       |
| BE-075  | Spatial, document, and media storage                    | sprint0     | P0       |
| BE-076  | Async workflows, queues, and idempotency                | sprint0     | P0       |
| BE-077  | Geocoding, parcels, and jurisdiction resolution         | sprint0     | P0       |
| BE-078  | Server-side authentication and authorization            | sprint0     | P0       |
| BE-080  | External services, webhooks, and adapters               | sprint0     | P0       |
| AIQ-088 | Telemetry, audit, and operational dashboards            | hardening   | P1       |
| LCH-091 | Application security and threat modeling                | hardening   | P0       |
| LCH-092 | Privacy, consent, and retention policy                  | hardening   | P0       |
| LCH-093 | Availability, disaster recovery, and backups            | hardening   | P0       |
| LCH-094 | Unit, integration, and contract test pyramid            | hardening   | P0       |
| LCH-095 | End-to-end user journeys and adverse cases              | hardening   | P0       |
| LCH-096 | Scale, latency, and capacity planning                   | hardening   | P0       |
| LCH-097 | Deployment, CI/CD, and environment controls             | hardening   | P0       |
| LCH-098 | Incident response, customer support, and correction SOP | hardening   | P0       |
| LCH-099 | Team structure, milestones, and delivery economics      | process-doc | P0       |
| LCH-100 | Developer handoff and final acceptance contract         | process-doc | P0       |

## V1 (18 epics)

| ID      | Title                                            | Slice        | Priority |
| ------- | ------------------------------------------------ | ------------ | -------- |
| RR-038  | CSV, structured exports, and insurance handoff   | C-workflow   | P0       |
| RR-039  | Report delivery SLA and credit recovery          | C-workflow   | P0       |
| OPS-062 | Job pipeline and field operations board          | C-workflow   | P1       |
| OPS-063 | Multi-option customer proposals                  | C-workflow   | P1       |
| OPS-064 | Signatures, contracts, and audit receipts        | C-workflow   | P1       |
| OPS-065 | Pricing rules, markup, and margin governance     | C-workflow   | P1       |
| OPS-067 | Scheduling, crews, and dispatch                  | C-workflow   | P1       |
| OPS-068 | Invoices, deposits, and payments                 | C-workflow   | P1       |
| OPS-069 | Change orders and scope revisions                | C-workflow   | P1       |
| OPS-070 | Homeowner portal and communications              | C-workflow   | P1       |
| BE-079  | Billing subscriptions, entitlements, and credits | C-workflow   | P0       |
| AIQ-081 | AI build-versus-buy and phase gates              | process-doc  | P1       |
| AIQ-082 | Data collection and annotation operations        | D-automation | P1       |
| AIQ-083 | Training splits and evaluation methodology       | D-automation | P1       |
| AIQ-084 | Roof algorithm validation and regression         | D-automation | P1       |
| AIQ-086 | Human review triage and staffing                 | D-automation | P1       |
| AIQ-087 | Confidence scores, explanation, and abstention   | D-automation | P1       |
| AIQ-089 | Inference latency, spend, and caching controls   | D-automation | P1       |

## V2 (5 epics)

| ID      | Title                                            | Slice        | Priority |
| ------- | ------------------------------------------------ | ------------ | -------- |
| RF-026  | Automatic roof facet detection                   | D-automation | P0       |
| CV-046  | Concrete curb profile recognition                | D-automation | P0       |
| OPS-066 | Roof materials and supplier orders               | C-workflow   | P1       |
| AIQ-085 | Curb model validation and adversarial conditions | D-automation | P1       |
| AIQ-090 | Continuous improvement and model governance      | D-automation | P1       |
