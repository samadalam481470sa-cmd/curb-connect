// Optional AI classification of a plan's text into trade line items, using the user's own
// Qwen model through the existing AI hook (home AI server first, open model as backup — the
// same pattern as invoice-ai.ts and landScout buybox-ai.ts). No new AI provider.
//
// The model only labels what the plan text says: every returned line is validated against the
// contract schema and dropped when invalid, quantities stay null unless the text states one,
// and nothing is sent anywhere when no AI server is configured (the caller then keeps the
// deterministic reader only).
import {
  PlanToBidDraftLineSchema,
  type PlanToBidDraftLine,
  type PlanToBidTrade,
} from '@fieldline/contracts';
import { z } from 'zod';
import {
  askOpenModelWithFallback,
  type FetchLike,
  type OpenModelSettings,
} from '../../services/open-model';

export interface PlanAiConfig {
  homeAi: OpenModelSettings | null;
  openModel: OpenModelSettings | null;
}

export interface PlanAiResult {
  lines: PlanToBidDraftLine[];
  model: string;
  source: 'home' | 'open';
}

const AiLineSchema = z.object({
  trade: z.enum([
    'sitework', 'excavation', 'foundations', 'underground_plumbing', 'rebar_vapor',
    'structural_steel', 'framing', 'roofing', 'envelope', 'electrical', 'plumbing',
    'hvac', 'interior_finishes', 'exterior_finishes',
  ]),
  label: z.string().min(1).max(160),
  unit: z.string().min(1).max(24),
  quantity: z.number().positive().max(1_000_000).nullable(),
  evidence: z.string().max(300).nullable(),
});

const AiLinesSchema = z.object({ lines: z.array(AiLineSchema).max(40) });

const SYSTEM = [
  'You read construction plan text (labels, notes, schedules, dimension strings) and list the work items it names, grouped by trade.',
  'Reply with ONLY a JSON object {"lines": [...]}, no prose. Each line: "trade" one of sitework, excavation, foundations, underground_plumbing, rebar_vapor, structural_steel, framing, roofing, envelope, electrical, plumbing, hvac, interior_finishes, exterior_finishes; "label" a short item name; "unit" one of SF, LF, CY, sq, ea, ls; "quantity" a number ONLY when the text states a quantity or dimension for that item, otherwise null; "evidence" a short quote from the text, or null.',
  'Never invent quantities, dimensions, materials or prices. If the text does not state a quantity, use null. At most 40 lines.',
].join('\n');

/** Extract the first balanced JSON object from a model reply, or null. */
export function extractJsonObject(reply: string): unknown {
  const start = reply.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < reply.length; i++) {
    const ch = reply[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(reply.slice(start, i + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Classify plan text with the connected AI. Returns null when no AI is configured or the model answer cannot be used. */
export async function classifyPlanWithAi(
  config: PlanAiConfig,
  planText: string,
  geometrySummary: string,
  fetchImpl: FetchLike = fetch,
  onFailure?: (source: 'home' | 'open', error: Error) => void,
): Promise<PlanAiResult | null> {
  const candidates: { source: 'home' | 'open'; settings: OpenModelSettings }[] = [];
  if (config.homeAi) candidates.push({ source: 'home', settings: config.homeAi });
  if (config.openModel) candidates.push({ source: 'open', settings: config.openModel });
  if (candidates.length === 0 || !planText.trim()) return null;
  const prompt = `${SYSTEM}\n\nPlan text (may be out of order):\n${planText.slice(0, 6000)}\n\n${geometrySummary}`;
  for (const { source, settings } of candidates) {
    try {
      const answer = await askOpenModelWithFallback(
        settings,
        { text: prompt, image: null, maxTokens: 2000, timeoutMs: 90_000 },
        fetchImpl,
      );
      const parsed = AiLinesSchema.safeParse(extractJsonObject(answer.reply));
      if (!parsed.success) return null;
      const lines: PlanToBidDraftLine[] = parsed.data.lines.map((l) => ({
        trade: l.trade as PlanToBidTrade,
        label: l.label,
        unit: l.unit,
        quantity: l.quantity,
        source: 'ai' as const,
        evidence: l.evidence,
        confidence: 0.5,
      }));
      return { lines, model: answer.model, source };
    } catch (error) {
      onFailure?.(source, error as Error);
    }
  }
  return null;
}

/** Keep only AI lines the contract schema accepts (defense in depth for the route). */
export function validAiLines(lines: unknown[]): PlanToBidDraftLine[] {
  const out: PlanToBidDraftLine[] = [];
  for (const line of lines) {
    const parsed = PlanToBidDraftLineSchema.safeParse(line);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
