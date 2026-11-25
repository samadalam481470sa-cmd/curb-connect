// Runtime DTO validation for the /v1/enterprise/blueprint routes.
import { z } from 'zod';

export const BlueprintRecord = z.object({
  id: z.uuid(),
  orgId: z.uuid(),
  projectId: z.uuid().nullable(),
  packageCode: z.string(),
  title: z.string(),
  status: z.string(),
  fields: z.record(z.string(), z.union([z.string(), z.number()])),
  ownerUserId: z.uuid().nullable(),
  ownerName: z.string().nullable().optional(),
  dueOn: z.string().nullable(),
  slaHours: z.number().int().nullable(),
  blockedReason: z.string().nullable(),
  blockedAt: z.string().nullable(),
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
export const BlueprintTeamMembers = z.object({
  items: z.array(z.object({ userId: z.uuid(), displayName: z.string() })),
});

export const BlueprintException = BlueprintRecord.extend({
  overdue: z.boolean(),
  blocked: z.boolean(),
  slaBreached: z.boolean(),
  slaDueAt: z.string().nullable(),
  daysOverdue: z.number().int(),
  reasons: z.array(z.enum(['overdue', 'blocked', 'sla_breached'])),
});
export const BlueprintExceptions = z.object({
  generatedAt: z.string(),
  today: z.string(),
  counts: z.object({
    overdue: z.number().int(),
    blocked: z.number().int(),
    slaBreached: z.number().int(),
    unassigned: z.number().int(),
    total: z.number().int(),
  }),
  items: z.array(BlueprintException),
});

export type BlueprintRecordType = z.infer<typeof BlueprintRecord>;
export type BlueprintExceptionType = z.infer<typeof BlueprintException>;
export type BlueprintExceptionsType = z.infer<typeof BlueprintExceptions>;
