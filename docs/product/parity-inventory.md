# Functional parity inventory

Requirement: STR-002 (page 002). Purpose: a factual checklist of capability categories that the blueprint says
are publicly described, so a reviewer can compare the build without opening a competitor account (page 002 G).

Rules applied (page 002):

- Only capability **categories** named in the blueprint are listed. No competitor implementation details,
  screens, copy, templates, brand assets or report artwork are recorded or copied.
- Nothing here was independently observed by the build team. Per page 002 S, anything public material does not
  prove is "unknown"; every row is therefore marked unverified.
- Each capability is an independent feature flag with target parity MVP/V1/V2 (page 002 rule).

Observed date: 2026-10-25 (blueprint date). Verification status for every row:
**unverified — from blueprint, not independently observed**.

Sources cited by the blueprint (not visited by the build team):

- S1: https://roofr.com/measurement-reports (page 002)
- S2: https://roofr.com/crm (page 002)
- S3: https://roofr.com/proposals (page 063)

| #   | Capability category (blueprint wording) | Source | Fieldline original behavior (epic) | Target                                       | Dependency                   | Verification status                                     |
| --- | --------------------------------------- | ------ | ---------------------------------- | -------------------------------------------- | ---------------------------- | ------------------------------------------------------- |
| 1   | Address-based roof orders               | S1     | RF-021                             | MVP                                          | imagery_license              | unverified — from blueprint, not independently observed |
| 2   | Imagery-assisted measuring              | S1     | RF-022, RR-031, RR-033             | MVP (assisted review); V2 automatic (RF-026) | imagery_license              | unverified — from blueprint, not independently observed |
| 3   | Editable sketches                       | S1     | RF-023, RR-032, RR-037             | MVP                                          | -                            | unverified — from blueprint, not independently observed |
| 4   | Pitches                                 | S1     | RF-027                             | MVP                                          | -                            | unverified — from blueprint, not independently observed |
| 5   | Roof edges                              | S1     | RF-028                             | MVP                                          | -                            | unverified — from blueprint, not independently observed |
| 6   | Waste factors                           | S1     | RR-035                             | MVP                                          | -                            | unverified — from blueprint, not independently observed |
| 7   | Material lists                          | S1     | RR-034                             | MVP                                          | -                            | unverified — from blueprint, not independently observed |
| 8   | Branded reports                         | S1     | RR-036 (original design)           | MVP                                          | legal_signoff                | unverified — from blueprint, not independently observed |
| 9   | Quote conversion                        | S1     | RR-040                             | MVP                                          | -                            | unverified — from blueprint, not independently observed |
| 10  | Configurable job pipelines              | S2     | OPS-062                            | V1                                           | -                            | unverified — from blueprint, not independently observed |
| 11  | Customer records                        | S2     | OPS-061                            | MVP                                          | -                            | unverified — from blueprint, not independently observed |
| 12  | Signable proposals                      | S2, S3 | OPS-063, OPS-064                   | V1                                           | signature_vendor             | unverified — from blueprint, not independently observed |
| 13  | Invoicing                               | S2     | OPS-068                            | V1                                           | -                            | unverified — from blueprint, not independently observed |
| 14  | Payment capture                         | S2     | OPS-068                            | V1                                           | payment_vendor               | unverified — from blueprint, not independently observed |
| 15  | Supplier workflows                      | S2     | OPS-066                            | V2                                           | supplier integration (owner) | unverified — from blueprint, not independently observed |
| 16  | Mobile accessibility                    | S2     | PLT-018, PLT-019 (PWA)             | MVP                                          | -                            | unverified — from blueprint, not independently observed |

Which source page describes which category is taken from the blueprint grouping (page 002 UX-A lists the
report-side categories next to S1, UX-B the CRM-side categories next to S2); it is not verified.

The curb-cutting product has no parity target in the blueprint; it is an original product.

Sign-off (page 002 output: "signed competitive inventory"): not signed. Owner: Product + Tech Lead.
