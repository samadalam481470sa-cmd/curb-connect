# Land Scout pipeline (ranked opportunities export + rail)

Built on Land Scout (commit 6c6600c, migration 0032). Adapts the ideas of the open-source
`land-acquisition-intel` Claude skill by Maksim Soltan
(github.com/Gonzih/land-acquisition-intel — "Claude Finds Development Land", shared by
@noi.cre on Instagram, reel DgHJLLFs0fu). No code was copied from that repo and there is
no Claude dependency: Field Pro keeps using the user's own Qwen model through the
existing AI hook, and its own Texas CAD parcel sources.

## What already existed vs what is new

| Skill idea | Already in Land Scout | New here |
| --- | --- | --- |
| Fetch real parcels from public ArcGIS | Collin CAD + Dallas CAD (2019 vintage), company CSV import | — reused |
| Highway proximity | TxDOT Roadways distance | — reused |
| Railroad proximity | Not mapped (the buy-box parser even noted "rail access not mapped") | **TxDOT Texas Railroads** distance, verified live 2026-11-24 (UP, BNSF, DGNO around Dallas). Active freight lines only; DART / Trinity Railway Express passenger light rail excluded. New `needsRail` buy-box field; rail scores inside the infrastructure factor for warehouse/industrial sites or when rail is asked for. |
| Substation proximity | HIFLD public mirror | — reused |
| Water infrastructure | Buy-box fields only (`needsWater` / `needsSewer`), no data | No new API. The pipeline export carries an honest Water/sewer column ("Not in CAD data — confirm with city/utility" when required) and the results panel says the same. |
| Score + rank parcels | Use 30 / size 25 / infrastructure 25 / price 20, unknown excluded + renormalized | Rail joins the infrastructure average (see above). Suitability label added: Strong fit ≥80, Good fit ≥60, Possible fit — verify ≥40, Weak fit below, "Not enough data to score" when nothing scored. |
| Ranked spreadsheet with Google Maps links | Due-diligence report only (one parcel, print/PDF) | **POST /v1/land-scout/pipeline-export**: runs the whole buy-box pipeline in one step and returns a CSV (base64, same pattern as the Plan-to-Bid draft package) with rank, score, suitability, county, parcel id, address, acres, appraisal use, CAD values, highway/rail/substation distances, owner + owner signals, water/sewer status, Google Maps link per parcel, vintage and source. Download button on the Land Scout results. |
| Owner / motivated-seller signals | `ownerIsEntity` + SOSDirect link in the report | **Owner signals on every ranked parcel**: out-of-state owner (read from the mailing-address state) and estate/trust (read from the owner name). Tax delinquency and hold length are not in CAD data, so they are never claimed. |
| Development suitability | Score + due-diligence report (FEMA flood, USGS terrain) | Suitability label above, built on the same score + report; no new black-box score. |

## Honesty rules (carried in code)

- Railroad distance comes from TxDOT geometry; when no line is within 10 mi the parcel
  shows "Unknown" and rail is not scored.
- Water/sewer availability is not in any CAD feed — it is never scored and the export
  says so.
- Owner signals use only fields the CAD already published.
- The CSV is a starting pipeline, not a recommendation: the download note and the docs
  both say to verify ownership, zoning and utilities before relying on it.
- Dallas parcels in the live layer are still appraisal-year 2019; each row shows its
  vintage, and a current DCAD export can be imported by CSV.

## Endpoints

- `POST /v1/land-scout/pipeline-export` (`land_scout:read`) — body is the same
  `LandSearchRequest` as a search (`buyBox`, `limit` 1–50, default 20). Response:
  `filename`, `contentBase64` (UTF-8 CSV with BOM), `rows`, `candidatesConsidered`,
  `sources`, `searchedAt`. The search and the export share one `runPipeline` helper, so
  they can never disagree about what the pipeline found.
- `POST /v1/land-scout/search` — unchanged shape; each ranked parcel now also carries
  `signals: string[]` and its parcel carries `railroadMiles` / `railroadName`.
- No migration. No new dependency (CSV is built with the existing `csvCell` helper).
