import {
  bigint,
  date,
  integer,
  pgSchema,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');

export const enterpriseBidPackages = suite.table('bid_packages', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  title: varchar('title', { length: 180 }).notNull(),
  scope: text('scope').notNull(),
  dueOn: date('due_on').notNull(),
  status: text('status')
    .$type<'collecting' | 'awarded' | 'closed'>()
    .notNull()
    .default('collecting'),
  awardedQuoteId: uuid('awarded_quote_id'),
  decisionNote: text('decision_note'),
  revision: integer('revision').notNull().default(1),
  clientRequestId: uuid('client_request_id').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const enterpriseBidQuotes = suite.table('bid_quotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  packageId: uuid('package_id').notNull(),
  vendorName: varchar('vendor_name', { length: 180 }).notNull(),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  leadDays: integer('lead_days').notNull(),
  validThrough: date('valid_through').notNull(),
  qualifications: text('qualifications').notNull().default(''),
  clientRequestId: uuid('client_request_id').notNull(),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
