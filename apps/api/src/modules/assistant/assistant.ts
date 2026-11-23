// Ask Field Pro logic. No I/O except the injected chat function, so it is unit tested directly.
//
// Order of attempts: the always-on home AI server first, then the backup open model. If both fail
// the caller gets AssistantUnavailable and says so. The assistant never invents an answer when no
// model is reachable, and the prompt tells the model to say when it does not know.
import type { AssistantMode } from '@fieldline/contracts';
import type { ChatMessage, OpenModelSettings } from '../../services/open-model';

export class AssistantUnavailable extends Error {}

export const DISCLAIMER =
  'AI answers can be wrong. Prices, codes and permit rules change by city. Confirm anything that affects safety, structure, electrical, gas or a permit with a licensed professional and your local building office.';

const BASE_RULES = `You are Ask Field Pro, the assistant inside a construction contractor app (roofing, concrete, curb cutting, estimating, home building). The reader is a working contractor or builder in the United States, mostly Texas.
Rules:
- Answer the question that was asked, in plain short sentences. Lead with the answer.
- If you do not know, or the answer depends on facts you cannot see, say so. Never invent prices, code sections, permit rules, product specs, phone numbers or links.
- You cannot see live prices or the reader's saved jobs. When money matters, give a rough range and say it must be checked against current quotes.
- Building codes, permits and inspections differ by city and county. Name the usual rule only as a general guide and tell the reader to confirm with the local building office.
- For structural loads, foundations, load-bearing walls, electrical, gas, fire, asbestos and fall protection, give general information only and tell the reader a licensed engineer or licensed trade must decide.
- If the question is not about building, trades, business or the app, answer briefly and helpfully anyway.`;

const MODE_RULES: Record<AssistantMode, string> = {
  general: 'Answer any question the reader asks.',
  home_build: `Focus: planning and building a house. Cover steps in order (lot and permits, site work, foundation, framing, roof, mechanical and electrical rough-in, insulation, drywall, finishes), typical sequence and who does each job, what to ask a builder, and what usually goes wrong. When asked about cost, give per-square-foot style ranges as rough guides, name what changes them, and say the Field Pro House Studio estimate or local quotes give the real number.`,
  search_help: `Focus: helping the reader find things. Explain which Field Pro screen holds a thing (customers, leads, jobs, estimates, proposals, invoices, roof and curb projects, permits and bidding) and what words to search for. For outside information, say what to look up and where (city permit portal, supplier, manufacturer data sheet).`,
  estimate_review: `Focus: reviewing an estimate the reader is building (roof, curb, HVAC, electrical, plumbing or house build). Help them sanity-check quantities, waste factors, line items that are easy to miss (tear-off, disposal, permits, flashing, underlayment, trim, cleanup), and how the price book and material lines feed the total. You cannot see their numbers unless they paste them in the question or context; when they do, check the arithmetic they show and name anything that looks off. Never invent a price: if a line has no price, say it must come from their price book or a current supplier quote. Remind them the estimate is a planning number until quantities are measured on site.`,
};

const HISTORY_TURNS = 8;

export function buildMessages(
  question: string,
  mode: AssistantMode,
  history: { role: 'user' | 'assistant'; content: string }[],
  context?: string,
): ChatMessage[] {
  const contextLine = context?.trim()
    ? `\n\nWhere the reader is asking from: ${context.trim()}`
    : '';
  return [
    { role: 'system', content: `${BASE_RULES}\n\n${MODE_RULES[mode]}${contextLine}` },
    ...history.slice(-HISTORY_TURNS).map((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: question },
  ];
}

const PRO_WORDS =
  /\b(structural|load[- ]bearing|foundation|engineer|electrical|wiring|gas line|fire|asbestos|permit|inspection|licensed|fall protection)\b/i;

/** True when the answer asks the reader to confirm with a licensed professional or the city. */
export function adviseProfessional(question: string, answer: string): boolean {
  return PRO_WORDS.test(question) || PRO_WORDS.test(answer);
}

export type ChatFn = (settings: OpenModelSettings, messages: ChatMessage[]) => Promise<string>;

export interface AssistantAnswer {
  answer: string;
  source: 'home_server' | 'backup_model';
  model: string;
  professionalAdvised: boolean;
}

export async function answerQuestion(
  models: { home: OpenModelSettings | null; backup: OpenModelSettings | null },
  input: {
    question: string;
    mode: AssistantMode;
    history: { role: 'user' | 'assistant'; content: string }[];
    context?: string;
  },
  chat: ChatFn,
  onFallback?: (error: unknown) => void,
): Promise<AssistantAnswer> {
  const messages = buildMessages(input.question, input.mode, input.history, input.context);
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

/** Quick liveness check of an OpenAI-compatible server: GET {base}/models within 3 seconds. */
export async function probeModelServer(
  settings: OpenModelSettings,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(`${settings.baseUrl.replace(/\/+$/, '')}/models`, {
      headers: settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {},
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
