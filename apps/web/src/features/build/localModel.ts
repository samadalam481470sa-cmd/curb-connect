// Free, open AI that runs inside the browser on the user's own computer (WebGPU), no key and no
// server: Qwen2.5 1.5B Instruct (Apache-2.0, by Alibaba's Qwen team) through WebLLM. It downloads
// once (about 1 GB, cached by the browser) and then works offline.
//
// The model never changes the house by itself. It only rewrites an open-ended request into the
// command bar's own plain commands ("2400 sqft 4 bed 3 bath two story"), which houseCommands.ts
// then applies with exact math. So a wrong guess shows up as a normal, undoable command.
import type { MLCEngineInterface } from '@mlc-ai/web-llm';

export const LOCAL_MODEL_ID = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
export const LOCAL_MODEL_LABEL = 'Qwen2.5 1.5B (open model, runs on this computer)';

export type LocalProgress = (text: string, fraction: number) => void;

let engine: Promise<MLCEngineInterface> | null = null;

export function localModelSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

export function loadLocalModel(onProgress?: LocalProgress): Promise<MLCEngineInterface> {
  if (!engine) {
    engine = import('@mlc-ai/web-llm')
      .then(({ CreateMLCEngine }) =>
        CreateMLCEngine(LOCAL_MODEL_ID, {
          initProgressCallback: (p) => onProgress?.(p.text, p.progress),
        }),
      )
      .catch((error: unknown) => {
        engine = null;
        throw error;
      });
  }
  return engine;
}

const SYSTEM = `You turn a contractor's request about a house into short commands for a house builder app.
Allowed commands (use only these, separated by "; "):
- "<N> sqft <B> bed <T> bath" to build a whole house of a size
- "add a bedroom", "remove a bedroom", "add a bath", "remove a bath", "<B> bed", "<T> bath"
- "no garage", "1 car garage", "2 car garage"
- "one story", "two story"
- "roof <R>/12", "<H> ft walls", "studs 16" or "studs 24", "waste <P>%"
- "<L> x <W>" for length by width in feet, "eaves <E> ft"
- "make it cheaper"
- "undo"
Reply with the commands only, on one line. If the request has nothing to do with the house, reply NONE.
Examples:
"I need a starter home for a family of four, nothing fancy" -> 1600 sqft 3 bed 2 bath; make it cheaper
"big two level place with room for three cars" -> two story; 2 car garage
"steeper roof and taller ceilings" -> roof 10/12; 10 ft walls`;

/** Rewrites a request into commands, or null when the model has nothing to offer. */
export async function requestToCommands(
  request: string,
  onProgress?: LocalProgress,
): Promise<string[] | null> {
  const model = await loadLocalModel(onProgress);
  const reply = await model.chat.completions.create({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: request.slice(0, 600) },
    ],
    temperature: 0,
    max_tokens: 80,
  });
  const line = (reply.choices[0]?.message?.content ?? '').split('\n')[0]?.trim() ?? '';
  if (!line || /^none\b/i.test(line)) return null;
  const commands = line
    .replace(/^["'`]|["'`]$/g, '')
    .split(/;|\|/)
    .map((c) => c.trim())
    .filter((c) => c.length > 1 && c.length < 80)
    .slice(0, 8);
  return commands.length ? commands : null;
}
