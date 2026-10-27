// Tables owned by the `auth` module. users, external_identities and sessions are global (a person
// may belong to several organizations), so they carry no org_id and no RLS; the API reaches them
// only through the authenticated session. Identity is (issuer, subject), never email.
import { sql } from 'drizzle-orm';
import { index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, tsColumn, updatedAtColumn } from './_columns';
import { identityProviderEnum, userStatusEnum } from './_enums';
import { organizations } from './orgs';

export const users = pgTable(
  'users',
  {
    id: idColumn(),
    displayName: text('display_name').notNull(),
    /** Contact address only, never an identity key. */
    email: text('email'),
    phone: text('phone'),
    status: userStatusEnum('status').notNull().default('active'),
    locale: text('locale').notNull().default('en-US'),
    timezone: text('timezone'),
    lastLoginAt: tsColumn('last_login_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [index('users_email_idx').on(sql`lower(${t.email})`)],
);

export const externalIdentities = pgTable(
  'external_identities',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: identityProviderEnum('provider').notNull(),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    emailAtLogin: text('email_at_login'),
    lastSeenAt: tsColumn('last_seen_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('external_identities_issuer_subject_uq').on(t.issuer, t.subject),
    index('external_identities_user_id_idx').on(t.userId),
  ],
);

/** Server-side sessions: only the SHA-256 of the opaque `fl_session` cookie token is stored. */
export const sessions = pgTable(
  'sessions',
  {
    id: idColumn(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    activeOrgId: uuid('active_org_id').references(() => organizations.id, { onDelete: 'set null' }),
    identityId: uuid('identity_id').references(() => externalIdentities.id, { onDelete: 'set null' }),
    userAgent: text('user_agent'),
    ipHash: text('ip_hash'),
    lastSeenAt: tsColumn('last_seen_at').notNull().defaultNow(),
    idleExpiresAt: tsColumn('idle_expires_at').notNull(),
    absoluteExpiresAt: tsColumn('absolute_expires_at').notNull(),
    revokedAt: tsColumn('revoked_at'),
    rotatedFromId: uuid('rotated_from_id'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uq').on(t.tokenHash),
    index('sessions_user_id_idx').on(t.userId),
  ],
);
