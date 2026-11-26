import type { HouseModelSummary } from '@fieldline/contracts';
import { describe, expect, it } from 'vitest';
import { AssistantUnavailable } from './assistant';
import { answerHouseModelQuestion, renderHouseModelSummary } from './houseModel';

const model: HouseModelSummary = {
  lengthFt: 50,
  widthFt: 32,
  stories: 1,
  bedrooms: 3,
  bathrooms: 2,
  garage: 'two_car',
  conditionedAreaSqFt: 1600,
  floors: [
    {
      level: 1,
      rooms: [
        { name: 'Primary bedroom', kind: 'primary', w: 14, h: 12, areaSqFt: 168 },
        { name: 'Bath 1', kind: 'bath', w: 8, h: 12, areaSqFt: 96 },
      ],
    },
  ],
};

const home = { baseUrl: 'http://home', apiKey: undefined, model: 'qwen-home' };
const backup = { baseUrl: 'http://backup', apiKey: 'k', model: 'qwen-backup' };

describe('renderHouseModelSummary', () => {
  it('renders the program and room schedule as plain text', () => {
    const text = renderHouseModelSummary(model);
    expect(text).toContain('50 ft long × 32 ft wide');
    expect(text).toContain('3 bedrooms, 2 bathrooms');
    expect(text).toContain('Primary bedroom (primary): 14 × 12 ft, 168 sq ft');
  });
});

describe('answerHouseModelQuestion', () => {
  it('answers through the home server first and passes the summary', async () => {
    const seen: string[] = [];
    const result = await answerHouseModelQuestion(
      { home, backup },
      { question: 'How big is the primary bedroom?', history: [], model },
      async (settings, messages) => {
        seen.push(settings.model, messages[0]!.content);
        return 'The primary bedroom is 14 by 12 ft, 168 sq ft.';
      },
    );
    expect(result.source).toBe('home_server');
    expect(result.answer).toContain('168');
    expect(seen[1]).toContain('Primary bedroom (primary)');
  });

  it('falls back to the backup model when the home server fails', async () => {
    const result = await answerHouseModelQuestion(
      { home, backup },
      { question: 'How many baths?', history: [], model },
      async (settings) => {
        if (settings.model === 'qwen-home') throw new Error('down');
        return 'Two bathrooms.';
      },
    );
    expect(result.source).toBe('backup_model');
  });

  it('throws AssistantUnavailable when no AI is configured', async () => {
    await expect(
      answerHouseModelQuestion(
        { home: null, backup: null },
        { question: 'How many baths?', history: [], model },
        async () => 'never',
      ),
    ).rejects.toBeInstanceOf(AssistantUnavailable);
  });
});
