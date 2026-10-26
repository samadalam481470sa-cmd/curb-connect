# Curb Connect

Curb Connect is a contractor/subcontractor project tracker for curb and site concrete work. It helps a contractor communicate scopes that have not started, are started, are finished, or are paid complete while keeping payment records and job notes together.

## Features

- Project board grouped by status: Not started, Started, Finished, Complete
- Scope options for standard curbs, cut curbs, washouts, retaining walls, sidewalk tie-ins, ADA ramps, demo/haul-off, and other work
- Contractor and subcontractor role switcher with different dashboards for each side
- Rolling horizontal job strip that works well on phones and keeps jobs from feeling cramped
- Project creation form with dates, priority, location, site contact, crew size, quantity/footage, invoice number, contract amount, and notes
- Owner-specific task checklist so contractors and subcontractors can track their own things to do
- Document upload area for plans, invoices, photos, lien waivers, receipts, and closeout paperwork
- Open and download links for each uploaded job document
- Payment logging with paid totals, open balance, and automatic paid-complete closeout when a finished job is fully paid
- Search and filters by scope, status, contact, invoice, and job details
- Browser local storage persistence with demo data reset; uploaded files are kept in IndexedDB
- Measure & estimate map tools:
  - Address search, then trace curb runs (lines) and flatwork or roof facets (areas) on the map
  - Corner snapping and a magnifier loupe for precise point placement
  - Live length, perimeter, and area in ft, ft-in, in, yd, m, sq ft, sq yd, m², acres, and sq mi
  - Curb and concrete take-off: cubic yards by curb profile or slab thickness, ready-mix order rounding, saw-cut, labor, and a priced estimate
  - Roofing take-off: per-facet pitch multipliers, squares with waste, shingle and ridge cap bundles, underlayment, starter, and drip edge
  - One click turns an estimate into a new job with the quantity and contract amount filled in

- Invoices:
  - Create an invoice from any job, prefilled with its open balance; add line items, sales tax, and retainage
  - Automatic numbering (INV-1001, INV-1002, …), issue and due dates, Draft → Sent → Paid or Void
  - Overdue detection, plus outstanding, overdue, and paid totals
  - Print or save as PDF with your company details and payment instructions
  - Marking an invoice paid logs the pre-tax amount on the job, so balances and paid-complete closeout stay correct

## Map configuration

The map opens in satellite view (Esri World Imagery with road and place labels) and searches any address
worldwide with type-ahead suggestions (Esri World Geocoding Service). Street view is in the layer switcher.
No key is needed to try it. For production, set keys in `.env.local` (see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `VITE_GOOGLE_MAPS_API_KEY` | Uses Google satellite imagery (Map Tiles API) and Google geocoding instead of Esri. |
| `VITE_ARCGIS_API_KEY` | ArcGIS Location Platform key for commercial use of the default Esri imagery and geocoding. |

Esri and Google each require their attribution to stay visible on the map; the app shows it automatically.

Measurements traced on imagery are estimates. Verify critical dimensions on site before ordering material.

## Getting started

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Run checks:

```bash
npm run lint
npm test
```

## Notes

This first version is a front-end MVP that stores records in the browser. A production multi-user version should add authentication, a shared database, file uploads for invoices/photos, and role-based permissions for contractors and subcontractors.
