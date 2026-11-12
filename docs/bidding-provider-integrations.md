# External bidding and native LiDAR measurement

## What is implemented

**Bidding > External bidding opportunities** uses published provider APIs for three separately
identified sources:

* **SAM.gov** U.S. federal solicitations, API v2, posted in the last 14 days.
  Server key `SAM_GOV_API_KEY` required. Filter by state and optional title.
  The API only returns a recent page, not an exhaustive census of all federal tenders.
* **UK Contracts Finder** official OCDS public notices (read-only).
* **UK Find a Tender** official OCDS release packages (read-only).

Results are not company-to-company Field Pro bids. No external data is cached as an
internal contract, no external bids are automatically submitted, and no result proves
a company is eligible to bid. Filters depend on the upstream API and source quality.
Always check original notice, amendments, deadline and instructions before responding.

References:
- https://open.gsa.gov/api/get-opportunities-public-api/
- https://www.gov.uk/government/publications/open-contracting
- https://www.find-tender.service.gov.uk/Developer/Documentation

## Connect company bidding products

**Settings > Bidding integrations & portals** includes external links and onboarding
information for BuildingConnected / Bid Board Pro, Procore, ConstructConnect, PlanHub,
BidNet Direct, Buildertrend and official Texas procurement sites. A saved shortcut does
**not** imply OAuth, an API token, sync or read access. Private company records require
the user's explicit provider authorization and the provider's API/license terms.

BuildingConnected's API uses **three-legged OAuth** and its Opportunities endpoints
require the appropriate Bid Board Pro entitlement. Procore also requires OAuth.
Do not scrape account pages, ask a user to paste passwords, or upload third-party
session cookies. Future automatic connectors need a supported integration contract,
encrypted per-tenant credentials, revocation and company permission checks.

**Bidding > Import bids from company platforms** lets authorized employees import
CSV or JSON exports from these products. Files must have recognizable project-title
columns, are capped at 900 KB and 100 records, and are stored with a source label
in the signed-in user's tenant-scoped cloud draft. Nothing is transmitted back to
the third-party service. Export formats differ; check the field mapping before use.

## Configuring official feeds

1. Obtain a SAM.gov account API key under your SAM.gov Account Details.
2. In the **Render API service only**, add `SAM_GOV_API_KEY` to environment secrets;
   keep it outside the repo, frontend and logs.
3. Deploy the API and frontend from the same tested main commit.
4. In Bidding, select source, optional title and state, and run the live search.
5. For an unavailable provider, show an error state; do not invent opportunity records.

Production requirements: provider rate limits, monitoring, API entitlement reviews,
and an explicit accuracy/coverage disclaimer. The UK feeds can be unavailable or
rate limited even though they have no API keys.

## iPhone native AR and LiDAR

Source: `native/ios/`. The separately installed SwiftUI app wraps the signed-in
website via `WKWebView`. It measures visible curb polyline points with ARKit.
LiDAR-capable iPhones request Apple scene depth; centre-reticle depth samples must
have enough valid medium-or-higher confidence pixels before conversion to world
coordinates. Otherwise ARKit surface raycasts are used. The user sees each source
count and can manually apply the length to the curb estimate.

This **does not** create a physical LiDAR scanner on a phone without a sensor.
Camera-only iPhones use Apple ARKit surface tracking; Safari and Home Screen PWAs
do not provide the native ARKit bridge. Other browsers use WebXR when available,
or the calibrated photo/manual measurement fallback. All lengths are provisional
and require a tape/field check before cutting. No buried utilities, depth, rebar,
or private line locations are inferred from surface scanning.

The workflow `Native iOS ARKit build` compiles the XcodeGen project on macOS without
signing. Release still requires Xcode, an Apple Developer signing identity, an
actual LiDAR iPhone for sensor accuracy validation, permission testing, and the
user's distribution decision. A green CI compilation is not a substitute for a
physical-device scan test.
