// Plain-English buy box -> structured filters, parsed by the user's own Qwen model through
// the existing AI hook (always-on home AI server first, open model as backup — the same
// pattern as invoice-ai.ts and the assistant). No new AI provider. When neither server is
// configured, nothing is sent anywhere and the manual form is the only path.
import { BuyBoxSchema, type BuyBox } from '@fieldline/contracts';
import { chatOpenModel, type FetchLike, type OpenModelSettings } from '../../services/open-model';

export interface BuyBoxAiConfig {
  homeAi: OpenModelSettings | null;
  openModel: OpenModelSettings | null;
}

export interface BuyBoxParseResult {
  buyBox: BuyBox;
  model: string;
  source: 'home' | 'open';
  notes: string;
}

const SYSTEM = [
  'You convert a land buyer\'s plain-English buy box into JSON filters for Texas land parcels.',
  'Reply with ONLY a JSON object, no prose, using exactly these keys:',
  '"useType" one of: industrial, warehouse, data_center, multifamily, self_storage, single_family, any',
  '"acresMin" number or null, "acresMax" number or null',
  '"zoning" short string or null (the zoning/use words the buyer named)',
  '"maxHighwayMiles" number or null',
  '"needsPower" boolean, "needsRail" boolean, "needsWater" boolean, "needsSewer" boolean',
  '"counties" array containing "collin" and/or "dallas" (both when the buyer names the DFW area or no county)',
  '"maxPricePerAcre" number or null (dollars per acre)',
  '"notes" short string naming anything in the request you could not map to a filter.',
  'Use null/false for anything the buyer did not state. Never invent numbers.',
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

/** Validate a model-produced object into a BuyBox, or null when it does not fit the schema. */
export function toBuyBox(raw: unknown): { buyBox: BuyBox; notes: string } | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const notes = typeof obj.notes === 'string' ? obj.notes.slice(0, 300) : '';
  const { notes: _ignored, ...rest } = obj;
  const parsed = BuyBoxSchema.safeParse(rest);
  if (!parsed.success) return null;
  return { buyBox: parsed.data, notes };
}

/**
 * Parse with the home AI server (Qwen) first, then the open model. Returns null when no AI
 * server is configured or every configured server fails / returns unusable output, so the
 * caller can say so honestly and keep the manual form.
 */
export async function parseBuyBox(
  config: BuyBoxAiConfig,
  text: string,
  fetchImpl: FetchLike = fetch,
  onFailure?: (source: 'home' | 'open', error: Error) => void,
): Promise<BuyBoxParseResult | null> {
  const candidates: { source: 'home' | 'open'; settings: OpenModelSettings }[] = [];
  if (config.homeAi) candidates.push({ source: 'home', settings: config.homeAi });
  if (config.openModel) candidates.push({ source: 'open', settings: config.openModel });
  for (const { source, settings } of candidates) {
    try {
      const reply = await chatOpenModel(
        settings,
        {
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: text },
          ],
          maxTokens: 500,
          temperature: 0,
          timeoutMs: 60_000,
        },
        fetchImpl,
      );
      const converted = toBuyBox(extractJsonObject(reply));
      if (!converted) throw new Error('model reply did not contain a usable buy box');
      return { ...converted, model: settings.model, source };
    } catch (error) {
      onFailure?.(source, error as Error);
    }
  }
  return null;
}
