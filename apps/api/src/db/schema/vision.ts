// Tables owned by the `vision` module (CV pages 026, 045-048, 086-090): the global model
// registry and per-tenant inference results (always suggestions; never silently applied).
import { index, jsonb, numeric, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, tsColumn, updatedAtColumn } from './_columns';
import { inferenceOutcomeEnum, modelStageEnum, modelTaskEnum } from './_enums';
import { tenantTable } from './_tenant';

export const modelRegistry = pgTable(
  'model_registry',
  {
    id: idColumn(),
    task: modelTaskEnum('task').notNull(),
    name: text('name').notNull(),
    version: text('version').notNull(),
    stage: modelStageEnum('stage').notNull().default('dev'),
    artifactUri: text('artifact_uri'),
    artifactSha256: text('artifact_sha256'),
    trainingDataRef: text('training_data_ref'),
    metrics: jsonb('metrics'),
    /** Calibrated abstention threshold: below it the model must abstain. */
    abstainBelow: numeric('abstain_below', { precision: 5, scale: 4 }),
    licenseNotes: text('license_notes'),
    promotedAt: tsColumn('promoted_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (t) => [
    uniqueIndex('model_registry_name_version_uq').on(t.name, t.version),
    index('model_registry_task_stage_idx').on(t.task, t.stage),
  ],
);

export const inferenceResults = tenantTable(
  'inference_results',
  {
    modelId: uuid('model_id')
      .notNull()
      .references(() => modelRegistry.id),
    task: modelTaskEnum('task').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    inputRefs: jsonb('input_refs').notNull(),
    outcome: inferenceOutcomeEnum('outcome').notNull(),
    output: jsonb('output'),
    confidence: numeric('confidence', { precision: 5, scale: 4 }),
    abstainReason: text('abstain_reason'),
    latencyMs: numeric('latency_ms', { precision: 10, scale: 1 }),
    acceptedByUserId: uuid('accepted_by_user_id'),
    acceptedAt: tsColumn('accepted_at'),
  },
  (_t, h) => [h.idx('orgId', 'subjectType', 'subjectId')],
);
