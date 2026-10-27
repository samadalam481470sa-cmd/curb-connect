# Owner decisions

Source: owner handoff (2026-10-25) "Open business decisions (owner must decide; do not invent)" and "Owner
decisions made on Oct 26, 2026". Only the owner changes a status here. Build agents must not fill an open
decision with a guess; affected features stay manual, flagged off or review-required.

## Decided

| ID   | Decision                                                                                                                         | Date       | Effect                                                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| K-01 | Build inside the existing curb-connect GitHub repo as a monorepo; previous Vite app and Python API move to legacy/               | 2026-10-26 | Repo layout                                                            |
| K-02 | PostgreSQL 17 + PostGIS; local portable install for development; CI uses the postgis Docker image                                | 2026-10-26 | BE-074, BE-075                                                         |
| K-03 | Product name Field Pro, kept in one config constant                                                                              | 2026-10-26 | packages/contracts/src/brand.ts                                        |
| K-04 | Microsoft Entra OIDC + PKCE built for real; tested locally against a stand-in OIDC server until the owner registers an Entra app | 2026-10-26 | PLT-013, BE-078; Entra registration itself is still pending (see D-10) |

## Open

| ID   | Decision needed                                                                                   | Status | Blocks (epics)                         | Interim behavior                                                                      |
| ---- | ------------------------------------------------------------------------------------------------- | ------ | -------------------------------------- | ------------------------------------------------------------------------------------- |
| D-01 | Launch cities                                                                                     | open   | CV-042, CP-056, CP-057, LCH-*          | Jurisdiction unresolved: review required, approval hold, no permit eligibility claims |
| D-02 | Curb modification types offered                                                                   | open   | CV-041, CV-042                         | Taxonomy from the blueprint, all behind flags                                         |
| D-03 | Imagery provider and analysis rights                                                              | open   | RF-022, RF-026, RR-031, CV-046         | Visualization-only imagery plus contractor uploads; no machine analysis               |
| D-04 | DIY vs assisted roofing first (and confirmation of the MVP/V1/V2 assignment in release-matrix.md) | open   | Slice A, RR-033, RR-039                | Both modes modeled; delivery commitment not shown unless supported (page 006)         |
| D-05 | Jobs per day (expected volume)                                                                    | open   | LCH-096, AIQ-086, AIQ-089              | Capacity targets TBD                                                                  |
| D-06 | Regional price-book owner                                                                         | open   | CP-057, OPS-065                        | Contractor-managed per org (assumption A-05)                                          |
| D-07 | Payments and signature vendors                                                                    | open   | OPS-064, OPS-068, BE-079, BE-080       | Adapters only; no real charges or signatures                                          |
| D-08 | PWA vs native capture/AR                                                                          | open   | CV-043, CV-045, PLT-018                | PWA capture; AR depth not used                                                        |
| D-09 | How qualified professionals verify site conditions and permits                                    | open   | CV-048, CV-049, CP-055, CP-056, CP-059 | Named sign-off fields required; firm quote and dispatch blocked                       |
| D-10 | Register the Entra application (tenant, client id, redirect URIs)                                 | open   | PLT-013                                | Dev stand-in IdP only                                                                 |
| D-11 | Mail/notification provider                                                                        | open   | PLT-020, OPS-070                       | No outbound mail                                                                      |
| D-12 | Field-measured datasets for validation (pilot examples)                                           | open   | AIQ-082..085, hardening slice          | Vision abstains                                                                       |
| D-13 | Legal sign-off on imagery rights, trademark separation, privacy terms, report attribution         | open   | STR-009, LCH-092, public launch        | No public launch                                                                      |
| D-14 | KPI baselines and target bands                                                                    | open   | STR-003                                | Baselines TBD in kpis.md                                                              |

D-10 to D-14 are not in the handoff's open-decision list verbatim; they are owner-only items implied by the
handoff (Entra registration, mail provider in the adapter list, pilot field examples, legal usage rights) and
by pages 003 and 009.
