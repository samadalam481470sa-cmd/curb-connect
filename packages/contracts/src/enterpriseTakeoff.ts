import { z } from 'zod';

export const MAX_TAKEOFF_SOURCE_FILES = 5;
export const MAX_TAKEOFF_SHEETS = 150;

export const EnterpriseTakeoffPlanInput = z
  .object({
    title: z.string().trim().min(2).max(180),
    revisionLabel: z.string().trim().min(1).max(60),
    versionIds: z
      .array(z.uuid())
      .min(1)
      .max(MAX_TAKEOFF_SOURCE_FILES)
      .refine((ids) => new Set(ids).size === ids.length, 'Add each document version once.'),
    clientRequestId: z.uuid(),
  })
  .strict();

export const EnterpriseTakeoffPlan = EnterpriseTakeoffPlanInput.pick({
  title: true,
  revisionLabel: true,
}).extend({
  id: z.uuid(),
  sourceCount: z.number().int().min(1).max(MAX_TAKEOFF_SOURCE_FILES),
  sheetCount: z.number().int().min(1).max(MAX_TAKEOFF_SHEETS),
  createdAt: z.iso.datetime(),
});
export type EnterpriseTakeoffPlan = z.infer<typeof EnterpriseTakeoffPlan>;

export const EnterpriseTakeoffSheet = z.object({
  id: z.uuid(),
  sourceVersionId: z.uuid(),
  sourceTitle: z.string(),
  sourceFilename: z.string(),
  sourceRevision: z.number().int().positive(),
  scanStatus: z.enum(['clean', 'not_scanned']),
  pageNumber: z.number().int().positive(),
  pageLabel: z.string().min(1).max(120),
  widthPoints: z.number().positive(),
  heightPoints: z.number().positive(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
});

export const EnterpriseTakeoffPlanPage = z.object({
  items: z.array(EnterpriseTakeoffPlan),
  nextCursor: z.string().nullable(),
});

export const EnterpriseTakeoffPlanDetail = z.object({
  plan: EnterpriseTakeoffPlan,
  sheets: z.array(EnterpriseTakeoffSheet),
});

export const EnterpriseTakeoffSourcePage = z.object({
  items: z.array(
    z.object({
      versionId: z.uuid(),
      title: z.string(),
      filename: z.string(),
      version: z.number().int().positive(),
      scanStatus: EnterpriseTakeoffSheet.shape.scanStatus,
    }),
  ),
  nextCursor: z.string().nullable(),
});

export const TakeoffSheetContext = z.object({ projectId: z.uuid() });
