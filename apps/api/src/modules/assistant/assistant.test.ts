import { describe, expect, it } from 'vitest';
import {
  adviseProfessional,
  answerQuestion,
  AssistantUnavailable,
  buildMessages,
  probeModelServer,
} from './assistant';

const home = { baseUrl: 'http://home/v1', apiKey: 'h', model: 'home-model' };
const backup = { baseUrl: 'http://backup/v1', apiKey: 'b', model: 'backup-model' };
const input = { question: 'How long does framing take?', mode: 'home_build' as const, history: [] };

describe('assistant messages', () => {
  it('puts the safety rules and mode first, then history, then the question', () => {
    const history = Array.from({ length: 12 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `turn ${i}`,
    }));
    const messages = buildMessages('next?', 'home_build', history);
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain('Never invent prices');
    expect(messages[0]!.content).toContain('planning and building a house');
    expect(messages).toHaveLength(1 + 8 + 1);
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'next?' });
    expect(messages[1]!.content).toBe('turn 4');
  });
});

describe('answerQuestion', () => {
  it('uses the home server first', async () => {
    const calls: string[] = [];
    const out = await answerQuestion({ home, backup }, input, async (s) => {
      calls.push(s.model);
      return 'About two weeks.';
    });
    expect(calls).toEqual(['home-model']);
    expect(out.source).toBe('home_server');
    expect(out.answer).toBe('About two weeks.');
  });

  it('falls back to the backup model when the home server fails', async () => {
    const failures: unknown[] = [];
    const out = await answerQuestion(
      { home, backup },
      input,
      async (s) => {
        if (s.model === 'home-model') throw new Error('offline');
        return 'Backup answer.';
      },
      (e) => failures.push(e),
    );
    expect(out.source).toBe('backup_model');
    expect(failures).toHaveLength(1);
  });

  it('works with only the backup configured', async () => {
    const out = await answerQuestion({ home: null, backup }, input, async () => 'ok');
    expect(out.source).toBe('backup_model');
  });

  it('says so when nothing is configured or everything fails', async () => {
    await expect(
      answerQuestion({ home: null, backup: null }, input, async () => 'x'),
    ).rejects.toBeInstanceOf(AssistantUnavailable);
    await expect(
      answerQuestion({ home, backup }, input, async () => {
        throw new Error('down');
      }),
    ).rejects.toBeInstanceOf(AssistantUnavailable);
  });
});

describe('estimate review mode and tool context (item 28)', () => {
  it('adds estimate-review rules and the tool context to the system prompt', () => {
    const messages = buildMessages('Check my lines', 'estimate_review', [], 'Roof estimator');
    expect(messages[0]!.content).toContain('reviewing an estimate');
    expect(messages[0]!.content).toContain('Never invent a price');
    expect(messages[0]!.content).toContain('Where the reader is asking from: Roof estimator');
  });

  it('omits the context line when no context is given', () => {
    const messages = buildMessages('Hi', 'general', []);
    expect(messages[0]!.content).not.toContain('Where the reader is asking from');
  });

  it('passes context through answerQuestion to the model', async () => {
    let seen = '';
    const out = await answerQuestion(
      { home, backup: null },
      { question: 'Anything missing?', mode: 'estimate_review', history: [], context: 'HVAC estimator, 3 ton' },
      async (_s, messages) => {
        seen = messages[0]!.content;
        return 'Check the line set.';
      },
    );
    expect(out.answer).toBe('Check the line set.');
    expect(seen).toContain('HVAC estimator, 3 ton');
  });
});

describe('adviseProfessional', () => {
  it('flags safety-sensitive topics only', () => {
    expect(adviseProfessional('Can I remove a load-bearing wall?', 'Maybe.')).toBe(true);
    expect(adviseProfessional('Best shingle color?', 'Pick what suits the house.')).toBe(false);
    expect(adviseProfessional('Hi', 'You will need a permit for that.')).toBe(true);
  });
});

describe('probeModelServer', () => {
  it('is online only for an OK answer', async () => {
    expect(await probeModelServer(home, async () => new Response('{}'))).toBe(true);
    expect(await probeModelServer(home, async () => new Response('no', { status: 502 }))).toBe(
      false,
    );
    expect(
      await probeModelServer(home, async () => {
        throw new Error('refused');
      }),
    ).toBe(false);
  });
});
