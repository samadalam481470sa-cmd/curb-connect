import { z } from 'zod';

export const ENTERPRISE_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
export const EnterpriseDocumentCategory = z.enum([
  'plans',
  'specifications',
  'contract',
  'inspection',
  'other',
]);
export const EnterpriseDocumentDecision = z.enum(['approved', 'changes_requested']);

export const EnterpriseDocumentSet = z.object({
  id: z.uuid(),
  title: z.string(),
  category: EnterpriseDocumentCategory,
  createdAt: z.iso.datetime(),
});
export const EnterpriseDocumentReview = z.object({
  decision: EnterpriseDocumentDecision,
  note: z.string(),
  createdAt: z.iso.datetime(),
});
export const EnterpriseDocumentVersion = z.object({
  id: z.uuid(),
  documentSetId: z.uuid().nullable(),
  filename: z.string(),
  version: z.number().int().positive(),
  sha256Hex: z.string().regex(/^[0-9a-f]{64}$/),
  byteSize: z.number().int().nonnegative(),
  scanStatus: z.enum(['clean', 'not_scanned']),
  revisionNote: z.string().nullable(),
  createdAt: z.iso.datetime(),
  review: EnterpriseDocumentReview.nullable(),
});
export type EnterpriseDocumentVersion = z.infer<typeof EnterpriseDocumentVersion>;

export const EnterpriseDocumentPage = z.object({
  items: z.array(EnterpriseDocumentSet),
  nextCursor: z.string().nullable(),
  legacyVersions: z.array(EnterpriseDocumentVersion),
});
export const EnterpriseDocumentDetail = z.object({
  document: EnterpriseDocumentSet,
  versions: z.array(EnterpriseDocumentVersion),
});
