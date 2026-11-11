# Master engineering directive

Governing document for the ConstructOS AI specification and its implementation in this repository.
Volumes 1–10 inherit these rules; they may add detail but may not contradict them.

## Mission

Build one connected construction operating system covering residential and commercial work:
roofing, concrete and curb, plumbing, electrical, HVAC, excavation, framing, engineering,
architecture, general contracting, subcontracting, property management, and supplier workflows.
It must serve individual contractors, small businesses, large companies, developers, property
owners, suppliers, and enterprise organisations.

The application combines AI-assisted construction work, 2D design, 3D/BIM modelling, quantity and
cost calculation, estimating, project and field operations, CRM, procurement, accounting,
scheduling, documents, safety and compliance, and business analytics as **one system with shared
records**, never as unrelated bolt-on tools.

## Scope discipline

The current repository implements the foundation for two first-class products — Roof Measurements
and Curb Cutting — plus the platform (tenancy, teams, settings, notifications, media). Volumes 6–9
describe capabilities that are not implemented. They are specifications, not claims.

Branding is not changed by this directive: the shipped product name remains the single constant in
`packages/contracts/src/brand.ts` (STR-009). "ConstructOS AI" names the specification programme.

## Global implementation rules

1. Every screen has a documented route owned by the route registry (PLT-011).
2. Every interactive control has a permanent control ID (`<AREA>-UI-NNN`) in Volume 2.
3. Every control has a defined click or submit action and a defined disabled/denied state.
4. Every input has a data type, unit, required/optional rule, and validation message.
5. Every dropdown lists its options and where they come from; no invented option sets.
6. Every modal and sheet defines open, close, submit, cancel, success, and error behaviour.
7. Every table defines its columns, default sort, filters, pagination, and row actions.
8. Every frontend action calls a documented endpoint, or is explicitly documented as local-only.
9. Every endpoint has a backend handler in an `apps/api` module registered in `modules/registry.ts`.
10. Every handler documents authorization (RBAC action), tenant scope, and request validation.
11. Every database mutation states its transaction boundary and revision/If-Match behaviour.
12. Every important operation writes an audit event inside the same transaction.
13. Every calculation states inputs, units, formula, rounding, assumptions, and tests.
14. Every AI action names its permitted tools and its human approval requirement.
15. Every asynchronous operation exposes loading, progress, success, failure, retry, and cancel.
16. Every screen defines desktop, tablet, and phone behaviour where the route is reachable there.
17. Every critical feature has automated tests: unit, API integration, and browser journey where applicable.
18. Every feature has documentation linked from its control ID.
19. No control may look operational while being decorative, simulated, or hardcoded.
20. No feature may be declared complete without implementation, verification, and evidence.

## Source-of-truth map

| Concern              | Authority                                                                          |
| -------------------- | ---------------------------------------------------------------------------------- |
| Routes and labels    | `packages/contracts/src/routes.ts`                                                 |
| Permissions          | `packages/contracts/src/rbac.ts` (mirrored in `docs/product/permission-matrix.md`) |
| Feature flags        | `packages/contracts/src/flags.ts`                                                  |
| API request/response | Zod schemas in `packages/contracts/src/`                                           |
| API paths (client)   | `apps/web/src/lib/endpoints.ts`                                                    |
| API handlers         | `apps/api/src/modules/*/index.ts` registered by `modules/registry.ts`              |
| Database schema      | `apps/api/src/db/schema/*` and `apps/api/drizzle/`                                 |
| Requirement epics    | `docs/requirements/blueprint.yaml`                                                 |
| Evidence             | `docs/requirements/evidence.yaml` → generated `docs/traceability.md`               |

If Volume 2 and the registry disagree, the registry is correct and Volume 2 is fixed in the same
change that alters the registry.

## Feature traceability chain

Every feature must connect all of these, or it is incomplete:

`FEATURE ID → USER STORY → SCREEN (route ID) → CONTROL ID → FRONTEND COMPONENT → FRONTEND EVENT →
API ENDPOINT → BACKEND HANDLER → DATABASE TABLE → BUSINESS RULE → PERMISSION → AUDIT EVENT →
AUTOMATED TEST → DOCUMENTATION`

Volume 2 supplies the screen, control, permission, event, and endpoint links. Volumes 4 and 5
supply handler, table, and audit links. Volume 10 supplies test and deployment evidence.

## Execution order

Do not build every module at once.

1. Platform: tenancy, sessions, RBAC, feature flags, audit, jobs/outbox, media, design system.
2. Shared records: customers, contacts, properties, addresses and imagery rights.
3. Roof Measurements end to end: order → imagery → sketch → report → export.
4. Curb Cutting end to end: project → capture → calibration → geometry → estimate gates.
5. Commercial chain: estimate → approval → proposal → signature → job → invoice → payment.
6. Field operations, procurement, scheduling, and analytics.
7. AI assistance, only behind explicit tools, approvals, and abstention.

Each milestone reports: completed feature IDs, changed files, new endpoints, migrations, controls
implemented, passing and failing tests, security findings, unresolved dependencies, and the next
milestone.

## Honesty and evidence rules

- Never replace real functionality with placeholder buttons, simulated records, hardcoded supplier
  quotes, or invented calculations. Unbuilt areas show an honest unavailable state (STR-005).
- Never inflate the repository with duplicated or artificial files to appear complete.
- A feature flag that is off shows the feature as unavailable with a reason; it never shows fake
  data (PLT-020).
- A machine estimate is labelled as an estimate, with provenance and review state; it is never
  presented as an engineering determination or a contractor guarantee (STR-001).
- AI output never invents supplier prices, code approvals, engineering sign-off, or measurements.
  When a validated model is absent, the recogniser abstains and requires human review (AIQ-081).

## Definition of done

A released feature has working controls, implemented handlers, persistent data, enforced
authorization and tenant isolation, verified calculations, unit and integration tests, a browser
journey where a user completes the flow, documented behaviour, production monitoring, and a
verified deployment. Anything less is reported as `partial` or `planned`.
