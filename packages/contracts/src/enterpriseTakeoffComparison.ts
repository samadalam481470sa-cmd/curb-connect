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
export const TakeoffComparisonKey = z.string().regex(/^[a-f0-9]{64}$/);
export const TakeoffComparisonPreview = z.object({
  earlier: ComparisonSheet,
  current: ComparisonSheet,
  alignment: TakeoffComparisonAlignment,
  alignmentIssues: z.array(TakeoffComparisonIssue),
  comparisonKey: TakeoffComparisonKey,
  status: z.enum(['alignment_review', 'ready']),
});

export const RenderTakeoffComparison = CompareTakeoffRevisions.extend({
  comparisonKey: TakeoffComparisonKey,
});
export const TakeoffComparisonRaster = z.object({
  width: z.number().int().min(1).max(1200),
  height: z.number().int().min(1).max(1200),
  earlierPng: z.base64(),
  currentPng: z.base64(),
  overlayPng: z.base64(),
  addedPixels: z.number().int().nonnegative(),
  removedPixels: z.number().int().nonnegative(),
});
const Coordinate = z.number().min(0).max(1);
const AnnotationText = z.string().trim().min(3).max(1000);
export const CreateTakeoffComparisonNote = CompareTakeoffRevisions.extend({
  comparisonKey: TakeoffComparisonKey,
  clientRequestId: z.uuid(),
  x: Coordinate,
  y: Coordinate,
  body: AnnotationText,
});

export const TakeoffComparisonNote = z.object({
  id: z.uuid(),
  comparisonKey: TakeoffComparisonKey,
  x: Coordinate,
  y: Coordinate,
  body: AnnotationText,
  createdByUserId: z.uuid(),
  createdAt: z.iso.datetime(),
});

export const TakeoffComparisonNotePage = z.object({
  items: z.array(TakeoffComparisonNote),
  nextCursor: z.string().nullable(),
});
