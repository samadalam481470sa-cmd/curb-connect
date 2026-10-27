## What and why

<!-- One or two sentences. Link the blueprint page(s) this implements. -->

## Requirement IDs

<!--
List every requirement this PR implements or changes, using the blueprint IDs with a layer suffix:
STR-001..010, PLT-011..020, RF-021..030, RR-031..040, CV-041..050, CP-051..060, OPS-061..070,
BE-071..080, AIQ-081..090, LCH-091..100, suffixed -FE / -API / -QA / -DOC (e.g. CP-052-API).
Reference the same IDs in test names and in code comments where the rule is implemented.
-->

-

## Checklist

- [ ] Tests cover normal, boundary and failure cases (and rounding for any formula).
- [ ] Tenant isolation: every query is org-scoped; new tenant tables have `org_id`, composite FKs and RLS.
- [ ] Writes are audited, validated with zod, permission-checked server-side, and idempotent where required.
- [ ] Unknown values stay `unknown` (never 0); safety gates (permits, utilities, right-of-way, depth) are not bypassed.
- [ ] Unfinished behavior is behind a feature flag and shown as unavailable or manual, never faked.
- [ ] Money uses decimal arithmetic and integer minor units; geometry uses canonical SI units.
- [ ] No competitor code, brand, copy, templates or imagery; brand text comes from `BRAND`.
- [ ] Docs updated (architecture, ADR, runbook, help copy) if behavior or decisions changed.
- [ ] `npm run lint && npm run typecheck && npm test && npm run build` pass locally.

## How to verify

<!-- Commands, screenshots, or the acceptance statement you demonstrated. -->
