# Builder operations section

A new section of Field Pro covering the production-builder workflow end to end:
warranty & homeowner service, job cost + draw billing, accounts payable with lien
release tracking, home sales + design center, land management (communities → phases →
lots → houses), supplier order flow between Field Pro companies, builder → contractor
assignments, a proactive attention feed, field time tracking + inspection checklists
(bilingual EN/ES), and gated QuickBooks Online + payments-rail scaffolding.

Everything here is Field Pro's own code, UI, and wording, built fresh — functional
equivalents of common builder-software capabilities, with no third-party code, assets,
branding, or copy. Navigation is organized the way a builder expects (sales, design,
land, warranty, purchasing, payables, reports) inside the one Field Pro app (web / PWA /
iOS shell; layouts are responsive and touch-friendly for desktop and iPad use).

## What was built

1. **Warranty & homeowner service** (`/warranty`) — warranty tickets against jobs,
   service work orders, and a staff/homeowner message thread. Homeowners file and reply
   through the existing job-status link (portal token, no account): the track page gains
   a "Warranty & service" section. API: `apps/api/src/modules/warranty`, portal routes
   under platform operation `portal.warranty`. Nothing decides coverage automatically —
   staff record the decision on the ticket.
2. **Job cost + draws** (`/job-cost`) — budget-to-actual per cost code per job, cost
   entries (manual / purchase order / AP invoice), and draw (progress billing) requests
   with submitted → approved → paid flow. Builder-entered numbers only; actuals sum
   recorded entries; a code with no budget line shows no invented budget.
3. **Accounts payable** (`/payables`) — capture → submit for approval → approve/reject/
   dispute → record payment. Recording payment against a job + cost code books the
   actual into job cost. Moving money stays gated (item 12); the screen records payments
   made outside Field Pro.
4. **Lien release tracking** (in `/payables`) — waiver document tracking tied to
   payments, using the four Texas statutory waiver kinds. This is document tracking,
   not legal advice; the UI says so.
5. **Home sales** (`/home-sales`) — prospect pipeline with buyer **and** agent dual
   tracking, appointment booking, and sales contracts. Email campaigns stay gated on
   the mailer — nothing here sends email.
6. **Design center** (`/design-center`) — builder-entered options catalog (structural,
   elevation, finish, fixture, flooring, other) and per-contract selection sheets.
   Selections snapshot the catalog price at pick time; null price = "price on request".
   A contract can link a House Studio house for the 3D view in House Builder. No
   manufacturer catalogs.
7. **Supplier order flow** (`/network-orders`) — purchase orders between connected
   Field Pro companies (send / accept / decline / production / ship / deliver / cancel
   with full status history), SKU mapping (package name → supplier SKU), dispatch
   routes, and supplier field reports. The UI states plainly that orders only move
   between companies on Field Pro.
8. **Land management** (`/land-management`) — communities → phases → lots → houses,
   each readable in detail. The house detail assembles the real linked records: lot,
   phase, community, House Studio plan spec, sales contract + selection sheet, job cost
   budget/actual/variance, schedule tasks, drawings, and warranty history. Land
   development contracts are paid in progress draws with approvals; SWPPP/stormwater
   inspections record observations (not a compliance guarantee).
9. **Attention feed** (`/attention`) — rules-based surfacing from the company's own
   records: slipping schedules, POs past requested delivery, overdue AP, warranty
   tickets waiting, draws awaiting a decision, contracts at risk, SWPPP due, orders
   awaiting a response. Each item links to its source record and carries an
   Observed / Estimated / Modeled provenance label. The optional AI summary rides the
   existing Ask Field Pro hook and reports an honest not-connected state.
10. **Field extras** (`/time-tracking`, `/field-inspections`) — crew hours against jobs
    and cost codes with a labor-cost rollup (computed only from entered rates), generic
    inspection checklists (templates + pass/fail/N-A answers), and English/Spanish
    labels for both field views (stored values never change).
11. **QuickBooks Online sync** (`/integrations`) — gated. Needs the owner's Intuit
    OAuth app (`QUICKBOOKS_CLIENT_ID` / `QUICKBOOKS_CLIENT_SECRET` on the API service)
    plus a completed company sign-in flow; until then the status endpoint says exactly
    that and sync attempts record `not_connected`. CSV/TSV import already exists.
    Job cost + AP live in-app; QuickBooks stays the general ledger.
12. **Payments rail** (`/integrations`) — gated scaffolding. `PAYMENTS_PROVIDER`
    (`stripe_connect` or `dwolla`) + provider credentials, optional lien-waiver gating
    (`PAYMENTS_LIEN_WAIVER_GATING`) and early-pay (`PAYMENTS_EARLY_PAY_ENABLED`).
    Payouts refuse with an honest state until a regulated provider is connected and
    compliance decisions are made; the endpoint never pretends money moved.

**Assignments** (`/assignments`) — a builder assigns jobs, purchase orders, tasks, or
bid invitations to a contracting company in the Network. The contractor sees it in
Field Pro immediately (in-app notification, works regardless of email state) and
accepts/declines/starts/completes it there. The email notice goes through the existing
mailer path (`assignment.email` / `order.email` outbox tasks): when the mailer (or
SMTP) is connected it sends for real; until then every assignment and order shows an
honest "Email not connected yet" state and nothing claims to have been sent. Resend is
available once email connects.

## Data & migration

Migration `0084_builder_operations.sql` (journal idx 86) adds 26 tenant-scoped tables
(warranty tickets/work orders/messages, job-cost budgets/entries/draws/AP invoices/lien
releases, sales prospects/appointments/options/contracts/selections, network orders/SKU
mappings/dispatch routes/field reports, land communities/phases/lots/houses/contracts/
progress pays/SWPPP inspections, time entries, inspection checklist templates/results,
work assignments, integration sync log) plus two enum values (`work_assigned`
notification category, `assignment` subject type). Cross-company writes go through
platform operations `network.order`, `network.assignment`, and `portal.warranty`, each
scoped to the mirrored row's own org. One Render API deploy runs the migration.

## Honest limits

- Payments need a regulated provider (Stripe Connect / Dwolla) + owner compliance
  decisions; lien waivers are legal documents (tracking only, not legal advice).
- A full GL duplicates QuickBooks — job cost + AP in-app plus the gated QBO sync is
  the path; QBO/Sage/Xero all need OAuth apps, none connected yet.
- The two-sided network only pays off when both companies are on Field Pro.
- Selections start from builder-entered options, not manufacturer catalogs.
- Email campaigns and assignment/order emails need the mailer connected.
- No prices or numbers are ever invented: blank = blank, estimates are labeled.

## Not verified live

Code + unit tests only (no browser in the build environment): visual layout at desktop
and iPad widths, the homeowner warranty flow on the track page, and every new endpoint
against a deployed API + real database still need the Render deploy and a signed-in
pass. Migration 0081 has not run against a real database yet.

A desktop wrapper (Electron/Tauri) around the web app is a possible later add; the
web/PWA/iOS shell is the deliverable and nothing here requires a wrapper.
