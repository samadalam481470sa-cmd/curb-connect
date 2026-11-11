# Component inventory

## 1. Shell and layout (`apps/web/src/components`)

| File                           | Responsibility                                                                     | Used by                                                           | Notes                                    |
| ------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| `shell/AppFrame.tsx`           | Sidebar, phone bottom bar, menu sheet, breadcrumbs, workspace switcher, search box | `(app)/layout.tsx`                                                | Tested (`AppFrame.test.tsx`, 11 cases)   |
| `shell/RouteAnnouncer.tsx`     | announces route changes for screen readers                                         | `AppFrame`                                                        | focus management                         |
| `shell/SearchBox.tsx`          | universal search entry                                                             | `AppFrame`                                                        | hits the search stub                     |
| `shell/WorkspaceSwitch.tsx`    | active-org switch                                                                  | `AppFrame`                                                        | calls `POST /v1/session/active-org`      |
| `shell/useClientNavigation.ts` | route-id derivation from pathname                                                  | navigation                                                        | tested via `navigation.test.ts`          |
| `RouteGate.tsx`                | permission + feature-flag gate for a route id; explains denials and flag-off state | every area page                                                   | mirrors API authority, never replaces it |
| `AreaPage.tsx`                 | "coming soon" statement per area with requirement IDs                              | roof, curb, leads, jobs, proposals, billing, reports, price-books | deliberately renders **no sample data**  |
| `common.tsx`                   | `PageHeader`, `ComingSoon`, shared layout pieces                                   | area pages                                                        |                                          |
| `icons.tsx`                    | icon set                                                                           | shell                                                             |                                          |
| `pwa/OfflineIndicator.tsx`     | connectivity state                                                                 | shell                                                             |                                          |
| `pwa/OutboxSync.tsx`           | replays the IndexedDB outbox                                                       | shell                                                             | idempotency keys preserved               |
| `pwa/ServiceWorkerManager.tsx` | registers/updates the service worker                                               | shell                                                             |                                          |

## 2. Feature views (`apps/web/src/features`)

| View                              | State                                                                      | Data source                     | Tests                                                          |
| --------------------------------- | -------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------- |
| `team/TeamView.tsx`               | working: member list, role change, deactivate, invites, delegations        | `/v1/team/*`                    | `TeamView.test.tsx` (4)                                        |
| `settings/SettingsView.tsx`       | working: org profile + versioned settings sections (`If-Match`)            | `/v1/orgs/current*`             | none                                                           |
| `settings/NotificationsView.tsx`  | working: category × channel preferences                                    | `/v1/notifications/preferences` | none                                                           |
| `auth/SignInView.tsx`             | working: provider buttons, Microsoft first, dev providers labelled         | `/v1/auth/providers`            | none (provider logic unit-tested in `endpoints`/`api.test.ts`) |
| `auth/AccessView.tsx`             | working: no-membership / no-workspace explanations                         | session                         | none                                                           |
| `auth/InviteView.tsx`             | working: token preview + accept                                            | `/v1/invitations/*`             | none                                                           |
| `auth/SelectWorkspaceView.tsx`    | working: workspace picker                                                  | `/v1/me`, active-org            | none                                                           |
| `onboarding/OnboardingWizard.tsx` | working: six steps, resumes from IndexedDB, writes api sections            | `/v1/orgs*`                     | none                                                           |
| `home/HomeDashboard.tsx`          | partial: widget shell, unavailable state because `/v1/dashboard` is a stub | stub                            | none                                                           |
| `search/SearchView.tsx`           | partial: same, `/v1/search` is a stub                                      | stub                            | none                                                           |

**There are no roofing or curb feature views in the running app.** The only ones that ever existed
are the legacy prototypes (`legacy/curb-connect-v1/src/measure/MeasurePanel.tsx`,
`src/invoices/InvoicesPanel.tsx`), which are not built or shipped.

## 3. Design system (`packages/ui`, 22 components + tokens; 25 files including 3 test files)

| Component                                                                                    | Purpose                                                |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `AppShell`                                                                                   | layout primitive                                       |
| `Button`, `TextInput`, `Checkbox`, `RadioGroup`, `Select`, `Field`                           | form controls with error/focus states                  |
| `MoneyInput`, `MeasurementInput`                                                             | unit-aware and money-aware inputs                      |
| `DataTable`                                                                                  | tabular display with empty state                       |
| `EmptyState`, `Skeleton`, `Toast`, `ConfirmDialog`, `Sheet`, `Stepper`, `Tabs`, `StatusPill` | feedback and layout                                    |
| `ProvenanceBadge`, `ConfidenceLabel`, `RiskNotice`, `EstimateLayer`                          | domain-specific trust/uncertainty display              |
| `VisuallyHidden`                                                                             | a11y helper                                            |
| `tokens.ts`, `styles.css`                                                                    | tokens with WCAG 2.2 AA contrast checks in both themes |
| `format/{length,money}.ts`                                                                   | display formatting                                     |
| `icons.tsx`                                                                                  | shared icons                                           |

Tests: `tokens.test.ts` (65 assertions incl. contrast), `components/inputs.test.tsx`,
`components/overlays.test.tsx`, `components/display.test.tsx`, `VisuallyHidden.test.tsx`.

Every new screen must reuse these components. The blueprint's "use existing design-system
components" rule is satisfiable: the set already covers money, measurement, provenance, confidence
and risk, which are the hard cases for roofing and curb UI.

## 4. Client libraries (`apps/web/src/lib`)

| Module                                       | Purpose                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `api.ts`                                     | typed fetch wrapper, zod parsing, problem+json errors, abort signals, credentials             |
| `endpoints.ts`                               | single place listing every API path the shell calls (+ proposed schemas not yet in contracts) |
| `session.tsx`                                | session/me context provider                                                                   |
| `routing.ts`                                 | path helpers from the route registry                                                          |
| `navigation.ts`                              | permission/flag-aware nav + bottom bar                                                        |
| `format.ts`, `decimal-text.ts`, `display.ts` | locale, units, decimal text handling                                                          |
| `offline/{store,drafts,outbox,online}.ts`    | IndexedDB drafts, operation queue with stable ids and idempotency keys                        |
| `pwa.ts`                                     | manifest/service-worker helpers                                                               |
| `analytics.ts`                               | route-view events from the registry                                                           |
| `preferences.ts`                             | local display preferences                                                                     |

## 5. Components the blueprint requires that do not exist

- Roof canvas / facet editor (RF-023, RR-032) — declared route `roof.report.editor`, no component.
- Satellite imagery viewer with licensed/visualization-only tile sources — MapLibre is a dependency
  but no map component exists in `apps/web`.
- Curb capture flow, calibration overlay, path tracer.
- Estimate/proposal/invoice builders, pipeline board, schedule calendar, supplier/inventory screens.
- Construction AI assistant panel.
- Document viewer/OCR panel.

These are additions. No existing component is to be replaced to make room for them.
