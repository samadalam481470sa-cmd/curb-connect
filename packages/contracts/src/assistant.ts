// Ask Field Pro: the in-app AI assistant (general questions, home-build help, search help,
// estimate review). The assistant is embedded inside tools (Phase F item 28); `context` carries
// which tool the reader is in so answers can point at the right screen and fields.
import { z } from 'zod';

export const ASSISTANT_MODES = ['general', 'home_build', 'search_help', 'estimate_review'] as const;
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
  /**
   * Where the reader is asking from (tool name and what is on screen), e.g.
   * "Roof estimator, 30 squares, tear-off included". Plain text only; never secrets.
   */
  context: z.string().trim().min(1).max(500).optional(),
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

// ---------------------------------------------------------------------------------------------
// House-model chat (AI Architecture reel, tool #3 idea: talk to the building model).
// The web app sends a client-computed summary of the current House Builder model (program +
// room schedule) and asks plain-language questions about it. Read-only: the assistant answers
// from the summary only and cannot change the house. When no AI is connected the API says so
// honestly instead of inventing an answer.
// ---------------------------------------------------------------------------------------------

export const HouseModelRoomSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.string().min(1).max(24),
  w: z.number().min(0).max(500),
  h: z.number().min(0).max(500),
  areaSqFt: z.number().min(0).max(100_000),
});
export type HouseModelRoom = z.infer<typeof HouseModelRoomSchema>;

export const HouseModelFloorSchema = z.object({
  level: z.number().int().min(1).max(4),
  rooms: z.array(HouseModelRoomSchema).max(40),
});
export type HouseModelFloor = z.infer<typeof HouseModelFloorSchema>;

/** Client-computed snapshot of the house on screen; the server renders it verbatim into the prompt. */
export const HouseModelSummarySchema = z.object({
  lengthFt: z.number().min(1).max(500),
  widthFt: z.number().min(1).max(500),
  stories: z.union([z.literal(1), z.literal(2)]),
  bedrooms: z.number().int().min(0).max(20),
  bathrooms: z.number().int().min(0).max(20),
  garage: z.enum(['none', 'one_car', 'two_car']),
  conditionedAreaSqFt: z.number().min(0).max(1_000_000),
  floors: z.array(HouseModelFloorSchema).min(1).max(4),
});
export type HouseModelSummary = z.infer<typeof HouseModelSummarySchema>;

export const HouseModelChatRequestSchema = z.object({
  question: z.string().trim().min(2).max(2000),
  history: z.array(AssistantTurnSchema).max(20).default([]),
  model: HouseModelSummarySchema,
});
export type HouseModelChatRequest = z.infer<typeof HouseModelChatRequestSchema>;

export const HouseModelChatResponseSchema = z.object({
  answer: z.string(),
  source: z.enum(['home_server', 'backup_model']),
  model: z.string(),
  professionalAdvised: z.boolean(),
  disclaimer: z.string(),
});
export type HouseModelChatResponse = z.infer<typeof HouseModelChatResponseSchema>;

/**
 * Built-in help topics (Phase F item 28): short, repo-maintained answers that work with no AI
 * connected. The Ask panel falls back to searching these when no model is reachable, instead of
 * inventing an answer.
 */
export const AssistantHelpTopicSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** Tool/screen this topic belongs to (route id), or 'general'. */
  tool: z.string().min(1),
  body: z.string().min(1),
  keywords: z.array(z.string().min(1)),
});

export const AssistantHelpResponseSchema = z.object({
  topics: z.array(AssistantHelpTopicSchema),
  /** True when an AI model is configured; help topics are shown either way. */
  aiAvailable: z.boolean(),
});

export type AssistantHelpTopic = z.infer<typeof AssistantHelpTopicSchema>;
export type AssistantHelpResponse = z.infer<typeof AssistantHelpResponseSchema>;
