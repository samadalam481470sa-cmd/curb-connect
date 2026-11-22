// Open-model AI over any OpenAI-compatible chat API: Hugging Face's router, OpenRouter, Together,
// a self-hosted vLLM, or Ollama on your own computer. Default model: Qwen2.5-VL 7B Instruct
// (Apache-2.0), which reads both text and pictures. Used when ANTHROPIC_API_KEY is not set.
export interface OpenModelSettings {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
}

export interface OpenModelInput {
  text: string;
  /** A picture to read (PNG, JPEG, WebP) as base64, or null. PDFs are sent as their text. */
  image: { mediaType: string; data: string } | null;
  maxTokens?: number;
  timeoutMs?: number;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export async function askOpenModel(
  settings: OpenModelSettings,
  input: OpenModelInput,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const content: unknown[] = [{ type: 'text', text: input.text }];
  if (input.image) {
    content.push({
      type: 'image_url',
      image_url: { url: `data:${input.image.mediaType};base64,${input.image.data}` },
    });
  }
  const res = await fetchImpl(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: input.maxTokens ?? 800,
      temperature: 0,
      messages: [{ role: 'user', content: input.image ? content : input.text }],
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? 90_000),
  });
  if (!res.ok) throw new Error(`open model HTTP ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
  const reply = body.choices?.[0]?.message?.content;
  if (typeof reply !== 'string' || !reply.trim()) throw new Error('open model gave no answer');
  return reply;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatInput {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

/** Multi-turn chat over the same OpenAI-compatible API. Throws on any failure or empty answer. */
export async function chatOpenModel(
  settings: OpenModelSettings,
  input: ChatInput,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const res = await fetchImpl(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(settings.apiKey ? { authorization: `Bearer ${settings.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: input.maxTokens ?? 900,
      temperature: input.temperature ?? 0.3,
      messages: input.messages,
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? 60_000),
  });
  if (!res.ok) throw new Error(`model HTTP ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
  const reply = body.choices?.[0]?.message?.content;
  if (typeof reply !== 'string' || !reply.trim()) throw new Error('model gave no answer');
  return reply.trim();
}

/**
 * Vision models Hugging Face's free router serves (checked 2026-11-22), tried in order when the
 * chosen model cannot read a picture. Each is served by a different set of providers, so one
 * provider that takes no images, or is down, does not stop photo reading.
 */
export const HF_VISION_FALLBACKS = ['Qwen/Qwen2.5-VL-7B-Instruct', 'Qwen/Qwen2.5-VL-72B-Instruct', 'google/gemma-3-27b-it'] as const;

/**
 * Like askOpenModel, but for a picture on Hugging Face's router it tries the vision fallbacks
 * after the chosen model. A rejected token (401/403) stops at once: other models would fail too.
 * Returns the answer and the model that gave it.
 */
export async function askOpenModelWithFallback(
  settings: OpenModelSettings,
  input: OpenModelInput,
  fetchImpl: FetchLike = fetch,
): Promise<{ reply: string; model: string }> {
  const onHfRouter = /^https:\/\/router\.huggingface\.co\//.test(settings.baseUrl);
  const models = input.image && onHfRouter ? [...new Set([settings.model, ...HF_VISION_FALLBACKS])] : [settings.model];
  let last: Error = new Error('open model gave no answer');
  for (const model of models) {
    try {
      return { reply: await askOpenModel({ ...settings, model }, input, fetchImpl), model };
    } catch (err) {
      last = err as Error;
      if (/HTTP 40[13]\b/.test(last.message)) break;
    }
  }
  throw last;
}
