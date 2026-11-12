// Persistence for opt-in contractor opportunities and offers. Offers remain in the posting
// company's tenancy. Cross-company participation is handled only by the named API operations.
import { date, integer, text, uuid } from 'drizzle-orm/pg-core';
import { currencyColumn, minorUnits, revisionColumn } from './_columns';
import { tenantTable } from './_tenant';

export const bidOpportunities = tenantTable('bid_opportunities', {
  authorUserId: uuid('author_user_id').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  trade: text('trade').notNull(),
  city: text('city').notNull(),
  region: text('region').notNull(),
  currency: currencyColumn(),
  budgetMinor: minorUnits('budget_minor'),
  dueOn: date('due_on'),
  visibility: text('visibility').notNull().default('connections'),
  status: text('status').notNull().default('open'),
  revision: revisionColumn(),
}, (_t,h) => [h.idx('trade','city','status')]);

export const bidOffers = tenantTable('bid_offers', {
  opportunityId: uuid('opportunity_id').notNull(),
  bidderOrgId: uuid('bidder_org_id').notNull(),
  bidderUserId: uuid('bidder_user_id').notNull(),
  bidderName: text('bidder_name').notNull(),
  amountMinor: minorUnits('amount_minor').notNull(),
  estimatedDays: integer('estimated_days'),
  message: text('message').notNull(),
  status: text('status').notNull().default('submitted'),
  revision: revisionColumn(),
}, (_t,h) => [
  h.fk('opportunityId',()=>bidOpportunities),
  h.uniq('opportunityId','bidderOrgId'),
  h.idx('bidderOrgId'),
]);
