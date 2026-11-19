// Roof damage photo analysis. A vision LLM looks at one photo and returns structured findings. The
// output is validated against a strict schema, retried once with the validation error if malformed,
// and otherwise reported as unavailable. Findings are visual observations for a roofer to confirm
// on site: they are not an inspection, an engineering assessment or a warranty decision.
import { z } from 'zod';

export const DAMAGE_TYPES = [
  'missing_shingles',
  'cracked_or_curling_shingles',
  'granule_loss',
  'flashing_damage',
  'ponding_water',
  'wind_damage',
  'hail_impact',
  'rot_or_decking_damage',
  'gutter_damage',
  'penetration_or_vent_damage',
  'moss_or_algae',
  'other',
] as const;

export const DamageReport = z.object({
  imageQuality: z.enum(['good', 'poor', 'unusable']),
  overallCondition: z.enum(['no_visible_damage', 'minor', 'moderate', 'severe', 'unable_to_assess']),
  findings: z
    .array(
      z.object({
        type: z.enum(DAMAGE_TYPES),
        severity: z.enum(['minor', 'moderate', 'severe']),
        location: z.string().min(1).max(200),
        description: z.string().min(1).max(500),
        confidence: z.number().min(0).max(1),
        suggestedRepair: z.string().min(1).max(300),
      }),
    )
    .max(30),
  limitations: z.array(z.string().max(300)).max(10),
});
export type DamageReport = z.infer<typeof DamageReport>;

export const SYSTEM_PROMPT = `You are a roofing inspection assistant reviewing ONE photo of a residential roof or roof damage.
Report only what is visible. Do not guess about areas outside the frame, the underlayment, decking or
interior. If the photo is too dark, blurry, far away or not of a roof, set imageQuality or
overallCondition accordingly and explain in limitations. Every finding needs a confidence from 0 to 1.
Respond with ONLY a JSON object with keys: imageQuality (good|poor|unusable), overallCondition
(no_visible_damage|minor|moderate|severe|unable_to_assess), findings (array of {type, severity
(minor|moderate|severe), location, description, confidence, suggestedRepair}), limitations (array of strings).
type must be one of: ${DAMAGE_TYPES.join(', ')}.`;

export interface ImageInput {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
}

/** Abstraction over the vision model so tests and other providers can be swapped in. */
export interface VisionProvider {
  complete(input: { system: string; user: string; image: ImageInput }): Promise<string>;
}

export class AnalysisUnavailable extends Error {}

/** Pull the first JSON object out of a model reply, tolerating code fences and prose. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new SyntaxError('No JSON object in model reply');
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Ask the model for a report. A malformed reply is sent back once with the validation error. A
 * second failure throws AnalysisUnavailable so the caller can say so rather than inventing results.
 */
export async function analyzeRoofPhoto(
  provider: VisionProvider,
  image: ImageInput,
): Promise<DamageReport> {
  let feedback = '';
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reply = await provider.complete({
      system: SYSTEM_PROMPT,
      user: `Analyze this photo of a roof.${feedback}`,
      image,
    });
    try {
      return DamageReport.parse(extractJson(reply));
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'invalid';
      feedback = ` Your previous reply was rejected: ${lastError.slice(0, 300)}. Return only the JSON object.`;
    }
  }
  throw new AnalysisUnavailable(`Model output failed validation twice: ${lastError.slice(0, 200)}`);
}

/**
 * Anthropic Messages API vision provider. Uses fetch (no SDK). The key and model come from config;
 * with no key this provider is not constructed and the route reports analysis as unavailable.
 */
export function anthropicVisionProvider(options: {
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): VisionProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async complete({ system, user, image }) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 45_000);
      try {
        const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': options.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: options.model,
            max_tokens: 1500,
            system,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
                  { type: 'text', text: user },
                ],
              },
            ],
          }),
        });
        if (!res.ok) throw new AnalysisUnavailable(`Vision provider returned HTTP ${res.status}`);
        const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
        const text = body.content?.find((b) => b.type === 'text')?.text;
        if (!text) throw new AnalysisUnavailable('Vision provider returned no text');
        return text;
      } catch (err) {
        if (err instanceof AnalysisUnavailable) throw err;
        throw new AnalysisUnavailable('Vision provider could not be reached');
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
