// Private drafts belong to one user within one active workspace.
// Access is scoped by both the current user and company in SQL RLS, never by caller parameters.
import { integer, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { tenantTable } from './_tenant';
import { users } from './auth';

export const userWorkspaceDrafts = tenantTable(
  'user_workspace_drafts',
  {
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    draftKey: text('draft_key').notNull(),
    value: jsonb('value').notNull(),
    revision: integer('revision').notNull().default(1),
  },
  (_t, h) => [h.uniq('orgId', 'userId', 'draftKey'), h.idx('orgId', 'userId')],
);
