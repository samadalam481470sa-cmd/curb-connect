# ConstructOS AI blueprint (specification library)

This directory holds the master engineering specification for the construction operating system.
It is the product-level specification; the repository remains the implementation of record, and
where the two disagree the code and its contracts win until the specification is corrected.

**Product name:** the shipped product name is defined once in
[`packages/contracts/src/brand.ts`](../../packages/contracts/src/brand.ts) (STR-009). This library
refers to "ConstructOS AI" as the programme name for the full ten-volume system. A rename of the
shipped application is a product decision, not a documentation edit.

## Volumes

| Volume | Title                                    | Status                                                       |
| ------ | ---------------------------------------- | ------------------------------------------------------------ |
| —      | Master engineering directive             | Delivered — [read](master-engineering-directive.md)          |
| 1      | Architecture and product requirements    | Mapped to existing docs (see below)                          |
| 2      | UI, screens, buttons and interactions    | Delivered (first edition) — [read](volume-02-ui-controls.md) |
| 3      | Frontend and component engineering       | Not started                                                  |
| 4      | Backend, APIs and workflows              | Not started                                                  |
| 5      | Database, schemas and storage            | Not started                                                  |
| 6      | BIM, CAD and 3D house builder            | Not started — outside the current product scope              |
| 7      | Construction calculations and estimating | Not started                                                  |     | 8   | AI agents and automation | Foundation core — [roof intelligence engine](roof-intelligence-engine.md) |
| 9      | Field operations and business management | Not started                                                  |
| 10     | Security, testing and deployment         | Not started                                                  |

Volumes 1 and 3–10 must be written against the same permanent IDs used here. Volume 2 is written
first because every later volume references its screens and controls.

## Existing documentation this library must not contradict

| Topic                         | Document                                                             |
| ----------------------------- | -------------------------------------------------------------------- |
| System design and decisions   | [docs/architecture.md](../architecture.md), [docs/adr/](../adr/)     |
| Requirement epics and status  | [docs/requirements/blueprint.yaml](../requirements/blueprint.yaml)   |
| Generated traceability matrix | [docs/traceability.md](../traceability.md)                           |
| Roles and permissions         | [docs/product/permission-matrix.md](../product/permission-matrix.md) |
| Personas, journeys, KPIs      | [docs/product/](../product/)                                         |

## Identifier rules

- **Requirement IDs** follow `<AREA>-<page>` with an optional layer suffix, e.g. `CP-052-API`
  (see [`packages/contracts/src/requirements.ts`](../../packages/contracts/src/requirements.ts)).
  The 100 blueprint pages are the epics in `docs/requirements/blueprint.yaml`.
- **Route IDs** are owned by [`packages/contracts/src/routes.ts`](../../packages/contracts/src/routes.ts).
  Documentation never invents a path; it cites the registry ID.
- **Control IDs** have the form `<AREA>-UI-<NNN>`, are permanent, and are never reused or
  renumbered. Volume 2 is the registry.
- **Screen IDs** are the route ID for registry routes, and `PUBLIC-<name>` for public screens.

## Status vocabulary

The specification uses the same statuses as the traceability generator, plus two UI-specific
values:

| Status           | Meaning                                                                      |
| ---------------- | ---------------------------------------------------------------------------- |
| `implemented`    | Control exists, calls the stated contract, and is covered by a test.         |
| `partial`        | UI exists but its data contract is missing or returns an honest empty state. |
| `planned`        | Specified here; no page, handler, or migration exists yet.                   |
| `blocked_vendor` | Depends on an unconfigured vendor (imagery, payments, signatures, mail).     |
| `blocked_owner`  | Needs an owner decision recorded in `docs/product/owner-decisions.md`.       |

Nothing in this library may describe a planned control as working. A placeholder page must say so
(STR-005); a control that cannot act must be visibly unavailable with a reason (PLT-015 A).
