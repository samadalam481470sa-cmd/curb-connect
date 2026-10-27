# @fieldline/ui

Fieldline's design system: design tokens as CSS variables and accessible React 19 components.
The visual design is original to Fieldline (deep field-teal primary, survey-amber accent, warm
greys) and does not imitate any other product.

## Usage

```tsx
// app root, once
import '@fieldline/ui/styles.css';
import { Field, MeasurementInput, MoneyInput, RiskNotice, StatusPill } from '@fieldline/ui';

<Field label="Curb length" hint="Measured along the gutter line" required>
  <MeasurementInput value={length} onChange={setLength} defaultUnit="ft" />
</Field>

<Field label="Permit allowance">
  <MoneyInput currency="USD" valueMinor={allowanceMinor} onChangeMinor={setAllowanceMinor} />
</Field>

<RiskNotice kind="utility">Utility locate not confirmed. Work cannot be scheduled.</RiskNotice>
<StatusPill machine="job" status="review_required" />
```

Theme: light by default, dark under `prefers-color-scheme: dark`. Force one with
`<html data-theme="light|dark">`. Token values live in `src/tokens.ts`; the token block of
`src/styles.css` is generated from it (`npm run tokens -w @fieldline/ui`) and a test fails if they
drift. Another test checks every declared text/background pair against WCAG 2.2 AA (4.5:1 text,
3:1 boundaries and focus ring) in both themes.

## Components

| Area       | Components                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Actions    | `Button`, `IconButton` (loading, disabled, permission-denied via `deniedReason`)                                                                                                                       |
| Forms      | `Field` (label, hint, error wiring), `TextInput`, `Select`, `Checkbox`, `RadioGroup`                                                                                                                   |
| Values     | `MoneyInput` (integer minor units in and out, currency aware, never floats), `MeasurementInput` (canonical metres in and out, ft/in/m toggle, explicit **Unknown** state that is never 0)              |
| Trust      | `StatusPill` (every state machine), `RiskNotice` (permit, utility, right-of-way, preliminary-quote; no dismiss control), `ProvenanceBadge`, `ConfidenceLabel` (AIQ-087 levels), `EstimateLayerSection` |
| Overlays   | `ConfirmDialog` (alertdialog, focus trap, Escape, focus return), `Sheet` / `Drawer`                                                                                                                    |
| Navigation | `Tabs` (arrow/Home/End keys), `Stepper`, `AppShell`, `TopBar`, `Sidebar`, `BottomNav`, `Breadcrumbs`, `WorkspaceSwitcher`                                                                              |
| Data       | `DataTable` (sortable `aria-sort` headers, card layout on phones, caption required), `EmptyState`, `ViewStateBoundary`, `Skeleton`                                                                     |
| Feedback   | `ToastProvider` / `useToast` (polite and assertive live regions), `LiveRegion`                                                                                                                         |

Data-bearing components take a `ViewState` (`ready`, `loading`, `empty`, `error` with
correlation id and retry, `permission_denied`), rendered consistently by `ViewStateBoundary`.

## Rules every screen follows

**Visual separation (PLT-012-B).** An estimate always keeps four layers visibly apart:

1. **Measured inputs**: what a person or survey measured (`EstimateLayerSection layer="measured"`, solid band).
2. **Suggested quantities**: what the software derived or a photo suggested (`layer="suggested"`, dashed band).
3. **Pricing assumptions**: price-book rates, overhead, contingency, margin (`layer="assumption"`, dotted band).
4. **Approved output**: what a person approved and the customer sees (`layer="approved"`, double band).

Each layer has its own section heading, colour band, border style and text marker, so the
difference never depends on colour alone. Never mix a suggested value into the measured section
and never show a suggested quantity as approved. Within a section, use `ProvenanceBadge` per value.

**Risk notices cannot be hidden.** `RiskNotice` sits on the `--fl-z-risk` layer above floating
controls (`--fl-z-floating`), has no close button, and the shell reserves room for the bottom nav
so it never covers a notice. Use `sticky` on long capture screens.

**Unknown is not zero.** Inputs emit `null` for "not answered" and `{ state: 'unknown' }` for
"known to be unknown"; neither is ever coerced to 0.

**Accessibility.** 44px minimum targets, 3px focus ring at 3:1 or better, labels on every control,
state spelled out in text (pills, steps, provenance), reduced-motion and forced-colors support.

## Scripts

`npm run typecheck|lint|test -w @fieldline/ui`; `npm run tokens -w @fieldline/ui` regenerates the
token CSS.
