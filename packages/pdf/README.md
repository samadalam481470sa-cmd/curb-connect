# @fieldline/pdf

`@react-pdf/renderer` templates that render from plain snapshot JSON (`src/snapshots.ts`). Field
names follow `@fieldline/contracts` (camelCase, `Money = { amountMinor, currency }`, SI units),
but the package imports neither the API nor contracts, so a worker can render without them.

| Snapshot `kind`         | Template                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roof_report`           | cover (report id, date, revision, address, imagery provenance and attribution, or the "Imagery not licensed for export — vector diagram shown" disclosure), whole-property totals, one page per structure (vector diagram from facet polygons with labels, pitch table, edge totals, waste applied once), exclusions, review notes, methodology, disclaimers, approval block. Estimated facets are dashed and marked `*`. |
| `curb_estimate`         | preliminary/budgetary banner whenever not binding (forced if any gate is open or anything is unknown), low/base/high, line items with provenance, cost build-up, unknowns, permit/utility/right-of-way gates, calibration evidence                                                                                                                                                                                        |
| `proposal`              | options with scope/exclusions/lines, selected package, add-ons, payment terms, tax, validity, terms, budgetary label                                                                                                                                                                                                                                                                                                      |
| `invoice`               | lines, discounts, taxes, payments, balance due, draft/void banners                                                                                                                                                                                                                                                                                                                                                        |
| `signature_certificate` | envelope id, document SHA-256, signers with consent and evidence, ordered event log                                                                                                                                                                                                                                                                                                                                       |

```ts
import { renderToBuffer } from '@fieldline/pdf';
const { buffer, sha256, contentChecksum, templateVersion, pageCount } =
  await renderToBuffer(snapshot);
```

**Determinism.** Fonts are embedded from `fonts/` (Open Sans, Apache License 2.0, license
included), hyphenation is disabled, every list is stably sorted, dates are printed in the
snapshot's time zone with a fixed format, and the PDF creation/modification dates come from
`meta.issuedAt`. Two renders of the same snapshot produce identical bytes (tested). `sha256` hashes
the bytes; `contentChecksum` hashes the canonical (key-sorted) snapshot plus template version.

`collectText(documentFor(snapshot))` returns the text a document prints, used in tests and for
reconciling printed totals with database totals (fonts are subset-embedded, so the raw PDF bytes
are not text-searchable). Example snapshots live in `@fieldline/pdf/fixtures`.
