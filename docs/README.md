# Documentation

| Document                           | Status                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| [architecture.md](architecture.md) | How the system fits together and why.                                                         |
| [adr/](adr/)                       | Architecture decision records 0001-0008 (context, decision, consequences, revisit triggers).  |
| `requirements/blueprint.yaml`      | Planned: the 100 blueprint epics as machine-readable requirements (IDs `STR-001`..`LCH-100`). |
| `traceability.md`                  | Planned: generated matrix from requirement IDs to code, tests and PRs.                        |
| `product/`                         | Planned: personas, journeys, permission matrix, help copy.                                    |
| `runbooks/`                        | Planned: operational procedures (incidents, restores, corrections).                           |

"Planned" entries are created by later build phases; until then the blueprint itself is the source
of truth for requirements.

New decisions: copy the structure of an existing ADR, take the next number, and link it from
`architecture.md` where relevant. Superseded ADRs are kept and marked as superseded.
