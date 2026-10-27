# Permission matrix (roles x actions)

Requirement: STR-004 (page 004), PLT-015 (page 015), BE-078 (page 078).

**Source of truth is code:** `packages/contracts/src/rbac.ts` (`POLICY`). This page mirrors it for product
review and was transcribed from that file on 2026-10-26. If they disagree, the code wins and this page must
be updated (the RBAC file comment requires docs and matrix tests to change together). Permissions are
evaluated server-side on every request against tenant, resource, role and action (page 015 rule); the web
app uses the same matrix only to hide buttons and explain missing power (page 015 UX-A).

Additional gates beyond the role check (from the policy comments and blueprint):

- `estimate:approve` also requires zero gating blockers (CP-059, see journeys.md curb gate matrix).
- `dispatch:release` also requires readiness: permits, utility locates, safety plan, signed contract (OPS-067).
- `proposal:approve` is needed when a discount drops below the margin floor (OPS-065).
- Per-member overrides (grant/deny with expiry) exist; deny wins; an owner can never be denied team and
  ownership actions.
- Page 015 acceptance: estimating users cannot edit company payment settings (`billing_settings:update`) or
  view other tenants.

Y = allowed, - = denied.

| Action                               | owner | admin | estimator | reviewer | salesperson | crew_manager | finance | read_only |
| ------------------------------------ | :---: | :---: | :-------: | :------: | :---------: | :----------: | :-----: | :-------: |
| **organization and settings**        |       |       |           |          |             |              |         |           |
| `org:read`                           |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `org:update`                         |   Y   |   Y   |     -     |    -     |      -      |      -       |    -    |     -     |
| `org:settings_update`                |   Y   |   Y   |     -     |    -     |      -      |      -       |    -    |     -     |
| `org:transfer_ownership`             |   Y   |   -   |     -     |    -     |      -      |      -       |    -    |     -     |
| `org:close`                          |   Y   |   -   |     -     |    -     |      -      |      -       |    -    |     -     |
| `billing_settings:read`              |   Y   |   Y   |     -     |    -     |      -      |      -       |    Y    |     -     |
| `billing_settings:update`            |   Y   |   Y   |     -     |    -     |      -      |      -       |    Y    |     -     |
| `subscription:manage`                |   Y   |   Y   |     -     |    -     |      -      |      -       |    Y    |     -     |
| `usage:read`                         |   Y   |   Y   |     -     |    -     |      -      |      -       |    Y    |     -     |
| `integration:manage`                 |   Y   |   Y   |     -     |    -     |      -      |      -       |    -    |     -     |
| `flags:read`                         |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `flags:manage`                       |   Y   |   Y   |     -     |    -     |      -      |      -       |    -    |     -     |
| `audit:read`                         |   Y   |   Y   |     -     |    -     |      -      |      -       |    Y    |     -     |
| **team**                             |       |       |           |          |             |              |         |           |
| `team:read`                          |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `team:invite`                        |   Y   |   Y   |     -     |    -     |      -      |      -       |    -    |     -     |
| `team:update_role`                   |   Y   |   Y   |     -     |    -     |      -      |      -       |    -    |     -     |
| `team:revoke`                        |   Y   |   Y   |     -     |    -     |      -      |      -       |    -    |     -     |
| `team:manage_delegations`            |   Y   |   Y   |     -     |    -     |      -      |      -       |    -    |     -     |
| `role_bundles:manage`                |   Y   |   -   |     -     |    -     |      -      |      -       |    -    |     -     |
| **dashboard, search, analytics**     |       |       |           |          |             |              |         |           |
| `dashboard:read`                     |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `search:read`                        |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `analytics:read`                     |   Y   |   Y   |     Y     |    Y     |      Y      |      -       |    Y    |     Y     |
| **properties and imagery**           |       |       |           |          |             |              |         |           |
| `property:read`                      |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `property:write`                     |   Y   |   Y   |     Y     |    -     |      Y      |      -       |    -    |     -     |
| `imagery:read`                       |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `imagery:order`                      |   Y   |   Y   |     Y     |    -     |      -      |      -       |    -    |     -     |
| **roof**                             |       |       |           |          |             |              |         |           |
| `roof_order:read`                    |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `roof_order:create`                  |   Y   |   Y   |     Y     |    -     |      Y      |      -       |    -    |     -     |
| `roof_order:transition`              |   Y   |   Y   |     Y     |    Y     |      -      |      -       |    -    |     -     |
| `roof_order:cancel`                  |   Y   |   Y   |     Y     |    -     |      -      |      -       |    -    |     -     |
| `roof_report:read`                   |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `roof_report:edit_geometry`          |   Y   |   Y   |     Y     |    Y     |      -      |      -       |    -    |     -     |
| `roof_report:submit`                 |   Y   |   Y   |     Y     |    -     |      -      |      -       |    -    |     -     |
| `roof_report:approve`                |   Y   |   Y   |     -     |    Y     |      -      |      -       |    -    |     -     |
| `roof_report:issue`                  |   Y   |   Y   |     -     |    Y     |      -      |      -       |    -    |     -     |
| `measurement:override`               |   Y   |   Y   |     Y     |    Y     |      -      |      -       |    -    |     -     |
| `roof_takeoff:write`                 |   Y   |   Y   |     Y     |    -     |      -      |      -       |    -    |     -     |
| `export:create`                      |   Y   |   Y   |     Y     |    Y     |      Y      |      -       |    -    |     -     |
| **curb**                             |       |       |           |          |             |              |         |           |
| `curb_project:read`                  |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `curb_project:write`                 |   Y   |   Y   |     Y     |    -     |      Y      |      -       |    -    |     -     |
| `curb_media:upload`                  |   Y   |   Y   |     Y     |    -     |      Y      |      Y       |    -    |     -     |
| `curb_calibration:write`             |   Y   |   Y   |     Y     |    Y     |      -      |      -       |    -    |     -     |
| `curb_measurement:write`             |   Y   |   Y   |     Y     |    Y     |      -      |      -       |    -    |     -     |
| `curb_measurement:verify`            |   Y   |   Y   |     -     |    Y     |      -      |      Y       |    -    |     -     |
| `risk_flag:write`                    |   Y   |   Y   |     Y     |    Y     |      -      |      -       |    -    |     -     |
| `risk_flag:resolve`                  |   Y   |   Y   |     -     |    Y     |      -      |      -       |    -    |     -     |
| `permit:read`                        |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `permit:manage`                      |   Y   |   Y   |     Y     |    Y     |      -      |      -       |    -    |     -     |
| `safety_review:sign`                 |   Y   |   Y   |     -     |    Y     |      -      |      Y       |    -    |     -     |
| `jurisdiction:read`                  |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| **estimates, pricing, approvals**    |       |       |           |          |             |              |         |           |
| `estimate:read`                      |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `estimate:write`                     |   Y   |   Y   |     Y     |    -     |      -      |      -       |    -    |     -     |
| `estimate:approve`                   |   Y   |   Y   |     -     |    Y     |      -      |      -       |    -    |     -     |
| `estimate:view_cost`                 |   Y   |   Y   |     Y     |    Y     |      -      |      -       |    Y    |     -     |
| `price_book:read`                    |   Y   |   Y   |     Y     |    Y     |      -      |      -       |    Y    |     -     |
| `price_book:write`                   |   Y   |   Y   |     -     |    -     |      -      |      -       |    Y    |     -     |
| `price_book:approve`                 |   Y   |   Y   |     -     |    -     |      -      |      -       |    Y    |     -     |
| `approval:read`                      |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `approval:withdraw`                  |   Y   |   Y   |     -     |    Y     |      -      |      -       |    Y    |     -     |
| `review_task:read`                   |   Y   |   Y   |     Y     |    Y     |      -      |      -       |    -    |     -     |
| `review_task:claim`                  |   Y   |   Y   |     -     |    Y     |      -      |      -       |    -    |     -     |
| `review_task:decide`                 |   Y   |   Y   |     -     |    Y     |      -      |      -       |    -    |     -     |
| `review_task:assign`                 |   Y   |   Y   |     -     |    -     |      -      |      -       |    -    |     -     |
| **CRM and jobs**                     |       |       |           |          |             |              |         |           |
| `customer:read`                      |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `customer:write`                     |   Y   |   Y   |     Y     |    -     |      Y      |      -       |    -    |     -     |
| `customer:merge`                     |   Y   |   Y   |     -     |    -     |      Y      |      -       |    -    |     -     |
| `lead:read`                          |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `lead:write`                         |   Y   |   Y   |     Y     |    -     |      Y      |      -       |    -    |     -     |
| `lead:convert`                       |   Y   |   Y   |     Y     |    -     |      Y      |      -       |    -    |     -     |
| `job:read`                           |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `job:write`                          |   Y   |   Y   |     Y     |    -     |      Y      |      Y       |    -    |     -     |
| `job:move_stage`                     |   Y   |   Y   |     Y     |    -     |      Y      |      Y       |    -    |     -     |
| `pipeline:configure`                 |   Y   |   Y   |     -     |    -     |      -      |      -       |    -    |     -     |
| `task:write`                         |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     -     |
| `note:write`                         |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     -     |
| **proposals, signatures, contracts** |       |       |           |          |             |              |         |           |
| `proposal:read`                      |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `proposal:write`                     |   Y   |   Y   |     Y     |    -     |      Y      |      -       |    -    |     -     |
| `proposal:approve`                   |   Y   |   Y   |     -     |    -     |      -      |      -       |    Y    |     -     |
| `proposal:send`                      |   Y   |   Y   |     -     |    -     |      Y      |      -       |    -    |     -     |
| `proposal:void`                      |   Y   |   Y   |     -     |    -     |      Y      |      -       |    -    |     -     |
| `signature:send`                     |   Y   |   Y   |     -     |    -     |      Y      |      -       |    -    |     -     |
| `signature:void`                     |   Y   |   Y   |     -     |    -     |      -      |      -       |    -    |     -     |
| `contract:read`                      |   Y   |   Y   |     Y     |    -     |      Y      |      Y       |    Y    |     Y     |
| `portal_link:create`                 |   Y   |   Y   |     -     |    -     |      Y      |      -       |    Y    |     -     |
| `portal_link:revoke`                 |   Y   |   Y   |     -     |    -     |      Y      |      -       |    Y    |     -     |
| **billing**                          |       |       |           |          |             |              |         |           |
| `invoice:read`                       |   Y   |   Y   |     -     |    -     |      Y      |      -       |    Y    |     Y     |
| `invoice:write`                      |   Y   |   Y   |     -     |    -     |      -      |      -       |    Y    |     -     |
| `invoice:issue`                      |   Y   |   Y   |     -     |    -     |      -      |      -       |    Y    |     -     |
| `invoice:void`                       |   Y   |   Y   |     -     |    -     |      -      |      -       |    Y    |     -     |
| `payment:read`                       |   Y   |   Y   |     -     |    -     |      -      |      -       |    Y    |     -     |
| `payment:record`                     |   Y   |   Y   |     -     |    -     |      -      |      -       |    Y    |     -     |
| `payment:refund`                     |   Y   |   -   |     -     |    -     |      -      |      -       |    Y    |     -     |
| `change_order:read`                  |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `change_order:write`                 |   Y   |   Y   |     Y     |    -     |      Y      |      -       |    -    |     -     |
| `change_order:approve`               |   Y   |   Y   |     -     |    -     |      -      |      -       |    Y    |     -     |
| **field operations**                 |       |       |           |          |             |              |         |           |
| `supplier_order:read`                |   Y   |   Y   |     Y     |    -     |      -      |      Y       |    Y    |     -     |
| `supplier_order:write`               |   Y   |   Y   |     -     |    -     |      -      |      Y       |    -    |     -     |
| `supplier_order:submit`              |   Y   |   Y   |     -     |    -     |      -      |      Y       |    -    |     -     |
| `crew:read`                          |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `crew:manage`                        |   Y   |   Y   |     -     |    -     |      -      |      Y       |    -    |     -     |
| `schedule:read`                      |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `schedule:write`                     |   Y   |   Y   |     -     |    -     |      -      |      Y       |    -    |     -     |
| `dispatch:release`                   |   Y   |   Y   |     -     |    -     |      -      |      Y       |    -    |     -     |
| **personal**                         |       |       |           |          |             |              |         |           |
| `notification:read_own`              |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |
| `notification:update_preferences`    |   Y   |   Y   |     Y     |    Y     |      Y      |      Y       |    Y    |     Y     |

## Homeowner portal principal

Not a member and has no role. A portal token is scoped to one resource with a fixed action set
(`PORTAL_POLICY` in rbac.ts, OPS-070):

| Token scope    | Allowed portal actions             |
| -------------- | ---------------------------------- |
| proposal       | view, select_option, sign, message |
| invoice        | view, pay, message                 |
| report         | view                               |
| job            | view, message                      |
| upload_request | view, upload                       |
