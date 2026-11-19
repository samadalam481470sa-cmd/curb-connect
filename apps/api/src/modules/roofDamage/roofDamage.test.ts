import { describe, expect, it } from 'vitest';
import { analyzeRoofPhoto, AnalysisUnavailable, anthropicVisionProvider, DamageReport, extractJson, type VisionProvider } from './analyzer';
import { estimateRepairCost } from './costing';
import { sniffMediaType } from './index';

const IMAGE = { mediaType: 'image/jpeg' as const, base64: 'AAAA' };
const VALID = {
  imageQuality: 'good',
  overallCondition: 'moderate',
  findings: [
    {
      type: 'missing_shingles',
      severity: 'moderate',
      location: 'upper-left slope near ridge',
      description: 'Two shingle tabs missing, exposing underlayment.',
      confidence: 0.8,
      suggestedRepair: 'Replace missing shingles and check nails.',
    },
  ],
  limitations: ['Cannot see decking from this angle.'],
};

function scripted(replies: string[]): VisionProvider & { calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  return {
    calls,
    async complete({ user }) {
      calls.push(user);
      return replies[Math.min(i++, replies.length - 1)]!;
    },
  };
}

describe('extractJson', () => {
  it('reads raw JSON, fenced JSON and JSON surrounded by prose', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(extractJson('Here you go: {"a":3} thanks')).toEqual({ a: 3 });
  });

  it('throws when no object is present', () => {
    expect(() => extractJson('no json here')).toThrow(SyntaxError);
    expect(() => extractJson('} backwards {')).toThrow(SyntaxError);
  });
});

describe('DamageReport schema', () => {
  it('accepts a valid report', () => {
    expect(DamageReport.parse(VALID).findings).toHaveLength(1);
  });

  it('rejects unknown damage types, out-of-range confidence and oversized lists', () => {
    const badType = { ...VALID, findings: [{ ...VALID.findings[0], type: 'alien_damage' }] };
    expect(DamageReport.safeParse(badType).success).toBe(false);
    const badConfidence = { ...VALID, findings: [{ ...VALID.findings[0], confidence: 1.5 }] };
    expect(DamageReport.safeParse(badConfidence).success).toBe(false);
    const tooMany = { ...VALID, findings: Array.from({ length: 31 }, () => VALID.findings[0]) };
    expect(DamageReport.safeParse(tooMany).success).toBe(false);
  });
});

describe('analyzeRoofPhoto', () => {
  it('returns the validated report from a well-formed reply', async () => {
    const provider = scripted([JSON.stringify(VALID)]);
    const report = await analyzeRoofPhoto(provider, IMAGE);
    expect(report.overallCondition).toBe('moderate');
    expect(provider.calls).toHaveLength(1);
  });

  it('retries once with the validation error, then succeeds', async () => {
    const provider = scripted(['{"imageQuality":"great"}', JSON.stringify(VALID)]);
    const report = await analyzeRoofPhoto(provider, IMAGE);
    expect(report.findings).toHaveLength(1);
    expect(provider.calls[1]).toMatch(/previous reply was rejected/);
  });

  it('reports unavailable after two malformed replies rather than inventing results', async () => {
    const provider = scripted(['not json', 'still not json']);
    await expect(analyzeRoofPhoto(provider, IMAGE)).rejects.toBeInstanceOf(AnalysisUnavailable);
  });
});

describe('anthropicVisionProvider', () => {
  const okBody = (text: string) => new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });

  it('sends the image and key to the Messages API and returns the text block', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return okBody('{"ok":true}');
    }) as unknown as typeof fetch;
    const provider = anthropicVisionProvider({ apiKey: 'test-key', model: 'claude-opus-5-5', fetchImpl });
    const text = await provider.complete({ system: 's', user: 'u', image: IMAGE });
    expect(text).toBe('{"ok":true}');
    expect(captured!.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');
    const body = JSON.parse(String(captured!.init.body));
    expect(body.model).toBe('claude-opus-5-5');
    expect(body.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
  });

  it('maps HTTP errors, network failures and empty replies to AnalysisUnavailable', async () => {
    const httpError = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    await expect(anthropicVisionProvider({ apiKey: 'k', model: 'm', fetchImpl: httpError }).complete({ system: '', user: '', image: IMAGE }))
      .rejects.toBeInstanceOf(AnalysisUnavailable);

    const network = (async () => {
      throw new Error('socket hang up');
    }) as unknown as typeof fetch;
    await expect(anthropicVisionProvider({ apiKey: 'k', model: 'm', fetchImpl: network }).complete({ system: '', user: '', image: IMAGE }))
      .rejects.toThrow(/could not be reached/);

    const empty = (async () => new Response(JSON.stringify({ content: [] }), { status: 200 })) as unknown as typeof fetch;
    await expect(anthropicVisionProvider({ apiKey: 'k', model: 'm', fetchImpl: empty }).complete({ system: '', user: '', image: IMAGE }))
      .rejects.toThrow(/no text/);
  });
});

describe('estimateRepairCost', () => {
  it('computes exact integer cents from the roofer’s area and rate, with contingency', () => {
    const est = estimateRepairCost({ repairAreaSqFt: 250.4, ratePerSqFtCents: 850, contingencyPercent: 10 });
    expect(est.repairAreaSqFt).toBe(250);
    expect(est.subtotalCents).toBe(212_500);
    expect(est.contingencyCents).toBe(21_250);
    expect(est.totalCents).toBe(233_750);
    expect(Number.isInteger(est.totalCents)).toBe(true);
    expect(est.basis).toMatch(/user-supplied/);
  });

  it('defaults contingency to 10% through the schema and rejects invalid inputs', () => {
    expect(estimateRepairCost({ repairAreaSqFt: 100, ratePerSqFtCents: 1000, contingencyPercent: 10 }).totalCents).toBe(110_000);
    expect(() => estimateRepairCost({ repairAreaSqFt: 0, ratePerSqFtCents: 1000, contingencyPercent: 10 })).toThrow();
    expect(() => estimateRepairCost({ repairAreaSqFt: 10, ratePerSqFtCents: 1.5, contingencyPercent: 10 })).toThrow();
    expect(() => estimateRepairCost({ repairAreaSqFt: 10, ratePerSqFtCents: 100, contingencyPercent: 80 })).toThrow();
  });
});

describe('sniffMediaType', () => {
  it('recognizes JPEG, PNG and WebP by their leading bytes', () => {
    expect(sniffMediaType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMediaType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffMediaType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'binary'))).toBe('image/webp');
  });

  it('rejects anything else, such as a text file renamed to .jpg', () => {
    expect(sniffMediaType(Buffer.from('hello world, not an image'))).toBeNull();
    expect(sniffMediaType(Buffer.from([0xff]))).toBeNull();
  });
});
