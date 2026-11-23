# Phase F item 32 — claims audit (flag only, nothing changed)

Date: 2026-11-22. Scope: `marketing-site/public/index.html` and in-app copy in `apps/web/src`,
checked against what the code actually does on main (`6e9a3ba`) plus Phase F. Per the owner's
no-removal rule this audit **flags only** — no claim was edited, softened or removed here. The
two claims softened in `6e9a3ba` (supplier price scan, email invoices) were re-checked and are
now accurate.

## Flagged — claim promises more than the code delivers today

1. **"Turn an estimate into a proposal and then an invoice"** (marketing, estimates list).
   The proposals API module is a stub (`apps/api/src/modules/proposals/index.ts`: "Stub: no
   routes yet") and the web proposals screen is a ComingSoon page. Estimates and invoices work;
   the proposal step in between does not exist yet. In-app copy is honest (future tense:
   "Proposals will turn approved estimates into customer proposals with e-signature").
2. **"Secure checkout by Stripe" / "One-time payment" / "Instant download" / "No subscription,
   ever"** (marketing hero + pricing). The app is a 7-day-trial subscription product; Stripe
   checkout activates only with `STRIPE_*` env vars plus an active plans row, and the live-site
   checkout/Vercel work is item 33 (not done). Until item 33 lands, the site promises a purchase
   flow that cannot complete.
3. **"Roof damage check from a photo"** (marketing, roof list). Real, but gated: without a
   vision model key the API reports "Photo damage analysis is not configured on this server"
   and invents nothing. The claim is unqualified.
4. **"Invite team members by email to your company workspace"** (marketing, crew list).
   Invitations exist (7-day expiry), but delivery rides the mail adapter: with no mail setup
   the invite is recorded, not sent. Same gate as all other email (SMTP/mailer not connected).
5. **"Unlimited team members with no per-seat fees"** (marketing). A pricing/business-model
   claim, not a code claim: the app enforces trial/subscription access per company. Flagged
   for the owner's pricing decision; code neither confirms nor denies it.

## Checked and accurate

- "Supplier price scan for material lines (live when a price source is connected)" — softened
  in `6e9a3ba`; SerpApi wiring + source/timestamp display verified (Phase D).
- "Email invoices from your own Gmail or Outlook once your mailbox is connected" — softened in
  `6e9a3ba`; in-app copy matches ("Connect Gmail or Outlook in Settings → Email first…").
- No marketing or in-app claim for **supplier ordering** (item 17, off) or **permit rule
  checks** (item 18, off). In-app screens show unavailable while off.
- No claim of live GPS/telematics for fleet (manual check-ins only), no auto-weather claim for
  daily logs (manual entry, labeled), no third-party e-sign claim (typed-name attestation with
  document hash; the word "e-signature" appears only in the future-tense proposals summary).
- "Import an existing IFC building model" — real (`/v1/home/import-ifc`), labeled preliminary
  in-app. "Tree-covered roof help" — real (tree-obscured footprint finder + tests).
  "Server check of plan and sloped area" — real.
- No AI/assistant claim on the marketing site. In-app, Ask Field Pro states plainly when no AI
  is connected and falls back to built-in help topics (Phase F item 28).
- HVAC/electrical estimator copy states planning-only limits (not Manual J / not NEC 220) in
  both UI and CSV (Phase D); no marketing claim overstates them.

## Recommendation (owner's call, nothing done here)

Soften or qualify items 1–4 the same way the two `6e9a3ba` claims were handled, or activate
the gates (mail setup, vision key, item 33) so the claims become true. Item 5 is a pricing
decision. This file is the record; no copy was changed.
