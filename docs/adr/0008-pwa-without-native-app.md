# ADR 0008: Installable PWA, no native app for now

- Status: Accepted
- Date: 2026-10-26
- Requirements: PLT-011, PLT-018, PLT-019, LCH-095

## Context

The owner wants a responsive web app that installs on phones and desktops with a home-screen
icon. Field users capture curb photos on site with unreliable connectivity, and the project must
"survive browser reloads, partial connectivity, duplicate submit, team handoff and user revocation
without lost data or double billing". "PWA vs native capture/AR" is listed as an open business
decision.

## Decision

- Ship **one Next.js App Router web app** that is an installable PWA: `app/manifest.ts`, original
  icons (including maskable) in `public/icons`, and a **hand-written** `public/sw.js` (no
  service-worker framework) registered only in production builds.
- The service worker never caches tenant API responses or signed media URLs. Offline resilience
  comes from an **IndexedDB outbox** in the app (`idb-keyval`): drafts and queued writes persist
  across reloads and replay with their original `Idempotency-Key`, so retries cannot double-submit.
- Camera capture uses standard browser APIs (file input with capture, `getUserMedia` where
  available). No AR measurement: photo-derived values remain advisory and require a calibrated
  reference.

## Consequences

- One codebase and deployment for every device; updates ship instantly without app-store review.
- Some device features (background sync on iOS, precise AR, persistent background uploads) are
  limited or unavailable; flows must degrade to manual entry and explicit retry.
- Server-side revocation still applies offline: queued writes from a revoked user are rejected on
  replay and surfaced to the user, never silently dropped.

## Revisit triggers

- The owner decides native capture or AR measurement is required.
- Pilot data shows lost captures or upload failures that browser APIs cannot fix.
- A customer requires MDM distribution or device APIs unavailable to the web.
