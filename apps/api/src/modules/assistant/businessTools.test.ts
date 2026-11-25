// Business Search tools: routing, honest "none recorded" answers, AI-not-connected state.
// Pure unit tests — no database, no network. The DB handlers are single scoped SELECTs;
// their SQL is tenant-scoped by construction (tenantTx + explicit orgId filter).
import { describe, expect, it } from 'vitest';
import {
  answerBusinessSearch,
  buildBusinessMessages,
  BusinessSearchRequestSchema,
  BusinessSearchResponseSchema,
  formatBusinessAnswer,
  formatMoney,
  monthRange,
  pickBusinessTools,
  type BusinessToolResult,
} from './businessTools';

function result(partial: Partial<BusinessToolResult> & { tool: BusinessToolResult['tool'] }): BusinessToolResult {
  return {
    label: partial.tool,
    rowCount: 0,
    truncated: false,
    summary: 'none',
    rows: [],
    totalMinor: null,
    currency: 'USD',
    ...partial,
  };
}

const NOVEMBER = monthRange('2026-11');

describe('monthRange', () => {
  it('builds UTC month bounds and a plain label', () => {
    const range = monthRange('2026-11');
    expect(range.key).toBe('2026-11');
    expect(range.label).toBe('November 2026');
    expect(range.start.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('defaults to the current month', () => {
    const range = monthRange(undefined, new Date('2026-11-24T17:00:00Z'));
    expect(range.key).toBe('2026-11');
  });
});

describe('formatMoney', () => {
  it('formats minor units as dollars and passes null through', () => {
    expect(formatMoney(123456)).toBe('$1,234.56');
    expect(formatMoney(null)).toBeNull();
  });
});

describe('pickBusinessTools', () => {
  it('routes the reel question to signed contracts', () => {
    expect(pickBusinessTools('How many have signed this month?')).toEqual(['signed_this_month']);
  });

  it('routes each question kind to its tool', () => {
    expect(pickBusinessTools('What open quotes do we have?')).toEqual(['open_quotes']);
    expect(pickBusinessTools('How is the pipeline looking?')).toEqual(['pipeline_value']);
    expect(pickBusinessTools('Show jobs by status')).toEqual(['jobs_by_status']);
    expect(pickBusinessTools('What invoices are outstanding?')).toEqual(['outstanding_invoices']);
  });

  it('runs every tool when no keyword matches', () => {
    expect(pickBusinessTools('How is business going?')).toEqual([
      'signed_this_month',
      'open_quotes',
      'pipeline_value',
      'jobs_by_status',
      'outstanding_invoices',
    ]);
  });
});

describe('formatBusinessAnswer', () => {
  it('says "none recorded" with the scope instead of presenting 0 as a total', () => {
    const empty = result({
      tool: 'signed_this_month',
      label: 'Signed this month',
      summary: 'No signed contracts recorded in November 2026 for your company.',
    });
    const answer = formatBusinessAnswer([empty], NOVEMBER);
    expect(answer).toContain('No signed contracts recorded in November 2026');
    expect(answer).not.toContain('$0');
  });

  it('quotes real figures from the tool summaries', () => {
    const signed = result({
      tool: 'signed_this_month',
      label: 'Signed this month',
      rowCount: 2,
      summary: '2 contracts signed in November 2026, worth $48,500.00 in total.',
      totalMinor: 4850000,
      rows: [
        { number: 'C-1', contractValueMinor: 2500000 },
        { number: 'C-2', contractValueMinor: 2350000 },
      ],
    });
    expect(formatBusinessAnswer([signed], NOVEMBER)).toContain(
      '2 contracts signed in November 2026, worth $48,500.00 in total.',
    );
  });
});

describe('buildBusinessMessages', () => {
  it('tells the model to answer only from the data and never invent', () => {
    const messages = buildBusinessMessages('How many signed?', [], NOVEMBER);
    expect(messages[0]!.content).toContain('Answer ONLY from the business data below');
    expect(messages[0]!.content).toContain('never invent a figure');
    expect(messages[1]!.content).toContain('How many signed?');
  });
});

describe('answerBusinessSearch', () => {
  const home = { baseUrl: 'http://home/v1', apiKey: 'h', model: 'home-model' };
  const results = [
    result({
      tool: 'signed_this_month',
      label: 'Signed this month',
      rowCount: 1,
      summary: '1 contract signed in November 2026, worth $25,000.00 in total.',
      totalMinor: 2500000,
      rows: [{ number: 'C-1', contractValueMinor: 2500000 }],
    }),
  ];

  it('returns the direct counts with aiConnected false when no AI is configured', async () => {
    const out = await answerBusinessSearch({
      question: 'How many signed?',
      results,
      range: NOVEMBER,
      models: { home: null, backup: null },
      chat: async () => {
        throw new Error('must not be called');
      },
    });
    expect(out.aiConnected).toBe(false);
    expect(out.source).toBe('data_only');
    expect(out.answer).toContain('1 contract signed in November 2026');
    expect(out.sources).toEqual([
      {
        tool: 'signed_this_month',
        label: 'Signed this month',
        rowCount: 1,
        summary: '1 contract signed in November 2026, worth $25,000.00 in total.',
      },
    ]);
  });

  it('uses the home server first when one is connected', async () => {
    const out = await answerBusinessSearch({
      question: 'How many signed?',
      results,
      range: NOVEMBER,
      models: { home, backup: null },
      chat: async (settings) => `Answered by ${settings.model}.`,
    });
    expect(out.aiConnected).toBe(true);
    expect(out.source).toBe('home_server');
    expect(out.model).toBe('home-model');
    expect(out.answer).toBe('Answered by home-model.');
  });

  it('falls back to the direct counts when every model fails, and says so', async () => {
    const out = await answerBusinessSearch({
      question: 'How many signed?',
      results,
      range: NOVEMBER,
      models: { home, backup: null },
      chat: async () => {
        throw new Error('down');
      },
    });
    expect(out.source).toBe('data_only');
    expect(out.answer).toContain('1 contract signed in November 2026');
    expect(out.answer).toContain('AI summary was unavailable');
  });
});

describe('business search schemas', () => {
  it('accepts a question with an optional YYYY-MM month and rejects a bad month', () => {
    expect(
      BusinessSearchRequestSchema.parse({ question: 'How many signed?' }),
    ).toEqual({ question: 'How many signed?' });
    expect(
      BusinessSearchRequestSchema.parse({ question: 'How many signed?', month: '2026-11' }).month,
    ).toBe('2026-11');
    expect(() =>
      BusinessSearchRequestSchema.parse({ question: 'How many signed?', month: 'Nov 2026' }),
    ).toThrow();
    expect(() => BusinessSearchRequestSchema.parse({ question: 'x' })).toThrow();
  });

  it('parses a full response with sources', () => {
    const parsed = BusinessSearchResponseSchema.parse({
      answer: '1 contract signed.',
      aiConnected: false,
      source: 'data_only',
      model: '',
      disclaimer: 'AI answers can be wrong.',
      sources: [
        {
          tool: 'signed_this_month',
          label: 'Signed this month',
          rowCount: 1,
          summary: '1 contract signed in November 2026.',
        },
      ],
    });
    expect(parsed.sources).toHaveLength(1);
  });
});
