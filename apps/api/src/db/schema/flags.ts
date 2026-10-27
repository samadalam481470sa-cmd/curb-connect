// Tables owned by the `flags` module. feature_flags is NOT a tenantTable: org_id NULL is the
// platform default, and jurisdiction_id narrows a flag to one jurisdiction (PLT-020). RLS lets a
// tenant read global rows and its own rows; only the platform role writes global rows.
import { sql } from 'drizzle-orm';
import { boolean, foreignKey, index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, revisionColumn, updatedAtColumn } from './_columns';
import { organizations } from './orgs';
import { jurisdictions } from './properties';

export const featureFlags = pgTable(
  'feature_flags',
  {
    id: idColumn(),
    orgId: uuid('org_id'),
    jurisdictionId: uuid('jurisdiction_id'),
    key: text('key').notNull(),
    enabled: boolean('enabled').notNull(),
    rolloutNote: text('rollout_note'),
    config: jsonb('config'),
    revision: revisionColumn(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    // NULLs are made distinct-safe with coalesce so (global, key) is unique too.
    uniqueIndex('feature_flags_scope_key_uq').on(
      sql`coalesce(${t.orgId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`coalesce(${t.jurisdictionId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.key,
    ),
    index('feature_flags_org_id_idx').on(t.orgId),
    foreignKey({ name: 'feature_flags_org_fk', columns: [t.orgId], foreignColumns: [organizations.id] }),
    foreignKey({
      name: 'feature_flags_jurisdiction_fk',
      columns: [t.jurisdictionId],
      foreignColumns: [jurisdictions.id],
    }),
  ],
);
