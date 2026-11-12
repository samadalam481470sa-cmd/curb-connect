# Account-linked autosaving: House Builder, Roofing and Curb Cutting

## What changes
An authenticated user's unfinished **House Builder**, **Curb Cutting** and **Roofing**
workspace drafts are stored as JSON in Postgres, keyed by their server-side user UUID,
active company UUID and draft type. Logging into the same identity and company on a
different device loads the same cloud draft. Drafts belong to the *user*, not every
member of the company, even when that member has company-level access.

The endpoint is `GET /v1/me/drafts/:key` and
`PUT /v1/me/drafts/:key` with
`{ "value": {...}, "expectedRevision": 0 }` when creating. Saves increment
revisions, and conflicts return 409 instead of silently overwriting work
edited in another browser.

Data is stored in the connected Postgres database, not in a transient Render
server container. Production storage durability still requires database
backups/retention policies; the **free database expires on December 12, 2026**.
A paid durable database and backups must be enabled for real long-term retention.

## Existing saved records
Company Roof Measurement records, RFIs, change orders, invoices and other
server-backed business records retain their existing tenant-level access model.
The private autosave store does not change permissions on those records.
Drafts do not turn conceptual AI plans into construction-ready drawings.

## Device-only legacy drafts
Old draft data in unscoped `localStorage` is **not auto-imported** to any
account, since another user could previously have used that browser.
An authenticated user can deliberately import it using the explicit
"Import this device's old draft" control. The import is then sent to their
authenticated private cloud draft. Imports must not erase an existing cloud
draft without explicitly asking the user.

## Uploaded photos and documents
This feature persists JSON drafts but **does not** make binary uploads durable.
On free Render, `STORAGE_DRIVER=local` loses uploaded bytes on each restart.
Configure `STORAGE_DRIVER=s3` with S3-compatible credentials and a permanent
bucket to keep uploaded files. Existing media/attachments already have
organization access authorization; a personal-private file collection would
need its own resource access policy.

## Testing
Run `npm run lint`, `npm run typecheck`, `npm run test:unit`,
`npm run test:integration` with PostGIS and `npm run build`.
Run the browser journeys and verify same account on a second device,
different user in the same workspace, switching companies, and conflicting
two-tab edits.
