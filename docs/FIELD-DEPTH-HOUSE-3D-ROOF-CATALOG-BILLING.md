# Curb Connect — depth evidence, house 3D, roofing catalog, invoice KPIs

## Curb depth evidence
The old 6–10 in estimate is not a verified measurement. Added core/probe entries
with station, measurement, method, date, notes, and full-cut coverage attestation.
Partial observations remain advisory and preserve the original low/base/high
quantity band. When site evidence covers both endpoints and the reviewer marks
full coverage, the derived low/base/high measured band replaces the initial estimate.
It remains an **observed** band, not subsurface mapping or design certification.
No AI or imagery can guarantee concrete depth in hidden ground.

## House Builder
The existing `/build` page already created 2D room layouts and BOM quantities.
Added a WebGL2 conceptual 3D viewer with rotation, elevation, zoom, roof toggle,
and .OBJ triangle mesh export from the same deterministic floor program. This
is **concept massing**, not an IFC file, stamped blueprint, structural truss
design, utility routing, engineering analysis or a generative AI architecture model.
Professional site survey, geotechnical review, plan coordination, and local permit
approval are required before construction. The provided beam equation is not
sufficient to size a truss; wind and snow must be resolved into code-defined load
combinations and truss forces and connections designed by a qualified engineer.

## Worldwide roofing system catalog
The selector now includes major global asphalt, slate, wood, composite, clay,
concrete, metal, membrane, solar and traditional roofing product families,
plus a custom entry. **Not an exhaustive list of every SKU in every country.**
Generic categories deliberately do not invent manufacturer-specific package
coverage, pricing, unit weights, fire ratings or wind-resistance claims.
Enter a verified packaging basis and current supplier quote before bidding.
Coverage and installation differ materially between tiles, sheets, membranes
and shingle bundles.

## Material prices
The existing materials scanner connects via `/api/material-prices` to SerpApi
Google Shopping if `SERPAPI_API_KEY` is set. Without credentials, the app shows
reference prices and a clear unavailable notice. Shopping listings are not
binding wholesale supplier quotes, are not guaranteed to match units, and
availability/taxes/freight depend on location. A once-daily on-open refresh
can update last seen listings, but cannot guarantee external supplier rates
change or that the website is running at midnight. Production scheduled
reconciliation requires an authorized provider feed with contract pricing,
timestamps, unit normalization and audit history.

## Master invoice dashboard
Home and Billing show totals from tenant-scoped issued invoices and received
partner bills by currency. Draft invoices are not work-to-be-invoiced.
Sent totals do not imply payment. The payable balance excludes void/paid bills;
receivables use recorded paid amounts. Missing API data is never treated as zero.
