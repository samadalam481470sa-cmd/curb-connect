# Finish-outs pipeline

Renovations, tenant improvements and interior build-outs as leads for flooring, cabinet,
countertop and fixture companies. The main permit search treats remodels as
not-new-construction and cuts them; the Finish-outs view surfaces exactly those permits.

## What shipped

- **Finish-out trade** (`finish_out`) in the permit engine: trade matching for
  finish-out / tenant-improvement / interior / remodel / flooring / cabinet / fixture
  permits, with its own materials list. The trade is selectable in Permit Job Search, and
  existing trades and search behavior are unchanged.
- **Renovation classification** (`classifyRenovation` in `finishOuts.ts`): finish-out,
  remodel, addition, repair, new construction, other. Additive — `classifyProject` and
  `isNewConstruction` are untouched.
- **Finish-outs endpoint** `POST /v1/permit-leads/finish-outs` (`job:read`): scans the same
  live Texas feeds as Pool Radar, returns ranked leads with stage, value band, finish-trade
  evidence and per-feed status. Filters: work type, stage, value band.
- **Finish-trade evidence**: `tradeEvidence` now covers `finish_out` — a separate
  finish-out/flooring/cabinet permit at the same normalized address. Finish trades rarely
  pull a permit of their own, so "not observed" is labeled an inference everywhere and never
  presented as proof the finish work is unawarded.
- **"Under city review" filter**: the existing permit-stage signal (`application` =
  application filed, not yet issued) surfaced as a stage filter on the finish-outs view.
- **Value bands**: under $25k, $25k–$100k, $100k–$500k, $500k–$1M, $1M–$10M, over $10M, and
  "Value not listed". Bands use only the value the city published.
- **Rendered pitch-deck PDF**: `POST /v1/permit-leads/pitch-deck-pdf` (`export:create`)
  renders the existing outreach pitch-deck outline as a draft slide sheet (one slide per
  page) via the new `pitch_deck` template in `@fieldline/pdf`. Drafts only; nothing is
  sent anywhere. The download button sits in the "One-page pitch" section of Permit Job
  Search.
- **Finish-outs view** in Permit Job Search (after Pool Radar): city/day controls, stage /
  value-band / work-type filters, a map colored by stage, and a leads table.

## Honest limits

- **Value is mostly blank.** Dallas and most Texas feeds publish almost no value or
  contractor fields on current permits (~0.1% fill in Dallas 2026 rows), so most leads land
  in "Value not listed" and totals sum only published values. Nothing is estimated or
  invented.
- **"Still need subcontractors" is an inference** — no contractor named on the permit, or
  no separate finish-out trade permit observed at the address. It is labeled that way in
  the API and the UI.
- **No dollar total from any video is used.** The reel that inspired this quoted a Dallas
  total; that number is the creator's claim and is never copied or implied. Every number
  here comes from the permits actually scanned in the window.
- **Email stays draft-only.** The pitch deck and outreach kit are drafts for a human to
  review and send; the mailer is not connected.
- **Houston** finish-outs are only identifiable when the weekly Excel file's comments say
  so; a bare "Building Pmt" row cannot be classified as a renovation.
- Completed permits are dropped from leads. Permit dates are not construction
  start-date predictions.

## Verification

Unit tests: `finishOuts.test.ts` (classification, bands, derivation, filters, evidence),
`signals.test.ts` (finish-trade evidence), `pitch-deck.test.tsx` (template renders one
draft slide per page with disclaimers). The finish-outs endpoint and the PDF download have
not been exercised against live feeds or in a real browser from the build environment —
first real hit happens after deploy.
