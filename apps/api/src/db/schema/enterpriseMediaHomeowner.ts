import { boolean, integer, pgSchema, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');
const instant = (column: string) => timestamp(column, { withTimezone: true, mode: 'date' });
const scope = () => ({ orgId: uuid('org_id').notNull(), projectId: uuid('project_id').notNull() });
const receipt = () => ({
  ...scope(),
  id: uuid('id').primaryKey().defaultRandom(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  clientRequestId: uuid('client_request_id').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: instant('created_at').notNull().defaultNow(),
});

export const enterpriseMediaHomeownerRecipients = suite.table('media_homeowner_recipients', {
  ...receipt(),
  contactId: uuid('contact_id').notNull(),
  revision: integer('revision').notNull(),
  active: boolean('active').notNull(),
  reason: varchar('reason', { length: 500 }).notNull(),
});

export const enterpriseMediaHomeownerShares = suite.table('media_homeowner_shares', {
  ...receipt(),
  homeownerId: uuid('homeowner_id').notNull(),
  recipientGrantId: uuid('recipient_grant_id').notNull(),
  revision: integer('revision').notNull(),
  expiresAt: instant('expires_at').notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  tokenSealed: text('token_sealed').notNull(),
});

export const enterpriseMediaHomeownerShareItems = suite.table('media_homeowner_share_items', {
  ...scope(),
  shareId: uuid('share_id').notNull(),
  assetId: uuid('asset_id').notNull(),
  previewId: uuid('preview_id').notNull(),
  sortOrder: integer('sort_order').notNull(),
});

export const enterpriseMediaHomeownerShareRevocations = suite.table(
  'media_homeowner_share_revocations',
  {
    ...receipt(),
    shareId: uuid('share_id').notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
  },
);
