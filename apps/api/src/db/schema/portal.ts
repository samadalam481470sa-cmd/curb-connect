// Tables owned by the `portal` module (STR-004): homeowner magic links. Only the SHA-256 of the
// token is stored; a token is scoped to one subject and expires.
import { integer, text, uuid } from 'drizzle-orm/pg-core';
import { tsColumn } from './_columns';
import { portalTokenScopeEnum } from './_enums';
import { tenantTable } from './_tenant';
import { contacts } from './crm';

export const portalTokens = tenantTable(
  'portal_tokens',
  {
    tokenHash: text('token_hash').notNull(),
    scope: portalTokenScopeEnum('scope').notNull(),
    subjectId: uuid('subject_id').notNull(),
    contactId: uuid('contact_id'),
    expiresAt: tsColumn('expires_at').notNull(),
    revokedAt: tsColumn('revoked_at'),
    lastUsedAt: tsColumn('last_used_at'),
    useCount: integer('use_count').notNull().default(0),
    maxUses: integer('max_uses'),
    createdByUserId: uuid('created_by_user_id'),
  },
  (_t, h) => [h.uniq('tokenHash'), h.fk('contactId', () => contacts), h.idx('orgId', 'scope', 'subjectId')],
);
