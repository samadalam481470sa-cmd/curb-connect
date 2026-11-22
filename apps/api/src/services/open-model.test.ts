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
