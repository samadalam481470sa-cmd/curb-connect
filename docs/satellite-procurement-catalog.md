# Home satellite site view and expanded House Builder procurement list

## Home satellite view
The Home Operations Twin now renders actual Esri World Imagery satellite tiles using the
same MapLibre provider already present in Roofing. Users can enter a street address,
pan, zoom, toggle place labels, and open the location in external Google Maps satellite
or Google Earth (which may offer 3D for the area). Imagery shows trees and rooftops
where the provider has available coverage. Correct attribution remains visible. The
Dallas starting position is an example, **not** the logged-in user's location.

Google Maps photorealistic 3D tiles are NOT scraped, copied or embedded. Native
Google 3D rendering requires the Map Tiles API, a restricted API key, billing, a
compatible renderer, and provider-required attributions. The external Earth link does
not mean Google 3D meshes have been integrated into Field Pro.

## Material takeoff
The original 19 core material types are retained. An additional 246 distinct supply
types provide a procurement planning checklist from site preparation to finish work:
concrete formwork, anchoring, blocking, header connectors, roofing nails, ridge caps,
gutters, flashing, electrical panels/wire and boxes, plumbing PEX/DWV/fixtures,
HVAC ducting and controls, cabinets, floor finishes, construction adhesive, individual
hardware fastener/nail boxes, and landscaping/exterior allowances.

Every additional material includes a readable formula based on schematic floor area,
perimeter, wall area, roof area, number of doors/rooms/bathrooms, or similar derived
quantities. These are **provisional allowances**, not exact takeoffs from engineered
construction documents. Site conditions, jurisdiction/code, truss and framing design,
MEP layouts, actual fixture schedule, manufacturer and packaging details vary.
Do not interpret this catalog as literally every possible product for all houses or
as a complete construction purchase order.

## Pricing and daily freshness
Existing dated retailer references remain for core materials. Added product types have
no fabricated prices: they are left **unpriced** until a user enters a matching
supplier quote or selects a verified matching unit from the provider's live offers.
The total is explicitly an **incomplete estimate subtotal** when some lines are unpriced.
The UI supports searching all materials and expanding a material to see offers, evidence
and retail supplier links.

The existing live supplier integration requires `SERPAPI_API_KEY` on the web server.
The base-material list is checked once per day **when House Builder is opened**, provided
a supplier key works. A 246-item catalog-wide refresh is opt-in via *Scan entire catalog*
because the paid upstream feed is billed by lookup and matching offer pack sizes/units
must be verified before applying a quote. The scan displays progress and stops on a
provider failure; opening a browser tab does not guarantee 24/7 daily scheduled
refreshes. Genuine unattended daily refreshing for every product needs a durable
backend price history, licensed supplier feeds and a scheduled worker with quota and
cost controls. Do not claim it is active before those are configured.

## Release validation
Run lint, typecheck, unit and integration tests, production build and Playwright E2E.
Open Home on mobile, search a property address, confirm real tile imagery and
attributions. Open House Builder and search *roofing nail*, *PEX*, and *HVAC*,
verify quoted lines are priced and unpriced lines are omitted from the total.
