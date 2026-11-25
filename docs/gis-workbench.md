# GIS Workbench

The QGIS-desktop equivalent built for the web (2026-11-25). QGIS's desktop program (Qt/C++)
cannot run in this browser app and its source is GPL, so nothing was copied: every desktop
capability was rebuilt as a web equivalent on Field Pro's own stack (MapLibre GL, three.js,
`@fieldline/geometry`, `@fieldline/pdf`). The measurement engine underneath (facet
validation/repair, geodesic area via GeographicLib, CRS/reprojection via proj4js, GeoJSON
import, turf-based geometry operations) shipped earlier as commit 42b89e3; this build adds the
desktop workspace on top of it.

Screen: `/gis-workbench` (primary nav, "GIS Workbench", permission `estimate:read` — every
role, like the other map tools).

## What was built

### 1. GIS workbench (map workspace)

- MapLibre map over Esri World Imagery (same stack as the roof tracer), address fly-to
  (Nominatim), coordinate readout, imperial scale control.
- **Layer panel** — five toggleable layers, each with color + opacity controls and a plain
  status line from its source:
  - **Parcels (CAD)** — `POST /v1/gis/layers/parcels`: Collin CCAD + Dallas DCAD parcel
    services queried by the current view with outlines (the Land Scout services, this time
    returning geometry). Published fields only; Dallas rows carry their appraisal-year vintage.
  - **Permit leads** — the existing `POST /v1/permit-leads/search` (trade + city inputs).
    Only permits the feed published coordinates for are plotted; the rest are counted in the
    layer status, never geocoded by guessing.
  - **Streams (NHD)** — `POST /v1/gis/layers/streams`: USGS NHD flowlines for the view.
  - **Hail swath** — the existing `GET /v1/roof-storms/swath` (NOAA MRMS MESH swath or SPC
    approximate path; the kind and note are shown verbatim).
  - **Traced roofs** — `POST /v1/gis/layers/roofs`: the company's saved roof measurements
    whose property pins fall in the view, facets converted with the existing `traceView()`.
    Measurements whose stored geometry can't be read are counted (`unreadable`), never placed.
- **Attribute table** for the active layer: sortable columns, text filter, row click flies to
  and outlines the feature. Missing values render as "—" and sort last — never zero-filled.
- **Click-to-identify**: clicking a feature shows its attributes (active layer wins overlaps).
- **Measure tools**: click points for geodesic distance / area on the WGS84 ellipsoid
  (GeographicLib via `@fieldline/geometry` — the same library QGIS uses for QgsDistanceArea;
  `geodesicDistance` added alongside the existing area/perimeter).
- View-scale honesty: layer queries cap at 500 features (`truncated` said out loud) and a view
  wider than ~0.6° is refused with the reason instead of being silently capped.

### 2. Print layout composer

- Page size (Letter/Legal/Tabloid) + orientation, title block, map frame = the captured
  current view (the canvas keeps its drawing buffer for exactly this), legend from visible
  layers, scale bar (nice distance at the map centre, labelled approximate), north arrow
  rotated by the map bearing, layer summary table, and every source note.
- `POST /v1/gis/print` (permission `export:create`, 10/min, 8 MB body) renders the new
  `map_plan_sheet` template in `@fieldline/pdf` and returns base64 like the bid package. The
  sheet says **DRAFT PLAN SHEET — not a survey** on its face and in the footer. Roles without
  `export:create` see the denial reason in the panel instead of a dead button.

### 3. 3D terrain view

- three.js terrain mesh from the existing `POST /v1/site/terrain` (USGS 3DEP, 7×7 samples over
  5,000 × 5,000 ft around the map centre, bilinear-smoothed, hypsometric tint, vertical
  exaggeration slider) with the company's traced roof outlines extruded as buildings standing
  on it. Labelled with the source + "not a survey"; the 15 ft building height is stated as
  visualization only, never a measured height. FEMA flood zone at centre shown when the
  service returns one.
- Deliberately NOT MapLibre raster-dem terrain: there is no USGS 3DEP DEM tile source in an
  elevation encoding the map could drape (USGS tiles are rendered hillshade), so the existing
  EPQS point service is the honest source.

### 4. Extensions panel

- Built-in geometry tools over the loaded layers, wrapping `@fieldline/geometry`'s operations
  (turf-based union / intersect / difference / buffer — the operations QGIS exposes from GEOS,
  rebuilt in TypeScript): **Merge (union)**, **Buffer** (feet), **Overlap (intersect)**,
  **Subtract (difference)**.
- The contractor picks the tool + layer(s), confirms, and gets an honest result line
  ("The two layers do not overlap in this view.") plus a display-only overlay with per-result
  area. Nothing writes back to source data. No arbitrary code execution, no third-party
  plugin loading — the panel is the app's plugin surface, first-party only.

## Endpoints added

| Endpoint | Permission | Notes |
| --- | --- | --- |
| `POST /v1/gis/layers/parcels` | `estimate:read` | 30/min; bbox body; caps + statuses honest |
| `POST /v1/gis/layers/streams` | `estimate:read` | 30/min; NHD layer 6 |
| `POST /v1/gis/layers/roofs` | `roof_order:read` | 30/min; tenant-scoped; `unreadable` counted |
| `POST /v1/gis/print` | `export:create` | 10/min; 8 MB; returns the DRAFT plan sheet PDF |

No migration: no database changes (the roofs layer reads existing tables).

## Honest limits

- Parcels exist only where Collin/Dallas CAD publish services (the same coverage as Land
  Scout); elsewhere the layer says nothing was found in the view — it is not a "no parcels"
  verdict for other counties.
- Permit coordinates come only from feeds that publish them (most Texas feeds don't); the
  plotted subset is labelled with the unplotted count.
- Terrain is a 7×7 smoothed grid, not a DEM; building heights are illustrative.
- The plan sheet's scale is exact only at the map centre (web-mercator distortion), and the
  sheet says so.
- Visual verification in a real browser (map rendering, print capture, 3D) still needs a
  signed-in pass after deploy — code, typecheck and unit tests are green, but no screenshot
  pass was possible from the build environment.
