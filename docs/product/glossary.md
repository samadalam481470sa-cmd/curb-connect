# Glossary

Requirement: STR-010 (page 010). Version 1 (2026-10-26). Definitions restate the blueprint and the binding tech
lead brief. Where the blueprint names a term without defining it, the entry is marked "working definition —
confirm with domain lead".

| Term                         | Definition                                                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roof facet                   | One planar roof surface, stored separately with its own plan area and pitch (brief; RF-025).                                                                                           |
| Eave                         | Lower horizontal roof edge. Working definition — confirm with domain lead.                                                                                                             |
| Rake                         | Sloped edge at a gable end. Working definition — confirm with domain lead.                                                                                                             |
| Hip                          | External sloped intersection where two facets meet. Working definition — confirm with domain lead.                                                                                     |
| Valley                       | Internal intersection where two facets meet. Working definition — confirm with domain lead.                                                                                            |
| Pitch                        | Rise over run; stored as a ratio plus the original input, e.g. rise 6 per run 12 (brief).                                                                                              |
| Sloped area                  | plan_area \* sqrt(1 + (rise/run)^2) (brief, handoff).                                                                                                                                  |
| Roofing square               | 100 sq ft of roof surface (brief).                                                                                                                                                     |
| Waste factor                 | Allowance added to exact quantities; never applied twice (brief; RR-035).                                                                                                              |
| Exact quantity vs order pack | Exact takeoff quantities stay separate from rounded material order packs (brief).                                                                                                      |
| Curb cutting                 | Cutting or modifying concrete street/driveway curbs, not installing a rooftop HVAC curb (page 010 UX-A). Roof-mounted curb penetrations would be a separate service type (page 010 S). |
| Curb segment                 | One piecewise portion of a traced curb path (CV-047). Working definition — confirm with domain lead.                                                                                   |
| Saw kerf                     | Width of material removed by the saw blade. Working definition — confirm with domain lead.                                                                                             |
| Demolition volume            | Volume of concrete broken out and removed (CP-054). Working definition — confirm with domain lead.                                                                                     |
| Trusted dimension            | Measured on site or supplied by a verified survey; photo estimates alone are advisory (page 010 UX-B).                                                                                 |
| Unknown value                | Explicit `unknown` state, never a default 0 (page 010 data; brief).                                                                                                                    |
| Provenance source            | machine_estimated, imagery_derived, user_entered, field_verified, survey_supplied (brief).                                                                                             |
| Estimate                     | A configurable price calculation, not a binding engineering determination or contractor guarantee (page 001 rule).                                                                     |
| Quote confidence             | How much of a quote rests on verified inputs; always shown, never hidden (pages 003 S, 087). Working definition.                                                                       |
| Budgetary range              | Labeled low/base/high range shown while gating blockers exist; not a binding quote (brief; CP-058).                                                                                    |
| Direct cost (curb)           | mobilization + cutting + demolition + disposal + restoration + traffic + permits + other verified allowances (brief).                                                                  |
| Target margin                | selling_price = cost_basis / (1 - m); used instead of markup, never together (brief).                                                                                                  |
| Right-of-way (ROW)           | Public land along streets; ROW work is gated on permits and authority review (CP-056).                                                                                                 |

Acceptance (page 010 G): designers, engineers and estimators interpret ten shared sample records identically.
The ten sample records do not exist yet (STR-010-QA).
