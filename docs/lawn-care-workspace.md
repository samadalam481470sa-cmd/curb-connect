# Lawn Care / Grass Cutting workspace

**Route:** `/lawn`. This is an independent contractor workspace, available to
signed-in members with `estimate:read`. Find it in the sidebar / phone drawer,
Home launch tiles, and Home Quick Create. When working on a phone in the Lawn
Care section, the five-slot bottom bar shows a contextual Lawn Care shortcut
rather than adding a sixth bottom-tab icon.

## Estimating and area capture
A MapLibre interactive Esri World Imagery view lets a user search a property
address and tap grass polygon corners. The browser computes approximate polygon
area from WGS84 coordinates. These are user-traced *estimates*, not surveyed
boundaries, automatically detected grass, Google photorealistic 3D, or
guaranteed exact square footage. Users should subtract beds, patios, pools and
buildings and verify hidden/overgrown/tree-shaded grass on site.

Manual area entry is also supported.

## Service list and pricing
Editable **illustrative** rates for mowing, edging, weed trimming, blowing,
leaf cleanup, hedge trimming, mulch, fertilizer, core aeration, overseeding
and sod installation, with travel and an optional tax field. Quote math
includes minimum mowing charge, slope/access adjustment, per-visit cost,
weekly/every-two-weeks/monthly/one-time projections, crew-hour estimate,
and printable and CSV/copyable quotes. These are *not live supplier prices*,
actual booked appointments, state tax determinations, or signed contracts.

## Account-linked saving
The API whitelist for the existing `/v1/me/drafts/:key` endpoint now
accepts `lawn-workspace`. Quotes, property text, service selections,
rates and selected satellite polygon points are autosaved into the
authenticated user + active organization draft using the existing
revision checking and PostgreSQL row-level security policy. They are not
shared with all staff as published customer jobs. The current database
retention and backup requirements still apply.

The existing Jobs, Bidding, and Invoice pages are linked, but this initial
workspace does not create a CRM job, recurring calendar event, customer invoice,
payment, or public listing automatically. Avoid displaying such actions as
completed unless a backend implementation is later added.

## Test and deployment
`npm run lint`, `npm run typecheck`, `npm run test:unit`,
`npm run test:integration`, `npm run build`, and Playwright E2E.
Deploy the API before the frontend so `lawn-workspace` draft saves do not
fail with a schema validation error.

## Precision mapping improvements (November 2026)

The old single-region tracer is replaced with a multi-zone editor: lawn regions
(front/back/side), exclusions for hardscape/flowerbeds, visual region selection,
individual numbered corner markers that can be dragged, and explicit 0.5 ft,
1 ft, or 5 ft ground-distance corner nudges.

Polygon lengths are computed using short-distance great-circle formulas; the
area uses a local geographic projection for yard-scale approximate ground area.
The application rejects incomplete, duplicate, self-crossing, overlapping lawn
zones, overlapping exclusions, and exclusions lying outside a traced lawn.
Only valid measurements can be applied to the mowing quote, and a previously
applied map estimate is invalidated if its shape is subsequently corrupted or
deleted. The gross lawn area, excluded area, mowable net area and perimeter
are presented independently. A property can be divided into multiple
nonoverlapping zones without counting grass twice. Manual field-verified
measurements remain available and explicitly identify their source.

Existing single `polygon` cloud drafts migrate to one named lawn region in
the account without losing old measurements. New drafts store `regions` using
the same private user/org draft endpoint and revision checks.

**Accuracy limits:** Satellite tiles cannot reveal lawn under tree canopies.
Rooflines, shadow, image age, planimetric alignment, local relief, map
raster resolution and mobile touch placement all affect results. Extra
display zoom beyond source zoom 19 does not increase source imagery detail.
Nudging by 0.5 ft improves editing precision, not surveying accuracy.
No survey-grade or fixed percentage accuracy claim is made.
Check mowing boundaries, grades, tree cover, hardscape and access in the field.
