# ConstructionOS network MVP

This repository is the Field Pro platform (roof measurement, curb cutting, contractor operations).
This document records how the **ConstructionOS 500-page blueprint** was applied to it: what is
implemented, how it is authorized, what the launch proof is, and what is deliberately not built.

The blueprint's north star is a permissioned contractor network where two independent companies can
issue, receive, approve or dispute, pay and reconcile an invoice without either company reading the
other's records. That cross-company exchange is the vertical slice added here.

## Critical launch proof

> A roofing company creates a measured project, sends a quote, issues a $1,250 invoice to an
> independent GC, which views and approves it; payment and ledger status reconcile without
> cross-company data leakage.

How to reproduce it against a local database (see the README for setup):

1. **Two companies.** Sign in as user A, create "Northside Roofing". In a private window sign in as
   user B, create "Ridgeline GC". Two organisations, two independent books.
2. **Opt in.** Billing → *Network* → *List my company in the directory* in both companies
   (`PATCH /v1/network/listing`). Nothing is listed until a company opts in.
3. **Connect.** A searches the directory, requests a connection
   (`POST /v1/network/connections`, scopes `invoices` + `projects`); B accepts
   (`POST /v1/network/connections/:id/accept`). Two mirrored rows exist, one per company, under one
   pair key.
4. **Share the project.** A shares the roof replacement
   (`POST /v1/network/projects`); B sees the mirrored project under Network → Shared projects.
5. **Issue the invoice.** A opens Billing, chooses Ridgeline GC as the payer, enters the line
   (`Roof replacement — final invoice`, quantity 1, price 1250.00), and creates a draft
   (`POST /v1/invoices`). The invoice number is per company (`INV-2026-0001`).
6. **Send it.** A presses *Send invoice* (`POST /v1/invoices/:id/send`). One platform transaction
   writes the bill into B's tenant, marks A's invoice `issued`, and notifies B's owners, admins and
   finance members.
7. **Approve it.** B opens Billing → *Bills you received*, reviews the frozen lines and approves
   (`POST /v1/bills/:id/approve`). A's invoice delivery state becomes `approved` in the same
   transaction that approved B's bill.
8. **Pay it.** B records settlement (`POST /v1/bills/:id/settle`, method `bank_transfer` or
   `card_stand_in`). A's invoice becomes `paid` with `amountPaidMinor = totalMinor`, and two
   append-only ledger entries post on A's books: debit **cash**, credit **accounts receivable**,
   same `transactionId`.
9. **Reconcile.** A's Billing → Ledger shows debits equal credits and *balanced*. B's bill shows
   `paid`. Neither company can query the other's rows: every read is filtered by RLS on `org_id`.

Failure paths that are also proven by the code and tests: re-sending the same invoice returns the
existing bill instead of duplicating the payable (unique `(org_id, invoice_id)`); settling twice
returns the paid bill; approving an approved bill is an invalid transition; a bill id from another
tenant is answered as `not_found`, never `forbidden`.

## Authorization model

- **Two-sided connections.** A connection is two rows (one per tenant) with a shared pair key and
  workflow scopes (`invoices`, `projects`, `directory`). Sending an invoice re-checks that *both*
  sides are active and both include the invoice scope.
- **Cross-company writes are named platform operations.** Six were added to
  `PLATFORM_OPERATIONS` in [`apps/api/src/db/runtime.ts`](../apps/api/src/db/runtime.ts):
  `network.directory`, `network.connect`, `network.share`, `network.invoice_deliver`,
  `network.bill_decide`, `network.settle`. Each runs transaction-locally as the BYPASSRLS platform
  role, scopes every statement explicitly, and is logged with the operation name.
- **Everything else is ordinary tenant scope.** New tables get standard RLS
  (`fieldline_enable_tenant_rls`) in migration `0003`. The recipient's bill is a *separate row in
  its own tenant*, not a share of the issuer's invoice.
- **RBAC.** New actions: `network:read`, `network:connect`, `network:manage`,
  `network:listing_update`, `bill:read`, `bill:approve`, `bill:dispute`, `bill:pay`,
  `payment_link:create`, `ledger:read`. Bills and the ledger stay with owner/admin/finance
  (plus read-only viewers and reviewers); the API enforces the same matrix the UI mirrors.
- **Audit.** Every state change writes an `audit_events` row in the same transaction, in the
  affected company's own log (e.g. `invoice.sent` for the issuer, `bill.received` for the
  recipient).
- **Notifications.** Delivery, approval, dispute and payment notify the other company's
  owner/admin/finance members through the existing deduplicating notification service and outbox.

## Money and documents

- Amounts are integer minor units; quantities are decimal strings and rounded once per line
  (`lineAmountMinor`), tax is applied once to the subtotal (`invoiceTotals`). Both are pure and
  unit-tested.
- A delivered bill stores a **frozen copy** of the issuer's lines. Later corrections cannot rewrite
  what the payer received.
- Void is limited to drafts that never left the company. A delivered invoice is corrected by a
  credit note, which is not part of this slice.
- Payment links are references for the AP team (`provider: 'stand_in'`, `STD-XXXXXXXX`). No card
  data, no hosted checkout and no processor session exist yet; settlement is an explicit manual or
  stand-in record, labelled as such in the audit log.

## Workstream coverage

Chapters follow the blueprint's 25-workstream map. "Existing platform" means the earlier Field Pro
foundation already ships the domain tables/contracts, not that this slice finished them.

| # | Workstream | In this slice |
| --- | --- | --- |
| 01 | Market thesis and product strategy | Documentation only (this file) |
| 02 | Users, organizations, authority | Existing platform: orgs, memberships, RBAC, permission overrides |
| 03 | Information architecture and navigation | Network area + Billing/Bills routes in the shared route registry |
| 04 | Platform architecture and core domains | Existing: Fastify modular monolith, Drizzle/Postgres, RLS, outbox |
| 05 | Business identity, trust, onboarding | **Partial**: opt-in directory listing; no verification/KYB |
| 06 | Contractor directory and company network | **Implemented**: opt-in directory, two-sided connections, scopes, revoke |
| 07 | Outgoing invoices and accounts receivable | **Implemented** (company payers): draft, deliver, approve/dispute state, paid/void |
| 08 | Incoming invoices, bills and approvals | **Implemented**: bill inbox, frozen lines, approve, dispute with reason |
| 09 | Payments, reconciliation and ledger | **Partial**: settlement + double-entry ledger on the issuer's books; no live processor, no payer-side expense accounts, no refunds/credit notes |
| 10 | Projects, CRM and customer lifecycle | **Partial**: shared project pairs between companies; local CRM untouched |
| 11 | Estimating, proposals, bidding, costing | Existing: estimates/pricing contracts and modules (stubs) |
| 12 | Roofing integration and measurement engine | Existing: roof geometry, takeoff, pricing (unchanged by this slice) |
| 13 | Curb cutting, concrete, trade modules | Existing: curb contracts/geometry (unchanged) |
| 14 | Scheduling, dispatch, field execution | Existing schema/contracts only |
| 15 | Workforce, time, equipment, capacity | Existing schema/contracts only |
| 16 | Documents, contracts, collaboration | Media/storage modules exist; no document exchange between companies |
| 17 | Procurement, materials, supply chain | Not in this slice |
| 18 | Financial controls, analytics, reporting | **Partial**: balanced/unbalanced ledger summary; no statements or exports |
| 19 | AI features and human-in-the-loop | Existing vision worker, recognizers abstain; nothing added |
| 20 | Integrations, public APIs, ecosystem | Not in this slice (OpenAPI document covers the new routes) |
| 21 | Cybersecurity, fraud, privacy | **Partial**: tenancy/IDOR rules, RLS, audit, rate-limit hooks; no fraud scoring |
| 22 | Legal, accounting, construction compliance | **Partial**: auditable consent-free flows, no tax advice, no lien/regulatory automation |
| 23 | Product design, mobile, accessibility | **Partial**: permission-explained actions, keyboard tables, mobile card tables; no dedicated field capture for billing |
| 24 | Testing, infrastructure, production operations | **Partial**: contracts + rules unit tests, typecheck/lint/CI; no DB-backed integration run in this environment |
| 25 | Delivery roadmap, commercial strategy, references | This document + README status |

## Deliberate gates (not shortcuts)

These are blueprint "Gate" items and are not faked:

- **Payment provider.** Online card/bank payments require a vetted provider, webhook verification and
  PCI scope review. Until then the API only records manual/stand-in settlement and says so.
- **Company verification.** The directory is opt-in but unverified; no trust badge is shown.
- **Credit notes and progress billing.** Delivered invoices cannot be edited or voided; correction
  is the next workstream-09 slice.
- **Payer-side ledger.** The paying company records the bill and its payment, but expense/AP
  accounts need an accounting-advisor decision, so no entries are invented for it.

## Where the code lives

| Concern | Path |
| --- | --- |
| Shared contracts, lifecycle, money maths | `packages/contracts/src/network.ts` |
| Contract tests | `packages/contracts/src/network.test.ts` |
| Tables | `apps/api/src/db/schema/network.ts`, `invoices.ts` (delivery columns), `orgs.ts` (directory) |
| Migration + RLS | `apps/api/drizzle/0003_elite_electro.sql` (append-only custom section at the end) |
| Directory, connections, projects API | `apps/api/src/modules/network/index.ts` |
| Accounts receivable API | `apps/api/src/modules/invoices/index.ts` |
| Bills, payment references, settlement, ledger API | `apps/api/src/modules/bills/index.ts` |
| DTO mappers and company notifications | `apps/api/src/services/invoice-exchange.ts` |
| Web screens | `apps/web/src/features/network/NetworkView.tsx`, `apps/web/src/features/billing/BillingView.tsx` |

## Checks

```sh
npm run typecheck     # every workspace
npm run test:unit     # contracts, API unit project, packages, dev IdP
npm run lint
npm run build -w @fieldline/web
```

The database integration tests (`npm run test:integration`) and the migration need a Postgres/PostGIS
instance, which this environment does not provide; they were not run here.
