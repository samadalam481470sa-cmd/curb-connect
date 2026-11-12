# Curb Cutting Permit Center

**Implementation:** \`apps/web/src/features/curb/PermitCenter.tsx\`, \`permitDirectory.ts\`, and \`apps/web/src/app/permit-hub.css\`.

## User workflow

At the bottom of Curb Cutting, enter a job city and select any US state (or choose a Texas quick-select). The Permit Center resolves the normalized city/state pair against a curated directory:

- **Verified city resource:** Open the published city application portal and the city permit search/status portal in a new tab. When necessary, the link leads to the municipality's guidance page that points to the correct vendor platform.
- **Not in directory:** Show two clearly marked **search-result links** for municipal application and status information. Never fabricate a direct official link or assume the correct city/county/ETJ.
- Save the city's permit/application reference and optional, **manually entered** stage on the device. The app never claims this is an automatically retrieved permit status.
- Changing city/state clears the reference and stage, avoiding accidental cross-jurisdiction reuse.
- Utility and permit gates are unchanged. Permit lookup alone never authorizes cutting, excavation, or right-of-way work.

No municipal credentials, scraping, permit submission, or live municipal status APIs are used. External links are opened with \`noopener noreferrer\`.

## Verified city sources (checked November 2026)

| City | Published city resource |
| --- | --- |
| Carrollton, TX | https://www.cityofcarrollton.com/about-us/stay-connected/cityserve-permits-inspections |
| Dallas, TX | https://aca-prod.accela.com/dallastx/default.aspx (DallasNow municipal portal) |
| Fort Worth, TX | https://www.fortworthtexas.gov/departments/development-services/infrastructure-division (Parkway permits; Accela application/status portal) |
| Austin, TX | https://www.austintexas.gov/development-services/austin-build-connect-abc |
| Houston, TX | https://permits.houstontx.gov/ |
| San Antonio, TX | https://www.sa.gov/Directory/Departments/DSD/BuildSA |
| Plano, TX | https://www.plano.gov/city-services (links to eTRAKiT) |
| Arlington, TX | https://www.arlingtontx.gov/City-Services/Permits |
| Frisco, TX | https://www.friscotexas.gov/395/Building-Inspections |
| Irving, TX | https://irvingtx.gov/index.php?section=Online-Permit-Instructions (city instructions; MGO Connect application/status portal) |
| McKinney, TX | https://www.mckinneytexas.org/165/Permits (ROWAY: right-of-way permits) |

Some municipalities use separate workflows for curb cuts, driveway approaches, public right-of-way occupation, building work, and inspections. Verify the address's actual permitting authority before paying or starting work. City links can change, so review them periodically.

## Validation

- \`npm run test:unit -w @fieldline/web\` (or \`npm run test -w @fieldline/web\`) includes \`permitDirectory.test.ts\` for all verified URLs, city normalization, state disambiguation, unknown-city fallback, URI encoding, and missing input.
- \`npm run typecheck\`, \`npm run lint\`, and \`npm run build -w @fieldline/web\` protect compile and navigation.
- Manual smoke test on iPhone: Curb Cutting → scroll to Permit Center → select Carrollton, verify CityServe links; select Frisco, verify different application/status links; enter an unknown city and verify **Search required**; test reference save/reload/city-change clearing.

## Nationwide location directory

The Permit Center now supports all 50 U.S. states and Washington, D.C., with nationwide
autocomplete from a bundled snapshot of **33,034 city/place-to-county entries**. The snapshot
is organized into county lists by state in \`apps/web/public/permit-cities.json\`.
The upstream list is MIT-licensed (copyright © 2026 Gonzalo Franco); its complete
license is included at \`apps/web/public/permit-cities.LICENSE.txt\`, with attribution to
https://github.com/gfrancomontero/List-of-US-States-Counties-and-Cities-in-JSON-format.

The listing includes municipalities, unincorporated places, and Census-designated places.
It is a **geographic search aid**, not a directory of official permit-issuing authorities.
Entering a city is always permitted, even if the name is absent from the snapshot. A county
can be chosen when the exact place is listed; the county is added to targeted searches only
for unverified jurisdictions. It is not treated as proof of the property jurisdiction.

The website loads the asset lazily only when Curb Cutting is opened, and retains the manual
input if download fails. Permit numbers and manually tracked stages stay in this device's
local storage and reset when the location changes.

**Crucial accuracy boundary:** A verified municipal portal is shown only for curated cities.
For every other U.S. city/place, the app gives city/state/county-specific searches for the
official application and status website. Those searches are not verified portal links.
Live filing and permit-status integrations need jurisdiction-specific APIs/credentials
and cannot be claimed without them. Do not infer an issued permit or work authorization
from a draft, status note, or search result.

### Coverage checks

\`npm run test:unit -w @fieldline/web\` covers the bundled nationwide dataset,
state-specific city matching, cross-state duplicates, county disambiguation, unknown
municipality fallback, and safe URL encoding. The CI workflow additionally runs
lint, typecheck, application build, and browser journeys.
