# ADR 0006: Provider-neutral OpenID Connect identity

- Status: Accepted
- Date: 2026-10-26
- Requirements: PLT-013, BE-078, LCH-091

## Context

The owner requires Microsoft Entra sign-in first, with the option to change identity providers
later without changing internal user ids. The Entra app registration does not exist yet, but the
real OIDC code path must be built and tested now. Accounts are multi-tenant: one person can belong
to several contractor organizations.

## Decision

- Authenticate with **OpenID Connect authorization code flow + PKCE + state + nonce** using
  `openid-client` v6. Providers are configured from environment (`MICROSOFT_*`, `DEV_IDP_*`); a
  provider that is not fully configured is shown as unavailable, never simulated.
- Identity mapping: `external_identities(issuer, subject) -> users.id`. Email is profile data and
  is never used to identify or link accounts automatically.
- For local development and CI, `infra/dev-idp` runs a stand-in OIDC provider (`oidc-provider`)
  with seeded test identities. It refuses to start in production, and the API rejects dev-IdP
  configuration when `NODE_ENV=production`.
- Server-side sessions: an opaque random token in the `fl_session` cookie (httpOnly, Secure in
  production, SameSite=Lax); only its SHA-256 is stored, with idle and absolute expiry and rotation
  on login. Membership and user status are re-checked on every request.

## Consequences

- Adding or replacing a provider is configuration plus a provider entry, with no data migration of
  user ids.
- The full protocol (discovery, PKCE, nonce validation, token exchange) is exercised in tests
  against the stand-in provider, so Entra integration is mostly configuration.
- Server-side sessions make revocation immediate at the cost of a session lookup per request.

## Revisit triggers

- The owner registers the Entra app (switch staging to it; keep the dev IdP for local and CI).
- A requirement for SAML, SCIM provisioning, or customer-managed identity providers per tenant.
- Session lookup becomes a measurable latency cost.
