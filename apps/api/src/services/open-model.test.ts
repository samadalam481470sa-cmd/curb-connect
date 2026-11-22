import { describe, expect, it } from 'vitest';
import { askOpenModel } from './open-model';

describe('open model client', () => {
  it('sends text and a picture in the OpenAI chat format', async () => {
    let sent: { url: string; body: Record<string, unknown>; auth: string | null } | null = null;
    const reply = await askOpenModel(
      { baseUrl: 'https://router.example/v1/', apiKey: 'k', model: 'Qwen/Qwen2.5-VL-7B-Instruct' },
      { text: 'read this', image: { mediaType: 'image/png', data: 'AAAA' } },
      async (url, init) => {
        sent = {
          url,
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
          auth: new Headers(init?.headers).get('authorization'),
        };
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '{"bedrooms":3}' } }] }),
        );
      },
    );
    expect(reply).toBe('{"bedrooms":3}');
    expect(sent!.url).toBe('https://router.example/v1/chat/completions');
    expect(sent!.auth).toBe('Bearer k');
    expect(JSON.stringify(sent!.body)).toContain('data:image/png;base64,AAAA');
  });
  it('fails plainly on an error answer', async () => {
    await expect(
      askOpenModel(
        { baseUrl: 'http://x/v1', apiKey: undefined, model: 'm' },
        { text: 'x', image: null },
        async () => new Response('no', { status: 503 }),
      ),
    ).rejects.toThrow('HTTP 503');
  });
});

describe('vision fallback on the Hugging Face router', () => {
  const hf = { baseUrl: 'https://router.huggingface.co/v1', apiKey: 'k', model: 'Qwen/Qwen2.5-VL-7B-Instruct' };
  const image = { mediaType: 'image/png', data: 'AAAA' };
  const modelOf = (init?: RequestInit) => (JSON.parse(String(init?.body)) as { model: string }).model;

  it('tries the next vision model when one cannot read the picture', async () => {
    const { askOpenModelWithFallback } = await import('./open-model');
    const tried: string[] = [];
    const r = await askOpenModelWithFallback(hf, { text: 'read', image }, async (_u, init) => {
      tried.push(modelOf(init));
      return tried.length < 3 ? new Response('no images', { status: 422 }) : new Response(JSON.stringify({ choices: [{ message: { content: '{"bedrooms":2}' } }] }));
    });
    expect(tried).toEqual(['Qwen/Qwen2.5-VL-7B-Instruct', 'Qwen/Qwen2.5-VL-72B-Instruct', 'google/gemma-3-27b-it']);
    expect(r.model).toBe('google/gemma-3-27b-it');
  });

  it('stops at once on a rejected token, and does not fall back for text or other hosts', async () => {
    const { askOpenModelWithFallback } = await import('./open-model');
    let calls = 0;
    await expect(askOpenModelWithFallback(hf, { text: 'read', image }, async () => { calls += 1; return new Response('bad token', { status: 401 }); })).rejects.toThrow('HTTP 401');
    expect(calls).toBe(1);
    calls = 0;
    await expect(askOpenModelWithFallback(hf, { text: 'read', image: null }, async () => { calls += 1; return new Response('x', { status: 500 }); })).rejects.toThrow();
    expect(calls).toBe(1);
    calls = 0;
    await expect(askOpenModelWithFallback({ ...hf, baseUrl: 'http://localhost:11434/v1' }, { text: 'read', image }, async () => { calls += 1; return new Response('x', { status: 500 }); })).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
