# Renditions-style portal capture (external-order gathering)

Field Pro's equivalent of Hyphen SupplyPro's **Renditions** ("Gather" in
Gather–Translate–Automate): orders from builders who are **not** on Field
Pro, gathered from their portals into one consistent format so a supplier
doesn't juggle dozens of builder-portal logins.

This document describes the **capture framework** that shipped in migration
`0100_portal_capture`. It is deliberately honest about what does and does
not exist yet.

## What exists now

- **Credential vault** (`portal_connections`): one row per builder-portal
  account. The supplier enters their own portal login; the secret is sealed
  with AES-256-GCM using the deployment's `STORAGE_ENCRYPTION_KEY` before it
  touches the database. Secrets are **write-only** — no API returns them
  (sealed or plain), they are never logged, and they never appear in job
  payloads. If `STORAGE_ENCRYPTION_KEY` is not configured, the API refuses
  to store secrets rather than falling back to anything weaker.
- **Adapter interface + registry** (`modules/portalCapture/adapter.ts`):
  `login` → `listOrders` → `fetchOrder`, keyed by `portalKey`. Connection
  states are `not_connected`, `connected`, `login_failed`,
  `portal_changed`, `blocked`.
- **Capture runs** (`portal_capture_runs`): manual "Run capture now" per
  connection, plus a daily scheduled job (`portal_capture_run`, 6:30 am
  Texas time) that runs one capture per stored connection. Each run records
  orders found / new / revised and per-order errors.
- **External orders** (`external_orders`): captured orders normalized
  through the org's existing **SKU mappings** (exact match on the builder's
  item/package name; unmapped lines stay unmapped and flagged — never
  guessed equivalent). The raw captured payload is kept verbatim as the
  audit trail. Re-capturing the same builder PO number updates the same row
  as a **revision** (dedupe key: org + connection + builder PO number),
  never a duplicate.
- **Handoff**: a human converts a captured order into a **draft supplier
  order** (existing PO flow, `origin: 'external_capture'`) after choosing
  the job. Conversion is idempotent — converting twice returns the same
  draft, never two POs. Captured orders never auto-commit money.
- **UI**: `/portal-capture` (Operations → Orders & bids) — connections with
  add/delete and write-only secret entry, run history, external orders with
  per-line mapping status and convert action.

## The no-anti-bot-evasion rule (hard rule)

Adapters log in with the **supplier's own credentials**, provided by the
supplier, using a **plain authorized login** to read the **supplier's own
orders**. Nothing in this framework — and nothing added later — may use:

- CAPTCHA solving (human farms, solvers, or AI),
- browser fingerprint spoofing or stealth/undetectable-browser tooling,
- proxy/IP rotation or header spoofing to defeat bot detection,
- any other technique whose purpose is to evade a portal's access controls.

If a portal blocks automated login, the connection state is honestly
`blocked` and capture stops there. That is a product boundary, not a bug to
work around.

## What does NOT exist yet

**Zero live portal adapters.** No real builder portal has been verified,
and inventing one would be fake. Until an adapter is registered, every
capture run honestly reports `no_adapters` and the UI says so plainly.

### How an adapter gets added (per builder portal)

1. A supplier on Field Pro has a real account on a specific builder portal
   and wants its orders gathered.
2. An adapter is written for that portal against the interface in
   `adapter.ts`, using plain authorized login with that supplier's
   credentials, and tested against the real account.
3. The adapter is registered in `PORTAL_ADAPTERS` (one entry, keyed by
   `portalKey`). The fixture adapter in `fixtureAdapter.ts` is for unit
   tests only and must never be registered.
4. Portal changes will break adapters over time; that surfaces as
   `portal_changed` on the connection and a failed run — by design.

## Gated states

- **Vault not configured** (`STORAGE_ENCRYPTION_KEY` unset): connections
  cannot be created; the status endpoint and UI say so.
- **No adapter for a portal**: runs record `no_adapters`; the connection
  itself is left untouched (no fake "checked" timestamp).
- **Login rejected / portal changed / blocked**: connection status shows
  the adapter's honest verdict with the last error; nothing is retried
  around the block.
- **Unpriced orders**: totals are null (never invented); unmapped lines are
  flagged for a human to map via SKU mappings before conversion.
