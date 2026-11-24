import { describe, expect, it, vi } from 'vitest';
import { extractJsonObject, parseBuyBox, toBuyBox } from './buybox-ai';

const settings = { baseUrl: 'http://home-ai.local/v1', apiKey: undefined, model: 'qwen2.5:14b-instruct' };

const jsonReply = (body: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content: body } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('extractJsonObject', () => {
  it('pulls the first balanced object out of prose', () => {
    expect(extractJsonObject('Here you go: {"a": {"b": 1}} done')).toEqual({ a: { b: 1 } });
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('{"a": "} not end"}')).toEqual({ a: '} not end' });
  });
});

describe('toBuyBox', () => {
  it('validates against the schema and keeps notes separate', () => {
    const out = toBuyBox({
      useType: 'industrial', acresMin: 50, acresMax: null, counties: ['dallas'],
      maxPricePerAcre: 50000, notes: 'flood risk not mapped',
    });
    expect(out?.buyBox.useType).toBe('industrial');
    expect(out?.buyBox.counties).toEqual(['dallas']);
    expect(out?.notes).toContain('flood');
  });
  it('rejects unusable output instead of guessing', () => {
    expect(toBuyBox({ useType: 'castle' })).toBeNull();
    expect(toBuyBox('nope')).toBeNull();
    expect(toBuyBox(null)).toBeNull();
  });
});

describe('parseBuyBox', () => {
  it('returns null when no AI server is configured (manual form stays)', async () => {
    const fetchImpl = vi.fn();
    await expect(parseBuyBox({ homeAi: null, openModel: null }, '50 acres industrial', fetchImpl)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('parses through the home Qwen server', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonReply('{"useType":"industrial","acresMin":50,"acresMax":null,"zoning":null,"maxHighwayMiles":1,"needsPower":true,"needsWater":false,"needsSewer":false,"counties":["dallas"],"maxPricePerAcre":50000,"notes":""}'),
    );
    const out = await parseBuyBox({ homeAi: settings, openModel: null }, 'industrial 50+ acres near highway in Dallas under $50k/acre', fetchImpl);
    expect(out?.source).toBe('home');
    expect(out?.model).toBe('qwen2.5:14b-instruct');
    expect(out?.buyBox.acresMin).toBe(50);
    expect(out?.buyBox.maxPricePerAcre).toBe(50000);
  });
  it('falls back to the open model when the home server fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce(jsonReply('{"useType":"warehouse","counties":["collin"]}'));
    const out = await parseBuyBox(
      { homeAi: settings, openModel: { ...settings, baseUrl: 'https://router.example/v1', model: 'Qwen/Qwen2.5-VL-7B-Instruct' } },
      'warehouse in Collin',
      fetchImpl,
    );
    expect(out?.source).toBe('open');
    expect(out?.buyBox.useType).toBe('warehouse');
  });
  it('returns null when the model output is not a usable buy box', async () => {
    const fetchImpl = vi.fn(async () => jsonReply('I cannot help with that.'));
    await expect(parseBuyBox({ homeAi: settings, openModel: null }, 'land please', fetchImpl)).resolves.toBeNull();
  });
});
