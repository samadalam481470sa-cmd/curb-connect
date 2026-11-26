// Proactive attention feed contracts (builder operations section). The feed surfaces what
// needs a human: slipping schedules, outstanding POs, overdue AP, warranty tickets waiting,
// contracts at risk. Every item carries its source record and a provenance label —
// `observed` (straight from a record), `estimated` (computed from records with stated math),
// or `modeled` (a rule-based projection, labeled as such). Nothing is invented: when the
// underlying records don't exist, the item doesn't exist. An optional AI summary rides the
// existing Ask Field Pro hook and reports an honest error when no model is connected.
import { z } from 'zod';
import { IsoDateTimeSchema, UuidSchema } from './common';

export const ATTENTION_KINDS = [
  'schedule_slipping',
  'po_outstanding',
  'ap_overdue',
  'ap_awaiting_approval',
  'warranty_waiting',
  'draw_awaiting_decision',
  'contract_at_risk',
  'swppp_due',
  'order_awaiting_response',
] as const;
export const AttentionKindSchema = z.enum(ATTENTION_KINDS);
export type AttentionKind = z.infer<typeof AttentionKindSchema>;

export const AttentionItemSchema = z.object({
  id: z.string(),
  kind: AttentionKindSchema,
  severity: z.enum(['high', 'normal', 'low']),
  title: z.string(),
  detail: z.string(),
  /** observed = read from a record; estimated = computed with stated math; modeled = projection. */
  provenance: z.enum(['observed', 'estimated', 'modeled']),
  /** The record this came from, so the contractor can open it. */
  sourceType: z.string(),
  sourceId: UuidSchema.nullable(),
  /** In-app path to the source record's screen. */
  href: z.string().nullable(),
  observedAt: IsoDateTimeSchema,
});
export type AttentionItem = z.infer<typeof AttentionItemSchema>;

export const AttentionFeedSchema = z.object({
  items: z.array(AttentionItemSchema),
  generatedAt: IsoDateTimeSchema,
  /** Counts per kind, computed from the same records as the items. */
  counts: z.record(z.string(), z.number().int()),
});
export type AttentionFeed = z.infer<typeof AttentionFeedSchema>;

export const AttentionSummarySchema = z.object({
  /** AI-written summary of the feed, or null when no model is connected. */
  summary: z.string().nullable(),
  /** 'ok' when a model answered; 'not_connected' when no AI is reachable. */
  state: z.enum(['ok', 'not_connected']),
  note: z.string(),
});
export type AttentionSummary = z.infer<typeof AttentionSummarySchema>;
