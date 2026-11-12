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
| Fort Worth, TX | https://www.fortworthtexas.gov/departments/development-services/permits/streets |
| Austin, TX | https://www.austintexas.gov/development-services/austin-build-connect-abc |
| Houston, TX | https://permits.houstontx.gov/ |
| San Antonio, TX | https://www.sa.gov/Directory/Departments/DSD/BuildSA |
| Plano, TX | https://www.plano.gov/city-services (links to eTRAKiT) |
| Arlington, TX | https://www.arlingtontx.gov/City-Services/Permits |
| Frisco, TX | https://www.friscotexas.gov/395/Building-Inspections |
| Irving, TX | https://www.irvingtx.gov/index.php?section=Online-Permit-Instructions |
| McKinney, TX | https://www.mckinneytexas.org/165/Permits (ROWAY: right-of-way permits) |

Some municipalities use separate workflows for curb cuts, driveway approaches, public right-of-way occupation, building work, and inspections. Verify the address's actual permitting authority before paying or starting work. City links can change, so review them periodically.

## Validation

- \`npm run test:unit -w @fieldline/web\` (or \`npm run test -w @fieldline/web\`) includes \`permitDirectory.test.ts\` for all verified URLs, city normalization, state disambiguation, unknown-city fallback, URI encoding, and missing input.
- \`npm run typecheck\`, \`npm run lint\`, and \`npm run build -w @fieldline/web\` protect compile and navigation.
- Manual smoke test on iPhone: Curb Cutting → scroll to Permit Center → select Carrollton, verify CityServe links; select Frisco, verify different application/status links; enter an unknown city and verify **Search required**; test reference save/reload/city-change clearing.
