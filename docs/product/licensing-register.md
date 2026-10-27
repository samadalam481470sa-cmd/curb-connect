# Imagery and IP licensing register

Requirements: STR-009 (page 009), RF-022 (page 022), RR-031. Status: open. Legal has not signed off; page 009 G
requires legal sign-off on asset rights, trademark separation, privacy terms and report attribution before
public launch.

Principles (pages 009, 022):

- Aerial imagery must be licensed specifically for measurement, machine analysis, retention, derivatives and
  customer report display; a standard web map never grants those rights.
- Rights are enforced in code (rights engine) independently at ingestion, inference, thumbnail cache and PDF
  embedding, not merely in footnotes.
- Without analysis rights, imagery is used only for approved visualization, and bulk pixel extraction or
  automated analysis is prevented (page 022 S).
- Tracked per asset: vendor, tile/asset id, permitted uses, capture date, expiry, attribution, geographic
  availability (page 009 rule).

| Provider (adapter)                            | Visualize                    | Analyze (CV / measurement)                         | Cache                          | Embed in exports/PDF      | Redistribute                            | Status / source                                                                                                                           |
| --------------------------------------------- | ---------------------------- | -------------------------------------------------- | ------------------------------ | ------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| fixture (synthetic, deterministic)            | Yes                          | Yes (synthetic only, labeled synthetic)            | Yes                            | Yes (labeled synthetic)   | Yes                                     | Internal test data; no third-party rights involved                                                                                        |
| google-map-tiles                              | Yes (needs key, attribution) | **No** (visualization-only for this product)       | Treat as No until legal review | **No** until legal review | No                                      | Blueprint cites https://developers.google.com/maps/documentation/tile/policies (pages 009, 022); not independently re-read                |
| esri-world-imagery (basemap)                  | Yes (attribution)            | **No** (visualization-only for this product)       | No until legal review          | No until legal review     | No                                      | Tech lead brief decision; vendor terms not reviewed here                                                                                  |
| contractor-upload (drone, photos, blueprints) | Yes                          | Yes, when the uploader asserts rights with consent | Per org retention setting      | Yes, with consent         | Limited disclosure only (page 009 UX-B) | Consent capture required; EXIF GPS kept restricted and stripped from shared copies                                                        |
| Analysis-licensed aerial provider             | -                            | -                                                  | -                              | -                         | -                                       | **TBD by owner** (owner-decisions.md D-03). Until chosen, roof measurement is manual/DIY on visualization imagery plus contractor uploads |

Original-brand checklist (page 009 output):

- [ ] Brand string lives in one constant (packages/contracts/src/brand.ts).
- [ ] No competitor code, brand, templates, copy or imagery in the repo.
- [ ] Report design is original (RR-036).
- [ ] Attribution text shown wherever provider terms require it.
- [ ] Legal review of the above: pending.
