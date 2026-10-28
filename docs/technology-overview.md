# Field Pro — Technology, architecture, and integrations

**Website:** https://field-pro-marketing.vercel.app  
**Source repository:** [Field Pro](https://github.com/samadalam481470sa-cmd/curb-connect)  
**Development status:** Platform foundation and core infrastructure are in place; product modules and production integrations are being implemented and verified in phases.

## What Field Pro does

Field Pro is a contractor operations platform designed around two equal product areas:

1. **Roof Measurements** — property selection, roof geometry and facet sketches, pitch, quantities, material calculations, reporting, and estimating.
2. **Curb Cutting** — job-site photo capture, calibrated dimensions, curb-line geometry, and preliminary cost estimates, with reviews for permits, right-of-way, utilities, and other field uncertainties.

The platform architecture also supports organization workspaces, users and permissions, customers, jobs, proposals, estimates, invoices, document workflows, and shared operational reporting. Availability of each module is controlled by the implementation state and feature flags.

## Frontend

| Technology | Use |
| --- | --- |
| **TypeScript** | Main application programming language and typed frontend contracts |
| **React 19** | Reusable interactive application components |
| **Next.js 16 (App Router)** | Application routing, pages, server integration, and PWA web shell |
| **HTML and CSS** | Layout, responsive design, visual styles, and accessibility |
| **`@fieldline/ui`** | Custom React components, design tokens, navigation, and accessible UI primitives |
| **TanStack Query** | API requests, caching, and server-state synchronization |
| **MapLibre GL** | Interactive map presentation |
| **IndexedDB / `idb-keyval`** | Local drafts and offline upload/write outbox |
| **PWA manifest and service worker** | Installable browser app, offline shell support |

The signed-in UI lives in [`apps/web`](../apps/web). The homepage presents Roof Measurements and Curb Cutting as equal work areas, with a work queue for tasks that need attention. Its current look and behavior are separate from the public marketing site's presentation.

## Backend and APIs

| Technology | Use |
| --- | --- |
| **Node.js 24** | JavaScript/TypeScript backend runtime |
| **TypeScript** | API logic, server modules, shared contracts and background jobs |
| **Fastify 5** | Versioned REST API under `/v1` |
| **Zod** | Runtime validation and typed API contracts |
| **OpenAPI 3.1** | API documentation and request/response specifications |
| **Drizzle ORM / postgres.js** | PostgreSQL access and schema/migration management |
| **graphile-worker** | Background job processing and transactional outbox |
| **Python 3.13 / FastAPI** | Separate image-quality and AI/vision integration service |

The API lives in [`apps/api`](../apps/api). Its documented local URL is `http://localhost:4000`, while the Python service is available locally on port `4200`. These are development defaults, not public service addresses.

## AI integration and computer vision

Field Pro **integrates an AI/vision service architecture** through [`services/vision`](../services/vision). It supplies a dedicated, separately deployable service with defined request/response contracts for roof detection and curb recognition, a versioned model registry, authorization checks, analysis-rights controls, and review-required fallbacks.

Implemented image processing includes **deterministic photo-quality checks** for blur, exposure, glare, resolution, aspect ratio, metadata issues, and potential duplicate images. These checks are engineered image-analysis algorithms, not a trained recognition model.

**Current availability:** The repository does **not** contain a trained, validated roof or curb recognition model. Unless such a model is registered, approved, and enabled, the recognition endpoints explicitly abstain and require human review. This prevents unsupported automated measurements or inferred construction conditions. For details, see [the vision-service README](../services/vision/README.md).

## Data and file storage

- **PostgreSQL 17** — relational data for organizations, users, projects, estimates, and operational records.
- **PostGIS** — geographic/geospatial fields and queries.
- **Row-Level Security (RLS)** and tenant-aware foreign keys — isolate data by organization.
- **Versioned business records and audit events** — support traceability and revisions.
- **Local encrypted object storage** — development/test files with AES-256-GCM protection.
- **S3-compatible object storage** — production storage interface for uploaded photos and documents.
- **PDF generation** — reusable report templates via `@react-pdf/renderer`.

## Identity and security

The application implements provider-neutral OpenID Connect authorization-code login with PKCE, server-side sessions, organization-scoped role permissions, request validation, and audit logging. **Microsoft Entra ID** is the planned production login provider, but registration and deployment configuration are still needed. The local development identity server is a test-only component and must not be used as production authentication.

## Website, payment, and deployment

**Public website:** [field-pro-marketing.vercel.app](https://field-pro-marketing.vercel.app) — marketing and product information, hosted on **Vercel**.

The marketing site is **not** the same deployment as the signed-in Field Pro application. The website files are maintained in the repository's [marketing preview branch](https://github.com/samadalam481470sa-cmd/curb-connect/tree/feature/field-pro-public-preview-20261028/marketing-preview), while the application foundation is under `apps/web` on `main`.

- **Website price display:** A **$150 one-time** offer is shown.
- **Checkout:** The website currently shows a payment-unavailable message when the purchase button is clicked. It does **not** process live Stripe payments.
- **Downloads:** Paid source-code/download delivery is not active.
- **Application hosting:** A full production deployment of the API, database, storage, vision worker, and authenticated app is not configured by the marketing site.
- **Deployment workflow:** GitHub Actions provides CI and release artifact builds; the original app's production hosting remains a separate deployment task.

## Development structure

| Path | Responsibility |
| --- | --- |
| [`apps/web`](../apps/web) | Next.js application frontend / installed PWA |
| [`apps/api`](../apps/api) | Fastify REST API, data access, sessions, business operations |
| [`services/vision`](../services/vision) | Python image-analysis and AI integration interfaces |
| [`packages/contracts`](../packages/contracts) | Shared types, validation, permission rules, feature flags |
| [`packages/pricing`](../packages/pricing) | Decimal-based roof and curb estimating calculations |
| [`packages/geometry`](../packages/geometry) | Measurement geometry, calibration, polygon validation |
| [`packages/ui`](../packages/ui) | Component library and visual design tokens |
| [`packages/pdf`](../packages/pdf) | PDF/report templates |
| [`infra`](../infra) | Local services, Docker/PostGIS, development tooling |
| [`legacy`](../legacy) | Prior implementation retained for historical reference |

## Quality checks

The repository uses **ESLint**, **TypeScript type checks**, **Vitest**, **pytest**, **Playwright**, and **GitHub Actions** for linting, type safety, units, integration tests, and browser journeys.

For a deeper explanation of system design, authorization, SQL tenancy policies, storage, and numerical calculations, see [Architecture](architecture.md). For local setup, installation, and scripts, see the [repository README](../README.md).
