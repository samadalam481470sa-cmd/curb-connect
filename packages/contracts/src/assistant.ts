// Ask Field Pro: the in-app AI assistant (general questions, home-build help, search help).
import { z } from 'zod';

export const ASSISTANT_MODES = ['general', 'home_build', 'search_help'] as const;
export const AssistantModeSchema = z.enum(ASSISTANT_MODES);

export const AssistantTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(4000),
});

export const AssistantAskRequestSchema = z.object({
  question: z.string().trim().min(2).max(2000),
  mode: AssistantModeSchema.default('general'),
  /** Earlier turns of this chat, oldest first. Only the last 8 are used. */
  history: z.array(AssistantTurnSchema).max(20).default([]),
});

export const AssistantAskResponseSchema = z.object({
  answer: z.string(),
  mode: AssistantModeSchema,
  /** Which AI answered: the always-on home server or the backup model. */
  source: z.enum(['home_server', 'backup_model']),
  model: z.string(),
  /** True when the safety rules asked the reader to confirm with a licensed professional. */
  professionalAdvised: z.boolean(),
  disclaimer: z.string(),
});

export const AssistantStatusResponseSchema = z.object({
  /** The always-on home server answered a quick check just now. */
  homeServer: z.enum(['online', 'offline', 'not_configured']),
  backupModel: z.enum(['configured', 'not_configured']),
  /** False when neither AI can answer. */
  available: z.boolean(),
});

export type AssistantMode = z.infer<typeof AssistantModeSchema>;
export type AssistantAskRequest = z.infer<typeof AssistantAskRequestSchema>;
export type AssistantAskResponse = z.infer<typeof AssistantAskResponseSchema>;
export type AssistantStatusResponse = z.infer<typeof AssistantStatusResponseSchema>;
