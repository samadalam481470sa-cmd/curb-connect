# House / development connectivity

Field Pro's building flow is one connected chain. A feasibility run becomes a community,
a house on a lot becomes a construction job, the house plan becomes an estimate record,
and the whole build (or one trade scope) can be handed to a contracting company. This
page describes the chain and its honest limits.

## The chain

1. **Feasibility → community.** In Land Feasibility, every saved project has a
   "Create community" action. It creates the community, phases, and lots in Land
   Management and stores the community on the feasibility project. Converting twice
   returns the existing community — nothing is duplicated.
   - If the project is loaded in the form, the current subdivision plan and phase split
     convert verbatim (client-computed, like the saved summary). Lot width/depth come
     from the drawn lot rectangles.
   - If it is not loaded, lots are numbered 1..N from the saved lot count, with no
     dimensions and no phases. The response says which happened.
   - More than 2,000 lots: only the community is created; add lots by hand.

2. **House → job ("Start build").** On a house in Land Management, "Start build"
   creates the construction job, links it to the house (and the house's sales contract,
   when the contract has no job yet), and seeds it:
   - Budget lines from the linked House Studio plan's estimate systems, or from a chosen
     estimate template, or none. Unpriced lines are skipped and counted, never filled in.
   - Schedule tasks from the template, counted from the start date you pick.
   - Starting a build twice returns the existing job.

3. **Plan → estimate record.** "Snapshot estimate from plan" (house detail) saves the
   House Studio takeoff/cost as a real estimate revision, computed server-side with the
   same math the studio shows. Each snapshot is a new revision of the one estimate for
   that plan. When a proposal is accepted and creates a job, the job's budget lines seed
   from the accepted options' estimate lines, and the estimates link back to the job.

4. **Assign the build.** "Assign build" on a house (or a phase) hands the whole build to
   a connected contracting company. The assignment carries a frozen snapshot: plan
   summary, budget total and where it came from, schedule window, community/phase/lot
   labels. The company must be an active Network connection. When they accept, a job for
   the build is created in their account (origin "assignment"), linked to the assignment
   so accepting twice never duplicates it. The contractor sees the assignment in Field
   Pro immediately; the email notice goes out only when email is connected — until then
   the screens say so.

5. **Bid award → assignment.** Accepting a bid offer can also create the work assignment
   to the winner (checkbox/flag on the decision). If the winner is not an active
   connection, the award still stands and the response explains why no assignment was
   created.

6. **House detail + per-trade assignment.** The house detail now shows draws,
   progress-billing applications, purchase orders, requisitions, assignments, and the
   linked estimate alongside plan/contract/job-cost/schedule/documents/warranty.
   Schedule tasks carry a cost code and can be assigned per task to a connected company
   from Project Management.

7. **Homeowner portal.** The job-status link resolves the sales contract through the
   land house when one exists, and shows the homeowner their community, lot, and plan
   summary. Token scoping is unchanged.

## Honest limits

- **The studio estimate is a planning model, not a bid.** It is the NAHB Cost of
  Constructing a Home 2024 survey (national average $/sq ft), escalated and scaled to
  the plan. Every snapshot is labeled budgetary and non-binding. A contractor's real
  numbers come from their own templates and job-cost budgets.
- **Snapshots freeze at assignment time.** If the plan, budget, or schedule changes
  after assigning, the assignment still shows what was true when it was sent. Re-assign
  to send fresh numbers.
- **Bid-award assignments are two steps.** The award commits first; the assignment is
  created right after. A failure there never undoes the award — the response carries a
  note instead.
- **Email is gated.** Assignment emails wait on the mailer being connected (Settings →
  Email). In-app notifications work now.
- **Feasibility conversion is client-computed.** Like the saved summary, the layout
  comes from the browser's run and is stored verbatim. The server never recomputes a
  lot layout.
- **The mirrored job starts empty.** Accepting a build assignment creates the job shell
  with the snapshot's budget total as its estimated value. The contractor seeds their
  own budget lines and schedule from their templates.
