# Integration inventory

No third-party vendor credentials exist in this repository or its CI. Every vendor-shaped capability
is an adapter seam with an honest development behaviour. This file records what is wired, what is
seamed, and what is absent.

## 1. Wired and working (locally verifiable)

| Integration            | Mechanism                                                                                                   | State                                                          | Evidence                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------- |
| OIDC identity provider | `openid-client` authorization code + PKCE, state, nonce; providers from config (`MICROSOFT_*`, `DEV_IDP_*`) | Wired; Entra **not registered** (owner decision D-10)          | `modules/auth/oidc.ts`, `infra/dev-idp/`        |
| Local dev IdP          | standalone OIDC provider with seeded identities, port 4100                                                  | Wired, dev/test only                                           | `infra/dev-idp/src/*`                           |
| PostgreSQL + PostGIS   | drizzle-orm + postgres.js, two roles, RLS session settings                                                  | Wired (not executed in this audit)                             | `src/db/*`, `infra/docker-compose.yml`          |
| Durable jobs / outbox  | graphile-worker in the same database                                                                        | Wired                                                          | `src/jobs/*`                                    |
| Object storage (dev)   | `LocalEncryptedStorage`, AES-256-GCM, HMAC-signed URLs                                                      | Wired                                                          | `src/storage/local.ts`                          |
| Object storage (prod)  | `S3Storage`, presigned PUT/GET, SSE                                                                         | Implemented, **not exercised**                                 | `src/storage/s3.ts`                             |
| Vision worker          | FastAPI on port 4200, bearer token, versioned contracts                                                     | Worker wired and tested in isolation; **API client is a stub** | `services/vision/`, `modules/vision`            |
| Email                  | nodemailer transport + outbox delivery + failure retry                                                      | Wired to a dev transport; no real provider (D-11)              | `src/services/mail.ts`, `modules/notifications` |
| Imagery                | rights engine modelled (`visualize`, `analyze`, `cache`, `embedInExports`, `redistribute`, `expiresAt`)     | Modelled only; no tile provider                                | schema `imagery.ts`, `modules/imagery` stub     |

## 2. Adapter seams with no vendor chosen

| Capability                  | Seam                                                                                                                         | Current behaviour                                                     | Blocking decision |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------- |
| Card/bank payments          | `modules/payments` (stub) + `stripe` dependency present in `apps/api/package.json`                                           | Nothing charges; no webhook route; `billing.online_payments` flag off | D-07              |
| E-signature                 | `modules/signatures` (stub), `signature_envelopes`/`signature_events` tables, `SignRequestSchema` with document-hash binding | Nothing is sent for signature                                         | D-07              |
| Licensed roof imagery       | `modules/imagery` (stub) + rights engine                                                                                     | Visualization-only assumption; no machine analysis                    | D-03              |
| Supplier catalogue/ordering | `supplier_orders` table, `ops.supplier_orders` flag off                                                                      | Contractor-maintained prices only                                     | —                 |
| SMS                         | `notifications.sms` flag off, no adapter                                                                                     | Not sent                                                              | D-11              |
| Malware scanning            | scan adapter records `scanStatus: "not_scanned"`                                                                             | Honestly unscanned                                                    | —                 |
| Address geocoding           | contracts define `AddressCandidate`/`AddressSearchQuery`; no provider client                                                 | No address search                                                     | D-01/D-03         |
| Parcel/jurisdiction lookup  | `jurisdictions` table, synthetic rows only                                                                                   | Jurisdiction unresolved ⇒ review required                             | D-01              |
| OpenTelemetry export        | hooks installed, `OTEL_EXPORTER_OTLP_ENDPOINT` enables export                                                                | Off unless configured                                                 | —                 |

## 3. Absent by design (safety properties, not bugs)

| Property                        | Why it is absent                            | Rule it protects                                                                                           |
| ------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Trained roof/curb CV model      | `INSTALLED_RUNTIMES` is intentionally empty | Recognition abstains with `no_validated_model_enabled`; suggestions can never be mistaken for measurements |
| Photo-derived buried conditions | vision `constructionFields` always unknown  | Thickness, reinforcement, utilities are never inferred from pixels                                         |
| Automatic permit approval       | no municipal rules loaded                   | Permit requirements stay unresolved until a named human signs                                              |
| Automatic quote release         | gating based on open risk flags             | A preliminary estimate stays labelled as such                                                              |
| Marketing site source           | separate deployment, not this repository    | No accidental coupling                                                                                     |

## 4. CI/CD integrations

| Item              | State                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| GitHub Actions CI | lint → typecheck → unit → build; API integration on `postgis/postgis:17-3.5`; pytest; Playwright (non-blocking) |
| Release workflow  | builds `api.tar.gz`, `web.tar.gz`, `vision.tar.gz` + SHA256SUMS as immutable artifacts; **deploys nowhere**     |
| Hosting           | undecided; the deploy job prints that no target is configured                                                   |
| Secrets           | CI uses throwaway values only; no production secret exists in the repo                                          |

## 5. Implications for additive work

1. Adding a vendor means implementing an adapter behind the existing seam and keeping the honest
   development behaviour when it is unconfigured.
2. Any payment integration must verify provider-signed webhooks server-side and be idempotent; a
   success redirect is not proof of payment.
3. Any imagery integration must pass through the rights engine at ingestion, inference, cache and
   PDF export.
4. Do not enable `curb.ai_measurement`, `roof.auto_facets`, `billing.online_payments`,
   `ops.supplier_orders` or `notifications.sms` to make a screen look complete.
