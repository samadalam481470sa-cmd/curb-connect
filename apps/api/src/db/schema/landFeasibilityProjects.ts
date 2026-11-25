// Tables owned by the `landFeasibility` module: saved feasibility projects. A project is a
// named snapshot of one feasibility run: the inputs the builder entered plus the
// client-computed summary (acres, lot count, profit). The summary is stored verbatim and
// labeled 'client-computed' in the API response — the server never recomputes it, because
// runFeasibility lives in the web app. Separate from Land Scout's saved buy boxes.
import { sql } from 'drizzle-orm';
import { jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { revisionColumn } from './_columns';
import { tenantTable } from './_tenant';

export const landFeasibilityProjects = tenantTable(
  'land_feasibility_projects',
  {
    name: text('name').notNull(),
    /** FeasibilityInputs snapshot (contracts LandFeasibilityInputsSchema), as entered. */
    inputs: jsonb('inputs').notNull().default(sql`'{}'::jsonb`),
    /** Client-computed summary (contracts LandFeasibilitySummarySchema): acres, lot count, profit. */
    summary: jsonb('summary').notNull().default(sql`'{}'::jsonb`),
    createdByUserId: uuid('created_by_user_id'),
    revision: revisionColumn(),
  },
  (t, h) => [h.idx('orgId', 'createdAt')],
);
