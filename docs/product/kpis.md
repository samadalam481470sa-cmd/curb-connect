# KPIs and event definitions

Requirement: STR-003 (page 003). Output named by the blueprint: product scorecard with owners, baselines, target
bands and event definitions. Baselines and target thresholds must be approved before pilot (page 003 G); none
are approved yet, so every baseline and target below is **TBD (owner)**.

Guardrail (page 003 S): do not optimize apparent AI confidence or engagement by hiding uncertainty or by treating
preliminary quotes as final. KPI dashboards derive only from auditable events (page 003 G).

## Events

Page 003 data: event collection must distinguish a draft, a verified measurement, a sent proposal, a signed
agreement and an actual paid invoice. Each event carries org_id, actor, resource id + version, product line
(roof | curb), timestamp (UTC) and correlation id, and is derived from the audit trail. Event names are proposed here (not blueprint text); the code registry
(packages/contracts route analytics names) is authoritative once it defines them.

| Event                        | Fires when                                                           | Must not fire when                   |
| ---------------------------- | -------------------------------------------------------------------- | ------------------------------------ |
| `estimate.draft_created`     | A roof order or curb project first gets a draft measurement/estimate | -                                    |
| `measurement.verified`       | A measurement is approved by a reviewer or field-verified            | Only machine-suggested or unreviewed |
| `proposal.sent`              | A proposal is actually sent to the customer                          | Saved or previewed only              |
| `agreement.signed`           | The customer signs (signature provider confirms)                     | Proposal viewed or option selected   |
| `invoice.paid`               | Payment settles (not provider pending authorization, OPS-068)        | Payment initiated or pending         |
| `measurement.corrected`      | A human overrides a machine or prior measured value                  | Initial manual entry                 |
| `estimate.reviewed_accuracy` | A reviewed estimate is compared with field-measured actuals          | -                                    |

## Launch metrics (page 003 rule)

| Metric                     | Definition                                                          | Owner                    | Baseline    | Target band |
| -------------------------- | ------------------------------------------------------------------- | ------------------------ | ----------- | ----------- |
| Time-to-first-draft        | Median time from order/project creation to `estimate.draft_created` | Product + Tech Lead      | TBD (owner) | TBD (owner) |
| Quote turnaround           | Median time from creation to `proposal.sent`                        | Product + Tech Lead      | TBD (owner) | TBD (owner) |
| Accepted-quote rate        | `agreement.signed` / `proposal.sent` per period                     | Business Platform Lead   | TBD (owner) | TBD (owner) |
| Correction frequency       | `measurement.corrected` per verified measurement                    | ML + Quality Lead        | TBD (owner) | TBD (owner) |
| Reviewed estimate accuracy | Error of reviewed estimate vs field-measured actuals                | Estimator + Pricing Lead | TBD (owner) | TBD (owner) |

Owners are the blueprint owner roles for the related chapters; the owner may reassign them.
