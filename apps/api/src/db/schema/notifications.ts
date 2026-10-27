// Tables owned by the `notifications` module: notifications, per-member preferences and consents.
import { boolean, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { tsColumn } from './_columns';
import {
  consentKindEnum,
  consentStatusEnum,
  notificationCategoryEnum,
  notificationChannelEnum,
  notificationDeliveryStatusEnum,
  subjectTypeEnum,
} from './_enums';
import { tenantTable } from './_tenant';
import { contacts } from './crm';
import { memberships } from './team';

export const notifications = tenantTable(
  'notifications',
  {
    recipientMembershipId: uuid('recipient_membership_id'),
    recipientContactId: uuid('recipient_contact_id'),
    channel: notificationChannelEnum('channel').notNull(),
    category: notificationCategoryEnum('category').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    link: text('link'),
    subjectType: subjectTypeEnum('subject_type'),
    subjectId: uuid('subject_id'),
    data: jsonb('data'),
    deliveryStatus: notificationDeliveryStatusEnum('delivery_status').notNull().default('queued'),
    providerMessageId: text('provider_message_id'),
    sentAt: tsColumn('sent_at'),
    readAt: tsColumn('read_at'),
    dedupeKey: text('dedupe_key'),
  },
  (_t, h) => [
    h.fk('recipientMembershipId', () => memberships, 'cascade'),
    h.fk('recipientContactId', () => contacts, 'cascade'),
    h.idx('recipientMembershipId', 'readAt'),
    h.uniq('orgId', 'dedupeKey'),
  ],
);

export const notificationPreferences = tenantTable(
  'notification_preferences',
  {
    membershipId: uuid('membership_id').notNull(),
    category: notificationCategoryEnum('category').notNull(),
    channel: notificationChannelEnum('channel').notNull(),
    enabled: boolean('enabled').notNull().default(true),
  },
  (_t, h) => [
    h.uniq('membershipId', 'category', 'channel'),
    h.fk('membershipId', () => memberships, 'cascade'),
  ],
);

/** Consent ledger for contacts (and members). Withdrawal is a new row, never an edit. */
export const consents = tenantTable(
  'consents',
  {
    contactId: uuid('contact_id'),
    membershipId: uuid('membership_id'),
    kind: consentKindEnum('kind').notNull(),
    status: consentStatusEnum('status').notNull(),
    source: text('source').notNull(),
    policyVersion: text('policy_version'),
    evidence: jsonb('evidence'),
    recordedAt: tsColumn('recorded_at').notNull().defaultNow(),
  },
  (_t, h) => [
    h.fk('contactId', () => contacts, 'cascade'),
    h.fk('membershipId', () => memberships, 'cascade'),
    h.idx('contactId', 'kind'),
  ],
);
