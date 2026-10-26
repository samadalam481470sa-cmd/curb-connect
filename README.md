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

## Accounts, shared jobs, and live updates (server)

`server/` is a Python API (FastAPI + SQLAlchemy). With it, each company has its own account, a contractor
invites a subcontractor to a job with a one-time link, and both sides see tasks, messages, files, payments,
and invoices. Open screens check for changes every 4 seconds, so updates from the other side appear without
refreshing. Without `VITE_API_URL` the app runs as the single-browser demo.

Run it locally (Python 3.12+):

```bash
cd server
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt   # macOS/Linux: .venv/bin/python
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

Then put `VITE_API_URL=http://localhost:8000` in `.env.local` and run `npm run dev`. API docs are at
`http://localhost:8000/docs`. Run the server tests with `.venv/Scripts/python -m pytest`.

What the server enforces:

- Passwords hashed with scrypt; signed, expiring access tokens; the same error for unknown email or wrong password
- Each company only sees its own jobs and the jobs it was invited to; other jobs return 404
- Only the contractor can change the contract, job details, or close a job as complete
- Payments can't exceed the open balance; invoices are numbered per company, drafts are private, and sent
  invoices are locked
- Uploaded files are size-limited, stored outside the web root, and anything other than PDFs, images, and
  plain text is served as a download

Deploying: `server/Dockerfile` builds the API image; set the variables in `server/.env.example`
(`SECRET_KEY` is required). Use PostgreSQL and a mounted volume (or object storage) for uploads in
production. Schema changes after launch should move to Alembic migrations.

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
