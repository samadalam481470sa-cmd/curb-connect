// Bid outreach: Texas construction companies found each morning, the emails and calls sent to
// them, and the replies read back from the member's connected mailbox. Tenant-scoped with RLS.
import { boolean, date, integer, text, uuid } from 'drizzle-orm/pg-core';
import { minorUnits, revisionColumn, tsColumn } from './_columns';
import { tenantTable } from './_tenant';

export const outreachSettings = tenantTable(
  'outreach_settings',
  {
    autoRefresh: boolean('auto_refresh').notNull().default(true),
    senderUserId: uuid('sender_user_id'),
    businessName: text('business_name').notNull().default(''),
    businessAddress: text('business_address').notNull().default(''),
    businessPhone: text('business_phone').notNull().default(''),
    trades: text('trades').array().notNull(),
    cities: text('cities').array().notNull(),
    dailyLeadTarget: integer('daily_lead_target').notNull().default(25),
    dailyEmailLimit: integer('daily_email_limit').notNull().default(40),
    subjectTemplate: text('subject_template').notNull(),
    bodyTemplate: text('body_template').notNull(),
    searchCursor: integer('search_cursor').notNull().default(0),
    lastRefreshAt: tsColumn('last_refresh_at'),
    lastRefreshMessage: text('last_refresh_message').notNull().default(''),
    lastSyncAt: tsColumn('last_sync_at'),
    lastSyncMessage: text('last_sync_message').notNull().default(''),
    revision: revisionColumn(),
  },
  (_t, h) => [h.uniq('orgId')],
);

export const outreachCompanies = tenantTable(
  'outreach_companies',
  {
    source: text('source').notNull(),
    sourceId: text('source_id'),
    name: text('name').notNull(),
    trade: text('trade').notNull(),
    city: text('city').notNull().default(''),
    state: text('state').notNull().default('TX'),
    address: text('address').notNull().default(''),
    phone: text('phone'),
    website: text('website'),
    email: text('email'),
    emailSource: text('email_source'),
    status: text('status').notNull().default('new'),
    foundOn: date('found_on').notNull(),
    lastContactedAt: tsColumn('last_contacted_at'),
    lastReplyAt: tsColumn('last_reply_at'),
    offerAmountMinor: minorUnits('offer_amount_minor'),
    notes: text('notes').notNull().default(''),
    revision: revisionColumn(),
  },
  (_t, h) => [h.uniq('orgId', 'source', 'sourceId'), h.idx('foundOn'), h.idx('status')],
);

export const outreachMessages = tenantTable(
  'outreach_messages',
  {
    companyId: uuid('company_id').notNull(),
    direction: text('direction').notNull(),
    status: text('status').notNull(),
    subject: text('subject').notNull().default(''),
    body: text('body').notNull().default(''),
    toEmail: text('to_email'),
    fromEmail: text('from_email'),
    externalId: text('external_id'),
    webLink: text('web_link'),
    classification: text('classification'),
    amountMinor: minorUnits('amount_minor'),
    senderUserId: uuid('sender_user_id'),
    error: text('error'),
    handled: boolean('handled').notNull().default(false),
    sentAt: tsColumn('sent_at'),
    receivedAt: tsColumn('received_at'),
  },
  (_t, h) => [
    h.fk('companyId', () => outreachCompanies, 'cascade'),
    h.uniq('orgId', 'externalId'),
    h.idx('companyId'),
    h.idx('direction', 'status'),
  ],
);
