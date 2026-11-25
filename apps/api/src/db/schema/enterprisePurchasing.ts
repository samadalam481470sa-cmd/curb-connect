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

export const enterprisePurchaseCostCodes = suite.table('purchase_cost_codes', {
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  code: varchar('code', { length: 24 }).notNull(),
  label: varchar('label', { length: 160 }).notNull(),
});

export const enterprisePurchaseOrders = suite.table('purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  projectId: uuid('project_id').notNull(),
  bidPackageId: uuid('bid_package_id').notNull(),
  quoteId: uuid('quote_id').notNull(),
  awardRevision: integer('award_revision').notNull(),
  title: varchar('title', { length: 180 }).notNull(),
  scope: text('scope').notNull(),
  vendorName: varchar('vendor_name', { length: 180 }).notNull(),
  amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
  quoteValidThrough: date('quote_valid_through').notNull(),
  costCode: varchar('cost_code', { length: 24 }).notNull(),
  deliveryAddress: text('delivery_address').notNull(),
  requestedDeliveryOn: date('requested_delivery_on'),
  status: text('status').$type<'draft' | 'issued'>().notNull().default('draft'),
  revision: integer('revision').notNull().default(1),
  createdByUserId: uuid('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  issuedByUserId: uuid('issued_by_user_id'),
  issuedAt: timestamp('issued_at', { withTimezone: true }),
});
