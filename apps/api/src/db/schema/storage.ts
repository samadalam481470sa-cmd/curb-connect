// Tables owned by the `storage` module: generic attachments (documents linked to any subject).
// Binary bytes live in object storage; rows carry keys and hashes only.
import { bigint, text, uuid } from 'drizzle-orm/pg-core';
import { deletedAtColumn } from './_columns';
import { subjectTypeEnum } from './_enums';
import { tenantTable } from './_tenant';
import { mediaAssets } from './media';

export const attachments = tenantTable(
  'attachments',
  {
    subjectType: subjectTypeEnum('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    mediaAssetId: uuid('media_asset_id'),
    objectKey: text('object_key').notNull(),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    label: text('label'),
    uploadedByUserId: uuid('uploaded_by_user_id'),
    deletedAt: deletedAtColumn(),
  },
  (_t, h) => [h.idx('orgId', 'subjectType', 'subjectId'), h.fk('mediaAssetId', () => mediaAssets)],
);
