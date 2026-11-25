# SupplyPro GM core + unified crew board

Hyphen's SupplyPro GM idea, adapted to Field Pro: one schedule for both kinds of work —
work that arrives through a builder flow and work the contractor creates by hand. Field
Pro's users are contractors, so "builder-issued" here means work that originated in
Field Pro's own flow, and "manual" means work created by hand (remodel, service,
retail, commercial) that never went through an estimate or a permit lead.

## What was built

1. **Manual customers and contacts** — `POST /v1/customers` (+ list/get/update) and
   `POST /v1/customers/:id/contacts` (+ get/update). The tables already existed; the
   crm module was a stub with no routes, so a customer could only appear via invoice
   auto-creation. One primary contact per customer (setting a new primary clears the
   old one). UI: `/customers`.
2. **Job origin + types** — `jobs.origin` (`manual` | `estimate` | `permit_lead`,
   migration 0046; existing rows backfill `manual` because every job before the column
   was created by hand). Product lines widened from `roof`/`curb` to `roof`, `curb`,
   `remodel`, `service`, `retail`, `commercial`. `POST /v1/jobs` accepts `origin`,
   `customerId`, `contactId` (both must belong to the company; a contact must belong
   to the selected customer). The Jobs create form offers the new types, the origin,
   and a customer/contact picker.
3. **Manual orders** — `POST /v1/supplier-orders/manual` and
   `GET /v1/supplier-orders/manual`, no `ops.supplier_orders` flag needed. Same draft
   as the flag-gated path, marked `origin: 'manual'`; the old flag-gated routes are
   unchanged. UI: `/manual-orders`. Submission stays blocked in both paths — no
   supplier integration exists, so orders stay as drafts (submit answers with the
   honest "no supplier integration" message; a manual order's submit no longer
   demands the flag first).
4. **Unified crew board** — `GET /v1/pm/crew-board` aggregates crews, schedules,
   dispatches, and jobs through `buildCrewBoard()` (reuses `findCrewConflicts` from
   the per-job scheduling logic). Per-crew bookings with job, origin, and customer;
   overlapping bookings flagged once per pair; unassigned bookings and jobs with no
   booking surfaced instead of hidden. UI: `/crew-board` (nav). Booking itself still
   happens per job in Project Management.

## Honest limits

- No supplier integration exists; supplier orders are drafts only in both paths.
- No estimate/proposal → job flow exists yet (estimates/proposals are still stubs),
  so `origin: 'estimate'` today only records what the contractor says by hand; the
  automatic "issued" half is a later build.
- No QuickBooks Online integration; only CSV/TSV import of its exports.
- The board shows crew bookings, not trucks or deliveries — Field Pro has crews and a
  fleet registry, no delivery-run model.
