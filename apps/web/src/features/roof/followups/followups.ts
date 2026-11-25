// Follow-Up Queue (web): response schemas, outcome labels and stage options.
// Pure logic only (no React, no network) so it can be unit-tested.
// Schemas mirror the API module (apps/api/src/modules/followUps/) for client validation.
import { z } from 'zod';

export const CALL_OUTCOMES = ['answered', 'voicemail', 'no_answer', 'wrong_number', 'not_interested'] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  answered: 'Answered',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
  wrong_number: 'Wrong number',
  not_interested: 'Not interested',
};

export function callOutcomeLabel(outcome: CallOutcome): string {
  return CALL_OUTCOME_LABELS[outcome];
}

export const FOLLOW_UP_STAGES = ['quoted', 'interested', 'lost'] as const;
export type FollowUpStage = (typeof FOLLOW_UP_STAGES)[number];

export const FOLLOW_UP_STAGE_LABELS: Record<FollowUpStage, string> = {
  quoted: 'Quoted',
  interested: 'Interested',
  lost: 'Lost',
};

/** Stages a follow-up completion may move a lead to. Funnel leads use funnel stages;
 *  roof quotes can only be marked won or cancelled from a follow-up. */
export const FUNNEL_ADVANCE_STAGES = ['quoted', 'interested', 'won', 'lost'] as const;
export const ROOF_ORDER_ADVANCE_STAGES = ['won', 'cancelled'] as const;

export const FollowUpItemSchema = z.object({
  id: z.string(),
  source: z.enum(['funnel', 'roof_order']),
  leadKey: z.string().nullable(),
  roofOrderId: z.string().nullable(),
  roofOrderNumber: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  stage: z.enum(FOLLOW_UP_STAGES),
  stageLabel: z.string(),
  callCount: z.number(),
  lastContactAt: z.string().nullable(),
  lastOutcome: z.enum(CALL_OUTCOMES).nullable(),
  lastNote: z.string().nullable(),
  dueAt: z.string(),
  overdueDays: z.number(),
  dueReason: z.string(),
  suggestedTemplateId: z.string(),
  snoozedUntil: z.string().nullable(),
  cadenceDays: z.number(),
});
export type FollowUpItem = z.infer<typeof FollowUpItemSchema>;

export const FollowUpListSchema = z.object({
  items: z.array(FollowUpItemSchema),
  automation: z.object({
    enabled: z.boolean(),
    autoCreate: z.boolean(),
    autoSend: z.boolean(),
    note: z.string(),
  }),
  cadenceDays: z.object({
    quoted: z.number(),
    interested: z.number(),
    lost: z.number(),
  }),
});
export type FollowUpList = z.infer<typeof FollowUpListSchema>;

export const FollowUpTemplateSchema = z.object({
  id: z.string(),
  stage: z.enum(FOLLOW_UP_STAGES),
  label: z.string(),
  body: z.string(),
});
export type FollowUpTemplate = z.infer<typeof FollowUpTemplateSchema>;

export const FollowUpTemplateListSchema = z.object({
  templates: z.array(FollowUpTemplateSchema),
});

export const CompleteFollowUpResponseSchema = z.object({
  item: FollowUpItemSchema,
  outcome: z.string(),
  stage: z.string().nullable(),
  note: z.string(),
});

export const SnoozeFollowUpResponseSchema = z.object({
  item: FollowUpItemSchema,
  snoozedUntil: z.string(),
});

export function followUpTitle(item: FollowUpItem): string {
  if (item.source === 'roof_order') return `Roof quote ${item.roofOrderNumber ?? ''}`.trim();
  return [item.address, item.city].filter(Boolean).join(', ') || `Lead ${item.leadKey ?? ''}`;
}
