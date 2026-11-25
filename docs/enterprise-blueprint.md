# Enterprise Blueprint

The Enterprise section now carries the FieldPro Enterprise blueprint as an operating workspace, not a
PDF. Route: `/enterprise/blueprint`. The page is inside the signed-in app frame and keeps every
existing roofing, curb, billing and plumbing route unchanged.

## What ships

| Surface                | Behaviour                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work-package catalog   | All 157 indexed packages with code, domain, suggested release gate, owner and record count. Search, domain and gate filters.                          |
| Package workspace      | The package's documented fields, actions, lifecycle stages, exception path and proposed tables.                                                       |
| Records                | Create a tenant-scoped record, fill the package fields, add notes, and move it through the package lifecycle. Revisions and every change are audited. |
| Control-level addendum | The 13 addendum feature areas with their routes, dashboard metrics, entities and 18 control gates. Each area links back to its owning work packages.  |

## Specification coverage

- 100 core work packages (`001`–`100`): five-page specification in the supplied blueprint.
- 22 expanded packages (`101`–`122`): expanded appendix detail (fields, actions, lifecycle, records).
- 35 expanded packages (`123`–`157`): indexed in the expanded work-package index. Their detail pages
  fall beyond the supplied text and they are shown as **not operable yet**; the API refuses to create
  records for them rather than inventing a contract.

`packages/contracts/src/enterpriseBlueprint.ts` is the single catalog. Add a package there and the
catalog, filters, workspace and validation pick it up. `enterpriseControlAddendum.ts` holds the
control-level registry.

## Data and API

- Table: `enterprise_suite.work_package_records` (migration `0039_enterprise_blueprint.sql`).
  Tenant-owned, RLS enabled, revision column, optional commercial project link, optional
  `client_request_id` for idempotent retries.
- `GET /v1/enterprise/blueprint` returns record counts by package and status.
- `GET /v1/enterprise/blueprint/:code/records` lists one package's records.
- `POST /v1/enterprise/blueprint/:code/records` creates a record. The server rejects unknown field
  keys, indexed-only packages and projects from another tenant; when `clientRequestId` repeats, the
  original record is returned.
- `PATCH /v1/enterprise/blueprint/records/:id` changes status, fields or notes. Status must belong to
  the package lifecycle, stale `If-Match` revisions conflict, and each change is audited.
- Permission: `job:read` for reads, `job:write` for writes. The Enterprise Suite must be enabled for
  the company (`/v1/enterprise/status`).

## Verification

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run build -w @fieldline/web
```

The unit suite covers all 157 catalog entries, field-key uniqueness, lifecycle ordering and the
addendum-to-package links. Integration and browser checks require `TEST_DATABASE_URL` and a running
API, which are not available in the cloud workspace used for this change.

## Known gaps

- External providers (accounting, payments, email, identity/KYB, geocoding, app stores) are
  specified in the blueprints but not connected here.
- The 13 addendum areas are control contracts with their routes, metrics, entities and gates. Their
  provider integrations and 234 feature-control pages are not individually built as separate screens.
- Packages `123`–`157` become operable only when their detail pages are added to the catalog.
