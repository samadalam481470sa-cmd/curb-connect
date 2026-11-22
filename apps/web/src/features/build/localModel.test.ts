import { describe, expect, it, vi } from 'vitest';

vi.mock('@mlc-ai/web-llm', () => ({
  CreateMLCEngine: async () => ({
    chat: {
      completions: {
        create: async ({ messages }: { messages: { content: string }[] }) => ({
          choices: [
            {
              message: {
                content: /weather/.test(messages[1]!.content)
                  ? 'NONE'
                  : '"2000 sqft 4 bed 3 bath; two story; 2 car garage"\nextra line',
              },
            },
          ],
        }),
      },
    },
  }),
}));

import { requestToCommands } from './localModel';

describe('open model on this computer', () => {
  it('turns a request into house commands', async () => {
    expect(await requestToCommands('big family home with room for two cars')).toEqual([
      '2000 sqft 4 bed 3 bath',
      'two story',
      '2 car garage',
    ]);
  });
  it('returns null for requests about something else', async () => {
    expect(await requestToCommands('what is the weather')).toBeNull();
  });
});
