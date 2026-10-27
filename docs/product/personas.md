# Personas and jobs to be done

Requirement: STR-004 (page 004), PLT-015 (page 015). Status: planned; personas are product hypotheses until
validated with pilot contractors (see assumptions-register.md A-06).

Page 004 names eight user types. Each maps to one or more member roles (PLT-015) or, for homeowners, to the
portal principal, which is never an organization member (STR-004 rule: a homeowner never inherits contractor
permissions).

| Persona (page 004) | Typical role(s)                              | Top jobs to be done                                                                                                      | Hand-offs                                                                                        |
| ------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Field estimator    | estimator, crew_manager (field verification) | Create a curb photo estimate on site; capture guided photos with a measured reference; record field dimensions           | Hands the estimate to an authorized reviewer without losing annotations or notes (page 004 UX-A) |
| Office sales team  | salesperson                                  | Search an address, start roof or curb work, build and send multi-option proposals                                        | Receives approved quotes; hands won jobs to operations                                           |
| Roofing specialist | estimator                                    | Confirm structures, sketch/edit facets, enter pitch, check quantities, produce a customer-ready proposal (page 004 UX-B) | Submits report for review; sends quote via sales                                                 |
| Concrete cutter    | estimator, crew_manager                      | Define curb scope, verify dimensions, review gating flags before dispatch                                                | Receives dispatch only when gates are clear (CP-055, OPS-067)                                    |
| Reviewer           | reviewer                                     | Review measurements, resolve risk flags, approve estimates when gating has no blockers                                   | Approvals are cancelled or reassigned if the reviewer is removed mid-approval (PLT-015 S)        |
| Administrator      | admin                                        | Invite/deactivate members, configure pipelines, integrations, feature flags                                              | Delegates approvals with expiry (PLT-015 UX-B)                                                   |
| Business owner     | owner                                        | Own the organization, billing, price-book policy, ownership transfer                                                     | Approves margin exceptions with finance                                                          |
| Homeowner          | portal principal (scoped token)              | View report/proposal, choose an option, sign, pay, message, upload requested photos                                      | Never sees internal costs or margins                                                             |

Cross-cutting rules (page 004):

- Organization ownership, user access, billable usage, and customer access are separate concepts.
- A user in several contractor organizations must select a workspace explicitly; records are never merged.
- Acceptance (page 004 G): scenario tests show each persona completes its top three workflows with no
  cross-tenant disclosure. Not yet written; tracked as STR-004-QA.
