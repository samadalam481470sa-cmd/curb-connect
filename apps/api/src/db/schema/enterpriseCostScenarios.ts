import type { EnterpriseCostScenarioResult } from '@fieldline/contracts';
import { jsonb, pgSchema, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import type { z } from 'zod';

const suite = pgSchema('enterprise_suite');
export const enterpriseCostScenarios = suite.table('cost_scenarios', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  forecastId: uuid('forecast_id').notNull(),
  scenarioName: varchar('name', { length: 140 }).notNull(),
  result: jsonb('result').$type<z.infer<typeof EnterpriseCostScenarioResult>>().notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
