// Tables owned by the `devices` module: push-notification device registrations.
// Web Push subscriptions (endpoint + p256dh/auth keys) work today; iOS/Android
// device tokens are recorded in the same shape (endpoint = token) but delivery
// stays gated on the owner's Apple Developer / Firebase accounts.
import { text, uuid } from 'drizzle-orm/pg-core';
import { tsColumn } from './_columns';
import { tenantTable } from './_tenant';
import { memberships } from './team';

export const devices = tenantTable(
  'devices',
  {
    membershipId: uuid('membership_id').notNull(),
    userId: uuid('user_id').notNull(),
    platform: text('platform').$type<'web' | 'ios' | 'android'>().notNull(),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh'),
    auth: text('auth'),
    userAgent: text('user_agent'),
    lastSeenAt: tsColumn('last_seen_at').notNull().defaultNow(),
    revokedAt: tsColumn('revoked_at'),
  },
  (_t, h) => [
    h.fk('membershipId', () => memberships),
    h.uniq('orgId', 'membershipId', 'platform', 'endpoint'),
    h.idx('orgId', 'membershipId'),
  ],
);
