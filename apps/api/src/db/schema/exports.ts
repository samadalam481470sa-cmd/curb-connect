// Tables owned by the `exports` module: every generated export (PDF/CSV/JSON/ESX) with checksum.
import { bigint, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { tsColumn } from './_columns';
import { exportFormatEnum, exportStatusEnum } from './_enums';
import { tenantTable } from './_tenant';

export const exportRecords = tenantTable(
  'export_records',
  {
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    format: exportFormatEnum('format').notNull(),
    status: exportStatusEnum('status').notNull().default('pending'),
    templateVersion: text('template_version'),
    objectKey: text('object_key'),
    sha256: text('sha256'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    options: jsonb('options'),
    error: text('error'),
    requestedByUserId: uuid('requested_by_user_id'),
    completedAt: tsColumn('completed_at'),
  },
  (_t, h) => [h.idx('orgId', 'subjectType', 'subjectId')],
);
