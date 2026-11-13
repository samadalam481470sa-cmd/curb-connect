# Tree-occluded roof area: independent GIS footprint recovery

The Roof Measurements page now includes **Find roof under trees** after the contractor
uses **Fly to** on a street address.

This feature does **not** erase tree pixels, re-render an obscured Google Maps image, or
invent hidden roof geometry. The Esri satellite base layer is visual only. The server
queries a narrow area of publicly mapped OpenStreetMap **building ways** through
Overpass and returns candidate polygons near the geocoded address. The contractor
selects the correct structure, then can either:

1. **Show clean tree-free outline**: display the independent building footprint
   with satellite pixels hidden. The line remains visible over satellite imagery
   when switching back to Satellite/Hybrid. No hidden pixels are recreated.
2. **Auto-calculate roof plan size**: populate one estimated building footprint
   as a *single provisional roof plane*, with ground/plan area measured by planar
   geometry. Roof pitch starts **unknown**, preventing material totals from being
   treated as verified until the contractor enters pitch. Complex roofs require
   multiple traced facets and on-site checks.

Candidate choices include the mapped building's plan area, distance from the search
location, and a link to the original OSM way. An ambiguous match is *never silently
chosen as a verified roof*. User-selected footprints save in account-linked drafts
with an OSM source label; preexisting roof facets are not overwritten.

## Accuracy and source rules

- Mapped building perimeter is **not** roof eave perimeter. Areas can miss overhangs,
  dormers, additions, breezeways, multi-level planes, and unmapped alterations.
- Candidate contains-address is only spatial containment, **not address identity proof**.
- No mapped footprint or provider outage leads to an honest manual trace fallback,
  not a fake geometry or an unqualified high-confidence AI prediction.
- Approximate ground area uses a local tangent plane, square-metre to square-foot
  conversion, and a 35-metre maximum candidate distance. These are not survey-grade.
- OpenStreetMap data © OpenStreetMap contributors, **ODbL**:
  https://www.openstreetmap.org/copyright
- Upstream public Overpass is rate-limited, has no commercial SLA, and should be
  replaced with a licensed/self-hosted footprint index for sustained production traffic.
- Google Map Tiles/Esri base layers are never downloaded into the geometry analysis
  backend, cached as training data, segmented, repainted, or treated as an authoritative
  source of building footprints. Google Map Tiles are visualization only:
  https://developers.google.com/maps/documentation/tile/policies

## UI wiring and checks

The search button calls OpenStreetMap address search only after an explicit user
action. The tree-cover button sends the resolved lat/lon to the authenticated API
`POST /v1/imagery/roof-footprint`. Candidate selection zooms the map to the mapped
building; the clean-view button applies the outline to the cloud draft; the
auto-calculate button creates an editable, explicitly provisional facet; and
Discard clears the suggested geometry without altering saved records.

Unit tests cover polygon math, near/far candidate selection, malformed data,
server outages and the fixed upstream host. Map interaction tests assert the
address-to-lookup-to-outline-to-plan-area button flow, preexisting-facet protection,
and no-data fallback. API integration tests assert unauthenticated access is blocked.

A trained roof-segmentation model using *separately licensed aerial imagery* is
a possible future improvement, but is **not implemented** or implied by this feature.
Google Solar API is restricted to solar/energy-system purposes under its service
specific terms, so it must not be silently repurposed for general roofing takeoffs.
