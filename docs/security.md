# Security model and verification

This document records what protects the platform, how the payment credentials are kept out of the
repository, and the limits that remain. It is written to be checkable: every claim points at code or
a command, and the gaps are stated instead of hidden.

Run the checks:

```sh
npm run security:secrets   # tracked files contain no credential patterns
npm run security:audit     # production dependencies have no high/critical advisories
npm run test:unit          # includes apps/api/src/security-probes.test.ts
```

## Payment credentials (Stripe)

**Stripe checkout is not live yet.** The payments module is an empty stub, the web app never renders
a checkout form, and no publishable or secret payment key is read by the browser. The only Stripe
references in the repository are the `'stripe'` enum value, the `stripe` SDK dependency (installed
but unused), and empty placeholders in `apps/api/.env.example`:

```
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

Verified on 2026-11-10:

- `git log --all -S"sk_live" -S"sk_test" -S"whsec_"` returns no commit: no key has ever been
  committed, so there is nothing to scrub from history.
- `git ls-files` shows only `*.env.example` files; `.gitignore` ignores `.env` and `.env.*` while
  re-including `!.env.example`.
- No `NEXT_PUBLIC_*` payment variable exists, so nothing payment-related can be inlined into the
  browser bundle.
- `npm run security:secrets` scans every tracked file (source, docs, fixtures, snapshots) for
  Stripe, AWS, GitHub, Slack, Google, OpenAI and private-key formats. It runs in CI before
  `npm ci`, and as a unit test.

**Where the keys belong:** the API host's environment (or your secret manager) for
`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`, and GitHub → Settings → Environments → _Secrets_
when CI needs them. Never in a file that git tracks, never in a PR comment, a screenshot, a chat
message, or an issue. The scanner cannot see a key pasted into chat — treat any key that appears
there as burned.

**If a key leaks:** revoke it in the provider dashboard first (a deleted commit is still readable
until the secret expires), issue a replacement, update the host environment and GitHub secrets, then
rewrite history. Rotating is what ends the exposure; deleting the line is not.

## Brute force and session abuse

- Sign-in is delegated to the identity provider (OIDC, authorization code + PKCE + `state` +
  `nonce`); the platform stores no passwords, so there is no password-hash endpoint to hammer.
- Every auth route is rate limited per client IP (`AUTH_RATE_LIMIT_PER_MINUTE`, default 30/min) —
  `/auth/login/:provider`, `/auth/callback/:provider`, `/auth/link/:provider`, `/auth/logout`,
  `/auth/providers`.
- A callback must carry a signed, httpOnly, 10-minute transaction cookie whose `state` matches and
  is single-use in the process, so a captured callback URL cannot be replayed.
- Sessions are opaque 256-bit random tokens; only their SHA-256 is stored. Cookies are `httpOnly`,
  `SameSite=Lax`, signed, and `Secure` in production. Sessions rotate on sign-in (the previous one is
  revoked), have idle and absolute expiry, and are all revoked when a user is deactivated.
- Money and network mutations are rate limited per route (20–120/min depending on cost): invoice
  create / send / void, bill view / approve / dispute / payment-link / settle, and every
  connection, project-share and directory update.

## SQL injection

- Every input is validated by a Zod schema (`fastify-type-provider-zod`): unknown fields are
  stripped, types and lengths are enforced, and ids are `uuid`, so a payload like
  `' OR 1=1 --` fails validation before it reaches the database.
- All queries are Drizzle query-builder calls, which bind values as parameters. There is no
  `sql.raw()` anywhere in the API, and no `execute()` call built by string interpolation — the only
  `sql` templates are static DDL/defaults or parameter-bound (`sql\`... ${value} ...\``), which
Drizzle turns into `$1` placeholders.
- `security-probes.test.ts` fails the build if either pattern reappears.
- Tenant isolation is enforced twice: RBAC on the route and PostgreSQL row-level security on the
  restricted `fieldline_app` role, so an injection that somehow bypassed validation still could not
  read another company's rows.

## Cross-company access

Every cross-tenant write is a named entry in `PLATFORM_OPERATIONS`
(`network.directory|connect|share|invoice_deliver|bill_decide|settle`). Anything not in that
allowlist throws at runtime. The receiving company gets its own mirrored row; it never reads the
issuer's invoice. Authenticated routes default to requiring a workspace and a permission — a route
must opt out explicitly with `config: { auth: 'none' }`.

## CSRF and XSS

- Unsafe methods are rejected when `Origin` is missing-but-cross-site, `null`, or not
  `APP_ORIGIN`/`API_ORIGIN` (`http/origin.ts`), on top of `SameSite=Lax` cookies.
- Helmet sets CSP, `X-Content-Type-Options: nosniff`, frame protection and HSTS in production.
- The web app is React (auto-escaping); there is no `dangerouslySetInnerHTML` in the billing or
  network screens. API responses are JSON with an explicit content type.

## Supply chain ("trojan horse")

- `package-lock.json` is committed and CI installs with `npm ci`, so a compromised transitive
  version cannot be swapped in unnoticed between runs.
- No workspace declares `preinstall` / `postinstall` / `prepare` scripts, so `npm ci` runs no
  repository-authored code.
- `npm audit --omit=dev` is a CI gate for high/critical advisories.
- Application code contains no `eval`, `new Function`, or `child_process` usage (asserted by the
  probe test); uploads are intended to pass through the `MalwareScanner` seam.
- Container and OS patching, registry provenance and 2FA on the npm/GitHub accounts are operational
  controls outside this repository.

## Known limits (do not treat as solved)

- **Rate limiting is per process and in-memory.** With several API instances, the effective limit
  multiplies; a shared store (Redis) is required before horizontal scaling.
- **OIDC replay protection is per process.** A callback consumed on instance A is not known to
  instance B; a shared store or sticky routing is needed for strict single-use across instances.
- **The malware scanner defaults to a no-op** (`NoopScanner`). Until a real scanner is configured,
  uploaded files are only type/size checked.
- **No WAF, bot detection or account-takeover scoring.** The blueprint's fraud workstream is not
  implemented.
- **Stripe is not integrated.** When it is, webhook signatures must be verified with the raw body,
  and the secret key must stay server-side; checkout must remain a redirect to the provider rather
  than card fields in this app.
- **Development tooling has moderate advisories.** `npm audit --omit=dev` (the production tree) is
  clean; `npm audit` also reports 14 moderate advisories in `esbuild` and `minimatch` reached through
  the test/build tools (vitest, tsup). They are not shipped in the release artifacts, but keep them
  on the upgrade list and re-run the audit when the test toolchain is next bumped.
- `legacy/curb-connect-v1` is an archived prototype and is not covered by these checks.
