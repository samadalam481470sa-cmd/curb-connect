# Production safety, accessibility and capacity gates — 2026-11-22

Scope: Curb Connect / Field Pro web, API, uploaded records, mail, and marketing storefront.
This is a **risk register and test plan**, not a claim of security certification, ADA conformance,
legal compliance, 100,000-user capacity, or successful full end-to-end testing.

## Evidence from repository and deployment

- Latest reviewed base: `main` at `6a235a6886ed937a537df5b92499776ccb050f69`; CI succeeded.
- Render has one instance each for `curb-connect-web` and `curb-connect-api` on the free plan,
  configured to deploy automatically from `main`. This cannot establish production scaling.
- API startup logs on 2026-11-22 explicitly report `STORAGE_DRIVER=local` without durable disk.
  Uploaded media can disappear on deployment or restart. **Do not promise permanent storage.**
- Startup logs also report that `SMTP_URL` is not configured. Before the proposed registration
  guard, password sign-up auto-verified new mailboxes when mail was missing in production.
- `main` is not branch-protected. GitHub repository visibility is public.
- API implementation defaults to `NoopScanner` for uploaded files. Rate-limit state and part of
  OIDC replay defense are process-local (see `docs/security.md`).
- `ci.yml` covers dependency audit, secret scan, lint, typecheck, unit, integration, vision and
  Playwright tests. These do not prove the absence of vulnerabilities or check every user journey.

## Stop-ship issues (owner / hosting configuration)

1. **Durable storage:** provision private S3-compatible storage with least-privilege access,
   `STORAGE_DRIVER=s3` and its required credentials; test upload, restart, download, encryption,
   deletion and restore. Back up and reconcile any current local uploads before switching.
2. **Account verification:** configure working `SMTP_URL`, `MAIL_FROM`, SPF/DKIM/DMARC and
   monitoring; test sign-up, receipt, token expiry, resend and trial entitlement.
   The proposed guard intentionally refuses new password accounts (HTTP 503) in production until
   a real mail transport exists. Existing accounts can still sign in.
3. **Protected delivery:** enable branch protection on `main` requiring all CI checks and code
   review; avoid deployment straight from unreviewed commits. Make the repository private if it
   contains proprietary code, and audit past history for secrets before assuming privacy.
4. **File safety:** run a production malware scanner, inspect file magic/signatures, reject
   executable content, constrain document parsers, enforce quotas, and test malicious samples.
5. **Secrets and persistence:** verify database backups, point-in-time recovery, secret rotation,
   least-privilege production database connections, audit log retention and emergency restore.
6. **Scale:** add shared distributed rate-limit/replay storage, background job capacity,
   queue backpressure, WAF/bot filtering, CDN/object caching, tuned PostgreSQL connections and
   autoscaling on a paid service tier. Measure instead of assuming capacity.

## Accessibility release gates

- Target **WCAG 2.2 Level AA** in design, with a documented exception backlog; assess the legally
  applicable requirements with qualified counsel. The DOJ's state/local government Title II
  technical rule specifically references WCAG 2.1 AA, not 2.2. Private businesses have separate
  obligations under ADA Title III.
- Run browser axe checks in CI on public entry pages, then expand to every authenticated module.
- Manually test keyboard-only use, focus sequence/visibility, screen readers (NVDA, VoiceOver),
  text scaling to 200%, 320 CSS px reflow, touch target sizes, language and error summaries,
  dialogs, interactive maps/canvases, charts, 3D controls, invoices and exported PDFs.
- Run the same checks against the **separate marketing-site** build and mobile/AR workflows.
- Keep evidence: date, build SHA, test matrix, assistive technology, issues, owner and fixes.
  Do not claim complete ADA conformance from automated axe results alone.

## Safe capacity-test procedure

**Do not run these tests against production or the current free-tier Render services.**
Provision isolated staging that mirrors production topology, with seeded *fictional* accounts,
controlled email/payment stubs, a separate database and prearranged hosting budget.

Install k6, then:

```sh
k6 run -e BASE_URL=https://staging.example.com -e CONFIRM_STAGING=YES -e PROFILE=smoke scripts/performance/k6-staging.js
k6 run -e BASE_URL=https://staging.example.com -e CONFIRM_STAGING=YES -e PROFILE=baseline scripts/performance/k6-staging.js
# Only after monitored smaller tests and explicit infrastructure approval:
k6 run -e BASE_URL=https://staging.example.com -e CONFIRM_STAGING=YES -e PROFILE=100k-visits -e CONFIRM_100K=YES scripts/performance/k6-staging.js
```

The final profile produces **100,000 synthetic unauthenticated visits**, NOT 100,000 simultaneous
signed-in users. It does not create accounts or mutate data. Real proof of 100,000 *registered*
users requires staging fixtures and measured enrollment, tenant isolation and data volume.
Real proof of 100,000 *concurrent* users additionally requires a separate distributed multi-region
load plan, realistic session mix, paid capacity and explicit cost controls.

Track at least: completed throughput, p50/p95/p99 latency, 4xx/5xx, saturation, cold starts,
PostgreSQL CPU/connections/slow queries, queue age, upload failures, and cloud spending. Stop
the run on sustained high errors or risk to production neighbors. Repeat with realistic authenticated
journeys: sign-in, dashboards, roof analysis, curb estimates, invoices, uploads, bidding and export.

## Legal/commercial review (not a legal conclusion)

- Privacy notices, actual hosting/email/payment processors, retention, user export/deletion,
  security incidents and applicable state laws (including Texas TDPSA where in scope).
- Outbound email: CAN-SPAM, marketing consent and unsubscribe process; check TCPA and relevant
  state rules before automated outreach calling/texting.
- Payments: truthful one-time vs subscription pricing, refunds, taxes, Stripe webhook handling,
  PCI DSS scope, purchase/download fulfillment and cancellation where required.
- Construction: local licensing, contractor permitting, right-of-way, OSHA safety practices,
  engineering/architect licensing restrictions, imagery copyright and permitted use, and
  professional approval of AI-generated measurements, plans and structural recommendations.
- Terms: limitation of warranties must not be described as a substitute for safety controls.
  Commission a qualified accessibility reviewer, security tester and attorney before launch.
- Compare published legal policies with actual deployment and processors; old privacy statements
  about no third-party processors or no paid offering may be stale.
