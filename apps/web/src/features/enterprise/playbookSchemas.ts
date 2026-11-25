import { ENTERPRISE_PLAYBOOK_PHASE_KEYS, ENTERPRISE_PROJECT_TYPE_KEYS } from '@fieldline/contracts';
import { z } from 'zod';
import { BlueprintRecord } from './blueprintSchemas';

export const PlaybookStepStatus = z.enum([
  'missing',
  'in_progress',
  'blocked',
  'at_risk',
  'complete',
]);
export const PlaybookGateStatus = z.enum([
  'not_started',
  'in_progress',
  'at_risk',
  'blocked',
  'complete',
]);
export const PlaybookNextAction = z.object({
  kind: z.enum(['create', 'advance', 'clear_block', 'review', 'complete']),
  label: z.string(),
  detail: z.string(),
});
const PlaybookPhaseDefinition = z.object({
  key: z.enum(ENTERPRISE_PLAYBOOK_PHASE_KEYS),
  label: z.string(),
  description: z.string(),
  gateLabel: z.string(),
  gateDescription: z.string(),
});
const PlaybookProjectType = z.object({
  key: z.enum(ENTERPRISE_PROJECT_TYPE_KEYS),
  label: z.string(),
  description: z.string(),
});
const PlaybookStep = z.object({
  packageCode: z.string(),
  title: z.string(),
  domain: z.string(),
  releaseGate: z.number().int(),
  phase: z.enum(ENTERPRISE_PLAYBOOK_PHASE_KEYS),
  owner: z.object({
    name: z.string(),
    role: z.string(),
    source: z.enum(['record', 'package']),
  }),
  recordCount: z.number().int(),
  record: BlueprintRecord.nullable(),
  status: PlaybookStepStatus,
  nextAction: PlaybookNextAction,
});
const PlaybookPhase = z.object({
  key: z.enum(ENTERPRISE_PLAYBOOK_PHASE_KEYS),
  label: z.string(),
  description: z.string(),
  gate: z.object({
    label: z.string(),
    description: z.string(),
    status: PlaybookGateStatus,
    required: z.number().int(),
    recorded: z.number().int(),
    complete: z.number().int(),
    blocked: z.number().int(),
    atRisk: z.number().int(),
  }),
  steps: z.array(PlaybookStep),
});

export const ProjectPlaybook = z.object({
  project: z.object({ id: z.uuid(), name: z.string() }),
  projectType: PlaybookProjectType,
  phase: PlaybookPhaseDefinition.nullable(),
  generatedAt: z.string(),
  summary: z.object({
    required: z.number().int(),
    recorded: z.number().int(),
    complete: z.number().int(),
    missing: z.number().int(),
    blocked: z.number().int(),
    atRisk: z.number().int(),
    nextAction: PlaybookNextAction.extend({
      packageCode: z.string(),
      title: z.string(),
    }).nullable(),
  }),
  phases: z.array(PlaybookPhase),
});

export type ProjectPlaybookType = z.infer<typeof ProjectPlaybook>;
export type PlaybookPhaseType = z.infer<typeof PlaybookPhase>;
export type PlaybookStepType = z.infer<typeof PlaybookStep>;
