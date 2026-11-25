// Evidence-backed control requirements for the Enterprise control-level addendum.
// One assignment row per organization/module/gate; evidence rows carry an optional encrypted
// attachment and an immutable review decision.
import type { ControlEvidenceReviewStatus } from '@fieldline/contracts';
import {
  bigint,
  date,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const suite = pgSchema('enterprise_suite');

export const enterpriseControlRequirements = suite.table(
  'control_requirements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    moduleKey: text('module_key').notNull(),
    gateKey: text('gate_key').notNull(),
    ownerUserId: uuid('owner_user_id'),
    expiresOn: date('expires_on'),
    notes: text('notes'),
    revision: integer('revision').notNull().default(1),
    createdByUserId: uuid('created_by_user_id').notNull(),
    updatedByUserId: uuid('updated_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    unique('enterprise_control_requirement_identity').on(
      table.orgId,
      table.moduleKey,
      table.gateKey,
    ),
    index('enterprise_control_requirements_owner_idx').on(
      table.orgId,
      table.ownerUserId,
      table.expiresOn,
    ),
  ],
);

export const enterpriseControlEvidence = suite.table(
  'control_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull(),
    moduleKey: text('module_key').notNull(),
    gateKey: text('gate_key').notNull(),
    title: varchar('title', { length: 180 }).notNull(),
    note: text('note'),
    evidenceOn: date('evidence_on').notNull(),
    expiresOn: date('expires_on'),
    sourceReference: text('source_reference'),
    filename: text('filename'),
    storageKey: text('storage_key'),
    fileSha256: varchar('file_sha256', { length: 64 }),
    fileBytes: bigint('file_bytes', { mode: 'number' }),
    reviewStatus: text('review_status')
      .$type<ControlEvidenceReviewStatus>()
      .notNull()
      .default('pending'),
    reviewedByUserId: uuid('reviewed_by_user_id'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
    reviewNote: text('review_note'),
    createdByUserId: uuid('created_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('enterprise_control_evidence_gate_idx').on(
      table.orgId,
      table.moduleKey,
      table.gateKey,
      table.createdAt,
    ),
  ],
);
