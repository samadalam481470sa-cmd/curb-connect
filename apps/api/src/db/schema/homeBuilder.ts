// AI Home Builder projects and their immutable design versions. Every row is tenant-owned and
// protected by RLS (drizzle/0010_home_builder.sql). A version's design JSON is validated with
// @fieldline/building-schema before it is stored.
import { bigint, integer, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { tenantTable } from './_tenant';

export const homeProjects = tenantTable(
  'home_projects',
  {
    name: text('name').notNull(),
    brief: text('brief').notNull().default(''),
    targetAreaSqFt: integer('target_area_sqft').notNull(),
    budgetCents: bigint('budget_cents', { mode: 'number' }).notNull().default(0),
    createdByUserId: uuid('created_by_user_id'),
  },
  (_t, h) => [h.idx('orgId', 'createdAt')],
);

export const homeDesignVersions = tenantTable(
  'home_design_versions',
  {
    projectId: uuid('project_id').notNull(),
    versionNumber: integer('version_number').notNull(),
    design: jsonb('design').notNull(),
    assumptions: jsonb('assumptions').notNull().default([]),
    issues: jsonb('issues').notNull().default([]),
    createdByUserId: uuid('created_by_user_id'),
  },
  (_t, h) => [
    h.fk('projectId', () => homeProjects),
    h.uniq('orgId', 'projectId', 'versionNumber'),
  ],
);
