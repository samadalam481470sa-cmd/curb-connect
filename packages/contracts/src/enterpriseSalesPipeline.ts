import { z } from 'zod';

export const SALES_PIPELINE_STAGES = [
  { id: 'c96f4577-e27b-4d93-b362-730e849a0001', key: 'new', label: 'New' },
  {
    id: 'c96f4577-e27b-4d93-b362-730e849a0002',
    key: 'attempting_contact',
    label: 'Attempting contact',
  },
  { id: 'c96f4577-e27b-4d93-b362-730e849a0003', key: 'qualified', label: 'Qualified' },
  { id: 'c96f4577-e27b-4d93-b362-730e849a0004', key: 'consultation', label: 'Consultation' },
  { id: 'c96f4577-e27b-4d93-b362-730e849a0005', key: 'estimating', label: 'Estimating' },
  { id: 'c96f4577-e27b-4d93-b362-730e849a0006', key: 'proposal_sent', label: 'Proposal sent' },
  { id: 'c96f4577-e27b-4d93-b362-730e849a0007', key: 'negotiation', label: 'Negotiation' },
  { id: 'c96f4577-e27b-4d93-b362-730e849a0008', key: 'contract_sent', label: 'Contract sent' },
  { id: 'c96f4577-e27b-4d93-b362-730e849a0009', key: 'contract_signed', label: 'Contract signed' },
  { id: 'c96f4577-e27b-4d93-b362-730e849a0010', key: 'lost', label: 'Lost' },
  { id: 'c96f4577-e27b-4d93-b362-730e849a0011', key: 'nurture', label: 'Nurture' },
  { id: 'c96f4577-e27b-4d93-b362-730e849a0012', key: 'project_created', label: 'Project created' },
] as const;

const id = z.uuid();
const instant = z.iso.datetime();
const revision = z.number().int().positive();
export const SalesStageKey = z.enum(SALES_PIPELINE_STAGES.map(({ key }) => key));
export type SalesStageKey = z.infer<typeof SalesStageKey>;
export const SalesStage = z.object({ id, key: SalesStageKey, label: z.string() });

export const AdvanceSalesStage = z.strictObject({
  targetStageId: id,
  reason: z.string().trim().min(3).max(1000).optional(),
  clientRequestId: id,
});

export const SalesStageEvent = z.object({
  id,
  from: SalesStage,
  to: SalesStage,
  reason: z.string().nullable(),
  recordedAt: instant,
  previousStageDurationMs: z.number().int().nonnegative(),
  revision,
});

export const SalesPipelineLead = z.object({
  id,
  name: z.string(),
  revision,
  stage: SalesStage,
  stageEnteredAt: instant,
  source: z.object({ id, name: z.string() }),
  community: z.object({ id, name: z.string() }).nullable(),
  owner: z.object({ id, name: z.string() }).nullable(),
  lastActivityAt: instant.nullable(),
  nextActivityAt: instant.nullable(),
});

export const SalesOpportunity = SalesPipelineLead.extend({
  possibleTransitions: z.array(
    z.object({
      stage: SalesStage,
      blockedReason: z.string().nullable(),
      requiresReason: z.boolean(),
    }),
  ),
  history: z.array(SalesStageEvent),
});

export const SalesPipelinePage = z.object({
  items: z.array(SalesPipelineLead),
  nextCursor: z.string().nullable(),
  counts: z.array(z.object({ stage: SalesStage, count: z.number().int().nonnegative() })),
  readAt: instant,
});

export const SALES_TERMINAL_STAGES = ['lost', 'project_created'] as const;
