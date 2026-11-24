import { describe, expect, it, vi } from 'vitest';
import { classifyPlanWithAi, extractJsonObject, validAiLines } from './plan-ai';

const settings = { baseUrl: 'https://ai.example.test/v1', apiKey: undefined, model: 'qwen-test' };

function mockFetch(reply: string) {
  return vi.fn(async () => {
    const body = JSON.stringify({ choices: [{ message: { content: reply } }] });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

describe('extractJsonObject', () => {
  it('pulls the first balanced JSON object out of prose', () => {
    expect(extractJsonObject('Here it is: {"lines": []} thanks')).toEqual({ lines: [] });
  });

  it('returns null when there is no JSON', () => {
    expect(extractJsonObject('no json here')).toBeNull();
  });

  it('returns null on unbalanced braces', () => {
    expect(extractJsonObject('{"lines": [')).toBeNull();
  });
});

describe('classifyPlanWithAi', () => {
  it('returns validated AI lines with source and model', async () => {
    const fetchImpl = mockFetch(
      '{"lines": [{"trade": "foundations", "label": "Spread footings", "unit": "LF", "quantity": null, "evidence": "FOOTINGS 24in wide"}]}',
    );
    const result = await classifyPlanWithAi(
      { homeAi: settings, openModel: null },
      'FOOTINGS 24in wide. Slab 4in.',
      'No geometry measured.',
      fetchImpl as never,
    );
    expect(result?.source).toBe('home');
    expect(result?.model).toBe('qwen-test');
    expect(result?.lines).toHaveLength(1);
    expect(result?.lines[0]?.source).toBe('ai');
    expect(result?.lines[0]?.trade).toBe('foundations');
  });

  it('drops lines that fail validation instead of trusting them', async () => {
    const fetchImpl = mockFetch(
      '{"lines": [{"trade": "foundations", "label": "Good line", "unit": "LF", "quantity": null, "evidence": null}, {"trade": "made_up_trade", "label": "Bad line", "unit": "LF", "quantity": null, "evidence": null}]}',
    );
    const result = await classifyPlanWithAi(
      { homeAi: settings, openModel: null },
      'FOOTINGS. Something else.',
      '',
      fetchImpl as never,
    );
    // The whole answer is rejected when it does not match the schema.
    expect(result).toBeNull();
  });

  it('returns null when no AI is configured and sends nothing', async () => {
    const fetchImpl = mockFetch('{"lines": []}');
    const result = await classifyPlanWithAi({ homeAi: null, openModel: null }, 'FOOTINGS.', '', fetchImpl as never);
    expect(result).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('falls back to the open model when the home server fails', async () => {
    const failing = vi.fn(async () => new Response('nope', { status: 500 }));
    const ok = mockFetch('{"lines": []}');
    const fetchImpl = vi.fn(async (url: string) => (url.includes('open.example') ? ok() : failing()));
    const result = await classifyPlanWithAi(
      {
        homeAi: settings,
        openModel: { baseUrl: 'https://open.example/v1', apiKey: undefined, model: 'qwen-open' },
      },
      'FOOTINGS.',
      '',
      fetchImpl as never,
    );
    expect(result?.source).toBe('open');
    expect(result?.model).toBe('qwen-open');
  });

  it('returns null when the model answer has no usable JSON', async () => {
    const fetchImpl = mockFetch('I cannot read this plan.');
    const result = await classifyPlanWithAi({ homeAi: settings, openModel: null }, 'FOOTINGS.', '', fetchImpl as never);
    expect(result).toBeNull();
  });
});

describe('validAiLines', () => {
  it('keeps valid lines and drops the rest', () => {
    const kept = validAiLines([
      { trade: 'roofing', label: 'Shingles', unit: 'sq', quantity: null, source: 'ai', evidence: null, confidence: 0.5 },
      { trade: 'nope', label: 'Bad', unit: 'ea', quantity: null, source: 'ai', evidence: null, confidence: 0.5 },
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.trade).toBe('roofing');
  });
});
