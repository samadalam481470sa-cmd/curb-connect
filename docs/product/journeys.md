# Customer journeys

Requirements: STR-006 (page 006), STR-007 (page 007), CV-050 (page 050), CP-059 (page 059), plus the gating
rules of pages 042, 045, 048, 049, 055, 056, 058, 067. Code source of truth for the state machines:
`packages/contracts/src/machines.ts` (transcribed 2026-10-26; code wins on disagreement).

## Roof journey (page 006)

Steps: address search -> building confirmation -> imagery acquisition -> roof sketch -> measurement validation
-> material takeoff -> proposal -> signature -> invoice -> payment. Two modes: contractor DIY sketch and assisted
measurement request; a delivery commitment is shown only when operationally supported (page 006 UX-A).

The blueprint rule lists the states draft, imagery_pending, measuring, review_required, approved, quoted, won,
invoiced, paid. The code adds `ordered`, `clarification_needed`, `failed`, `refunded`, `cancelled` (from
pages 021 and 039). Every transition is stored immutably with actor, timestamp, inputs, version and permitted
next states (page 006 data).

| From                 | Allowed next states                                            | Notes                                                                                            |
| -------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| draft                | ordered, cancelled                                             |                                                                                                  |
| ordered              | imagery_pending, measuring, failed, cancelled                  | DIY orders go straight to measuring                                                              |
| imagery_pending      | measuring, clarification_needed, failed, cancelled             | Poor/obscured imagery diverts to photo upload, blueprint import or manual follow-up (page 006 S) |
| measuring            | review_required, clarification_needed, failed, cancelled       |                                                                                                  |
| review_required      | approved, measuring, clarification_needed, failed              |                                                                                                  |
| clarification_needed | imagery_pending, measuring, review_required, failed, cancelled |                                                                                                  |
| approved             | quoted, review_required                                        |                                                                                                  |
| quoted               | won, approved, cancelled                                       |                                                                                                  |
| won                  | invoiced                                                       |                                                                                                  |
| invoiced             | paid                                                           |                                                                                                  |
| paid                 | (terminal)                                                     |                                                                                                  |
| failed               | measuring, refunded                                            | Credits released/refunded per visible policy (page 008 S)                                        |
| refunded             | (terminal)                                                     |                                                                                                  |
| cancelled            | (terminal)                                                     |                                                                                                  |

Reissue (page 006 UX-B, page 037): an issued report is edited and reissued as a new numbered revision; the
report-version machine moves the old version `issued -> superseded`, never erasing it.

Acceptance (page 006 G): an automated test takes a fictional property from address lookup to a settled mock
payment with complete history. Tracked as STR-006-QA.

## Curb journey (page 007)

Steps: project type selection -> guided photographs -> scale input -> curb trace -> dimensional review ->
price-range calculation -> permit gate -> approved quote -> work order. Project types asked (page 007 UX-A):
driveway curb opening, removal and replacement, sidewalk or ramp alteration, other concrete cut.

### Curb project states (code)

| From                 | Allowed next states                                   |
| -------------------- | ----------------------------------------------------- |
| intake               | capture, cancelled                                    |
| capture              | intake, calibration, measurement, cancelled           |
| calibration          | capture, measurement, cancelled                       |
| measurement          | capture, calibration, estimating, cancelled           |
| estimating           | measurement, review, cancelled                        |
| review               | capture, measurement, estimating, approved, cancelled |
| approved             | review, scheduled, cancelled                          |
| scheduled            | approved, completed, cancelled                        |
| completed, cancelled | (terminal)                                            |

### Curb estimate states (page 050 names them)

| From                 | Allowed next states                                                                  | Guard                                                                            |
| -------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| draft_ai             | calibration_required, review_required, field_check_required, pricing_ready, rejected |                                                                                  |
| calibration_required | review_required, field_check_required, rejected                                      | No accepted reference: only a broad planning band (page 007 S)                   |
| review_required      | calibration_required, field_check_required, pricing_ready, rejected                  |                                                                                  |
| field_check_required | review_required, pricing_ready, rejected                                             |                                                                                  |
| pricing_ready        | approved, review_required, field_check_required, calibration_required, rejected      | approved only with zero gating blockers (API-enforced)                           |
| approved             | review_required                                                                      | Withdrawn approval or material measurement change reverts to review (page 059 S) |
| rejected             | draft_ai                                                                             |                                                                                  |

### Curb human-review gate matrix (pages 007, 059 and linked pages)

Each row is a condition that blocks a firm quote. While any blocker is open the estimate can only be shown
as a labeled budgetary range or review-required status, never a binding automatic quote.

| Gate                           | Blocking condition                                                                 | Source       | Blocks firm quote                  | Blocks proposal signature | Blocks dispatch                       | Cleared by (named sign-off, page 059 UX-A) |
| ------------------------------ | ---------------------------------------------------------------------------------- | ------------ | ---------------------------------- | ------------------------- | ------------------------------------- | ------------------------------------------ |
| Critical width / length        | Not field-measured or calibrated within tolerance                                  | 007 R, 045 S | Yes                                | Yes                       | Yes                                   | field verifier / estimator                 |
| Depth / thickness              | Unknown or uncertain (never inferred from photos)                                  | 007 R, brief | Yes                                | Yes                       | Yes                                   | field verifier                             |
| Reinforcement                  | Unknown                                                                            | 007 R        | Yes                                | Yes                       | Yes                                   | field verifier                             |
| Property rights / right-of-way | Unresolved, or jurisdiction not resolved                                           | 007 R, 042 S | Yes                                | Yes                       | Yes                                   | permit reviewer                            |
| Permit requirement             | Unknown or not satisfied (approval hold + city-contact task)                       | 056 S/G      | Yes                                | Yes                       | Yes (expiry reverts readiness, 067 S) | permit reviewer                            |
| Utility conflict / drainage    | Material uncertainty, no locate evidence                                           | 049 S/G      | Yes (no unconditional fixed price) | Yes                       | Yes                                   | estimator + site/authority review          |
| Accessible route / slope       | Accessibility-sensitive scope without professional review fields                   | 048 B/G      | Yes                                | Yes                       | Yes                                   | qualified professional                     |
| Traffic / silica safety        | Safety plan or competent-person review missing                                     | 055 B/G      | -                                  | -                         | Yes                                   | project manager / competent person         |
| Uncertainty band               | Exceeds organization threshold                                                     | 058 S        | Yes (binding proposal)             | Yes                       | -                                     | site verification                          |
| Pricing completeness           | Unpriced critical component (pending review, never $0)                             | 052          | Yes                                | Yes                       | -                                     | estimator                                  |
| Approval policy                | Required approval (tenant/jurisdiction, separation of duties) missing or withdrawn | 059 R/S      | Yes                                | Yes                       | Yes                                   | per policy                                 |
| Contract / deposit / materials | Not signed / not received / not available                                          | 067 A        | -                                  | -                         | Yes                                   | crew_manager                               |

Acceptance (page 007 G, page 059 G): a pilot contractor generates a preliminary quote, then converts it to
approved after documented field checks; no unaudited preliminary estimate can be labeled a permitted final
fixed-price offer.
