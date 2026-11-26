// House-model chat (AI Architecture reel, tool #3 idea: ask the building model questions in
// plain language). The web app sends a client-computed summary of the house on screen; the
// assistant answers from that summary only, through the same home-AI-first hook as Ask Field
// Pro. Read-only by design: it cannot change the house, and when asked to change something it
// says which House Builder control does it. No model reachable -> AssistantUnavailable, never
// an invented answer.
import type { HouseModelSummary } from '@fieldline/contracts';
import type { ChatMessage, OpenModelSettings } from '../../services/open-model';
import { adviseProfessional, AssistantUnavailable, type ChatFn } from './assistant';

const HOUSE_MODEL_RULES = `You are Ask Field Pro, answering questions about one specific house model inside a construction contractor app. The house model summary below is the only facts you have about this house.
Rules:
- Answer from the model summary only, in plain short sentences. Lead with the answer.
- If the summary does not say (for example door positions, window counts, prices, or anything not listed), say the model does not show that. Never invent room sizes, areas, prices, code sections or permit rules.
- You cannot change the house. If asked to change something, say what to change in the House Builder (footprint, bedrooms, bathrooms, stories, garage, or dragging rooms in the CAD plan editor) and what it would do to the plan.
- The plan is a schematic rectangle sketch, not an architectural design and not a code review. Say so when it matters.
- For structural loads, foundations, load-bearing walls, electrical, gas, fire and egress questions, give general information only and tell the reader a licensed professional or the local building office must decide.`;

/** Render the client-computed summary as the plain-text schedule the model answers from. */
export function renderHouseModelSummary(model: HouseModelSummary): string {
  const lines: string[] = [
    `House: ${model.lengthFt} ft long × ${model.widthFt} ft wide, ${model.stories} stor${model.stories === 1 ? 'y' : 'ies'}, ${model.bedrooms} bedrooms, ${model.bathrooms} bathrooms, garage: ${model.garage === 'none' ? 'none' : model.garage === 'one_car' ? '1-car' : '2-car'}.`,
    `Conditioned area: ${Math.round(model.conditionedAreaSqFt)} sq ft.`,
  ];
  for (const floor of model.floors) {
    lines.push(`Floor ${floor.level}:`);
    for (const room of floor.rooms) {
      lines.push(`- ${room.name} (${room.kind}): ${room.w} × ${room.h} ft, ${Math.round(room.areaSqFt)} sq ft`);
    }
  }
  return lines.join('\n');
}

export interface HouseModelAnswer {
  answer: string;
  source: 'home_server' | 'backup_model';
  model: string;
  professionalAdvised: boolean;
}

export async function answerHouseModelQuestion(
  models: { home: OpenModelSettings | null; backup: OpenModelSettings | null },
  input: {
    question: string;
    history: { role: 'user' | 'assistant'; content: string }[];
    model: HouseModelSummary;
  },
  chat: ChatFn,
  onFallback?: (error: unknown) => void,
): Promise<HouseModelAnswer> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `${HOUSE_MODEL_RULES}\n\nHouse model summary:\n${renderHouseModelSummary(input.model)}`,
    },
    ...input.history.slice(-8).map((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: input.question },
  ];
  const tries: ['home_server' | 'backup_model', OpenModelSettings][] = [];
  if (models.home) tries.push(['home_server', models.home]);
  if (models.backup) tries.push(['backup_model', models.backup]);
  if (tries.length === 0) throw new AssistantUnavailable('No AI is set up on this server.');
  for (const [source, settings] of tries) {
    try {
      const answer = await chat(settings, messages);
      return {
        answer,
        source,
        model: settings.model,
        professionalAdvised: adviseProfessional(input.question, answer),
      };
    } catch (error) {
      onFallback?.(error);
    }
  }
  throw new AssistantUnavailable('Every AI model failed to answer.');
}
