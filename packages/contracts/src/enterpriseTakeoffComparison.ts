import { z } from 'zod';

export const TakeoffComparisonAlignment = z
  .object({
    offsetX: z.number().min(-100000).max(100000).default(0),
    offsetY: z.number().min(-100000).max(100000).default(0),
    scale: z.number().min(0.0625).max(16).default(1),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
    reviewed: z.boolean().default(false),
  })
  .strict();

export const CompareTakeoffRevisions = z
  .object({
    oldRevisionId: z.uuid(),
    oldSheetId: z.uuid(),
    newRevisionId: z.uuid(),
    newSheetId: z.uuid(),
    alignment: TakeoffComparisonAlignment,
  })
  .strict();

const ComparisonSheet = z.object({
  planId: z.uuid(),
  sheetId: z.uuid(),
  sourceVersionId: z.uuid(),
  planTitle: z.string(),
  revisionLabel: z.string(),
  pageLabel: z.string(),
  pageNumber: z.number().int().positive(),
  widthPoints: z.number().positive(),
  heightPoints: z.number().positive(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
});
export const TakeoffComparisonIssue = z.enum([
  'different_sheet',
  'different_size',
  'different_scale',
  'unknown_scale',
]);
export const TakeoffComparisonPreview = z.object({
  earlier: ComparisonSheet,
  current: ComparisonSheet,
  alignment: TakeoffComparisonAlignment,
  alignmentIssues: z.array(TakeoffComparisonIssue),
  status: z.enum(['alignment_review', 'ready']),
});
