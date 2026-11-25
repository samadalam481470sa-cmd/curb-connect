// Runtime DTO validation for the /v1/enterprise/blueprint routes.
import { z } from 'zod';

export const BlueprintRecord = z.object({
  id: z.uuid(),
  orgId: z.uuid(),
  projectId: z.uuid().nullable(),
  packageCode: z.string(),
  title: z.string(),
  status: z.string(),
  fields: z.record(z.string(), z.string()),
  notes: z.string().nullable(),
  revision: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const BlueprintSummary = z.object({
  byPackage: z.array(
    z.object({
      packageCode: z.string(),
      total: z.number().int(),
      updatedAt: z.string().nullable().optional(),
    }),
  ),
  byStatus: z.array(z.object({ status: z.string(), total: z.number().int() })),
  totalRecords: z.number().int(),
});
export const BlueprintRecords = z.object({ items: z.array(BlueprintRecord) });

export type BlueprintRecordType = z.infer<typeof BlueprintRecord>;
