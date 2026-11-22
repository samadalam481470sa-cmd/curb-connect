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
