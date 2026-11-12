// Runtime DTO validation for the isolated /v1/enterprise routes.
import { z } from 'zod';

export const SuiteStatus = z.object({ enabled: z.boolean(), canManage: z.boolean() });
const Base = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  revision: z.number().int().optional(),
});
export const Project = Base.extend({
  name: z.string(), originalContractMinor: z.number(), createdAt: z.string(),
});
export const Rfi = Base.extend({
  projectId: z.string().uuid(), rfiNumber: z.number(), subject: z.string(),
  question: z.string(), ballInCourt: z.string(), status: z.string(),
  costImpact: z.boolean(), scheduleImpactDays: z.number(), revision: z.number(),
  officialResponse: z.string().nullable(),
});
export const ChangeOrder = Base.extend({
  projectId: z.string().uuid(), number: z.string(), title: z.string(),
  description: z.string(), status: z.string(), amountDeltaMinor: z.number(),
  scheduleImpactDays: z.number(), revision: z.number(),
});
export const Submittal = Base.extend({
  projectId: z.string().uuid(), number: z.string(), title: z.string(),
  reviewer: z.string(), status: z.string(), currentRevision: z.number(),
  documentReference: z.string().nullable(), specSection: z.string(), revision: z.number(),
});
export const SovLine = Base.extend({
  projectId: z.string().uuid(), lineNumber: z.number(), costCode: z.string(),
  description: z.string(), scheduledMinor: z.number(), previousMinor: z.number(),
  currentMinor: z.number(), storedMinor: z.number(), retainageBps: z.number(),
});
export const SovSummary = z.object({
  originalContractMinor: z.number(), approvedChangeMinor: z.number(),
  revisedContractMinor: z.number(), scheduledMinor: z.number(),
  completedMinor: z.number(), currentMinor: z.number(), retainageMinor: z.number(),
  earnedLessRetainageMinor: z.number(), previousCertificatesMinor: z.number(),
  currentPaymentDueMinor: z.number(), unbilledMinor: z.number(),
});
export const ProjectList = z.object({ items: z.array(Project) });
export const ProjectRecords = z.object({
  project: Project, rfis: z.array(Rfi), changeOrders: z.array(ChangeOrder),
  submittals: z.array(Submittal), sovLines: z.array(SovLine), summary: SovSummary,
});
export type ProjectRecord = z.infer<typeof Project>;
export type RfiRecord = z.infer<typeof Rfi>;
export type ChangeOrderRecord = z.infer<typeof ChangeOrder>;
export type SubmittalRecord = z.infer<typeof Submittal>;
