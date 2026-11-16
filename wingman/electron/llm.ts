import { getConfig, type Config, type Provider } from './config.js'

export interface AskOptions {
  question: string
  /** JPEG bytes for a screen question. */
  image?: Buffer
}

export interface AskMeta {
  firstTokenMs: number
  totalMs: number
  /** True when the user stopped the answer. */
  stopped: boolean
  /** True when the local model answered because the cloud request failed. */
  fallback: boolean
}

export interface AskEvents {
  onChunk: (text: string) => void
  onDone: (meta: AskMeta) => void
  onError: (message: string) => void
  /** Non-fatal status, e.g. that the local model answered instead. */
  onNotice?: (message: string) => void
}

interface Turn {
  role: 'user' | 'assistant'
  text: string
}

interface RequestSpec {
  url: string
  init: RequestInit
  extract: (payload: unknown) => string
}

const TEMPERATURE = 0.4
const MAX_TOKENS = 800
const HISTORY_TURNS = 8

/** The whole ask, retries included, must finish inside this or it is reported as a timeout. */
const DEFAULT_BUDGET_MS = 25000
const DEFAULT_RETRY_DELAYS_MS = [600, 1800]

class ProviderError extends Error {
  readonly status: number | undefined
  readonly retryAfterMs: number | undefined
  readonly retryable: boolean

  constructor(message: string, options: { status?: number; retryAfterMs?: number; retryable?: boolean } = {}) {
    super(message)
    this.name = 'ProviderError'
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs
    this.retryable = options.retryable ?? (options.status === 429 || (options.status ?? 0) >= 500)
  }
}

/**
 * Answers stream straight into the chat, so the prompt only has to keep the model on the
 * question. The reference implementation asked for a JSON envelope
 * (problem_statement / context / suggested_responses / reasoning) and then asked a second
 * time for the answer: two round trips, and a model that narrates an analysis instead of
 * answering.
 */
const SYSTEM_PROMPT = [
  'You are Wingman, a live assistant that gives the user the answer they need right now.',
  '',
  'Rules:',
  '1. Answer the question that is actually being asked. Put the direct answer in the first line.',
  '2. Never restate the question. Never describe this app, the model, the tools or any process.',
  '   Do not emit "problem statement", "context", "reasoning" or suggested-response sections.',
  '3. Be short. An ordinary question gets one to four sentences. Code gets the code plus one',
  '   line about how to run it.',
  '4. If the input is a screenshot, read the question off it and answer that question. Do not',
  '   describe the screenshot unless the user asked for a description.',
  '5. If the request is genuinely unclear, ask one short clarifying question and stop.',
].join('\n')

export class Assistant {
  private controller: AbortController | null = null
  private history: Turn[] = []
  private readonly budgetMs: number
  private readonly retryDelaysMs: number[]

  constructor(options: { budgetMs?: number; retryDelaysMs?: number[] } = {}) {
    this.budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
  }

  cancel(): void {
    this.controller?.abort()
    this.controller = null
  }

  async ask(options: AskOptions, events: AskEvents): Promise<void> {
    this.cancel()

    const config = getConfig()
    if (!config.provider) {
      events.onError('No AI provider configured. Put GEMINI_API_KEY (or OLLAMA_MODEL) in wingman/.env and restart.')
      return
    }
    if (config.provider === 'gemini' && !config.apiKey) {
      events.onError('GEMINI_API_KEY is empty in wingman/.env.')
      return
    }

    const controller = new AbortController()
    this.controller = controller

    const startedAt = Date.now()
    const deadline = startedAt + this.budgetMs
    const canRetry = (): boolean => answer === ''

    let firstTokenMs = 0
    let answer = ''
    let usedFallback = false

    const emit = (text: string): void => {
      if (!text) return
      if (firstTokenMs === 0) firstTokenMs = Date.now() - startedAt
      answer += text
      events.onChunk(text)
    }
    const meta = (stopped: boolean): AskMeta => ({
      firstTokenMs,
      totalMs: Date.now() - startedAt,
      stopped,
      fallback: usedFallback,
    })

    try {
      try {
        await this.run(config.provider, config, options, emit, controller.signal, deadline, canRetry)
      } catch (error) {
        // The local model only helps if nothing was shown yet and the user did not stop us:
        // falling back mid-answer would restart the text they are already reading.
        const canFallBack =
          config.provider === 'gemini' &&
          Boolean(config.ollamaModel) &&
          answer === '' &&
          !controller.signal.aborted
        if (!canFallBack) throw error

        usedFallback = true
        events.onNotice?.(`Cloud request failed — answering with local ${config.ollamaModel} instead.`)
        await this.run('ollama', config, options, emit, controller.signal, deadline, canRetry, 0)
      }

      this.remember(options.question, answer)
      events.onDone(meta(false))
    } catch (error) {
      if (controller.signal.aborted) {
        events.onDone(meta(true))
        return
      }
      events.onError(error instanceof Error ? error.message : String(error))
    } finally {
      if (this.controller === controller) this.controller = null
    }
  }

  private async run(
    provider: Provider,
    config: Config,
    options: AskOptions,
    emit: (text: string) => void,
    signal: AbortSignal,
    deadline: number,
    canRetry: () => boolean,
    retries = this.retryDelaysMs.length,
  ): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await streamOnce(provider, config, options, this.history, emit, signal, deadline)
        return
      } catch (error) {
        if (signal.aborted) throw error

        const retryable = error instanceof ProviderError ? error.retryable : true
        const backoff = this.retryDelaysMs[attempt]
        const budgetLeft = deadline - Date.now()
        if (!retryable || !canRetry() || backoff === undefined || attempt >= retries || budgetLeft <= 0) {
          throw error
        }

        const retryAfter = error instanceof ProviderError ? (error.retryAfterMs ?? 0) : 0
        await sleep(Math.min(Math.max(backoff, retryAfter) + Math.random() * 150, budgetLeft), signal)
      }
    }
  }

  private remember(question: string, answer: string): void {
    this.history.push({ role: 'user', text: question })
    if (answer.trim()) this.history.push({ role: 'assistant', text: answer })
    if (this.history.length > HISTORY_TURNS) this.history = this.history.slice(-HISTORY_TURNS)
  }
}

async function streamOnce(
  provider: Provider,
  config: Config,
  options: AskOptions,
  history: Turn[],
  emit: (text: string) => void,
  signal: AbortSignal,
  deadline: number,
): Promise<void> {
  const remaining = deadline - Date.now()
  if (remaining <= 0) {
    throw new ProviderError(`${provider} request timed out before it started`, { retryable: false })
  }

  const timeout = AbortSignal.timeout(remaining)
  const combined = AbortSignal.any([signal, timeout])

  const spec =
    provider === 'gemini'
      ? geminiRequest(config, options, history, combined)
      : ollamaRequest(config, options, history, combined)

  let response: Response
  try {
    response = await fetch(spec.url, spec.init)
  } catch (error) {
    if (signal.aborted) throw error
    if (timeout.aborted) throw new ProviderError(`${provider} request timed out`, { retryable: false })
    throw new ProviderError(
      `${provider} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      { retryable: true },
    )
  }

  if (!response.ok) throw await providerFailure(provider, response)

  try {
    // Gemini sends Server-Sent Events ("data: {...}") and Ollama sends NDJSON; both are one
    // JSON object per line, so a prefix strip is the only difference.
    await readLines(response, (line) => {
      const payload = line.startsWith('data:') ? line.slice(5).trim() : line.trim()
      if (!payload || payload === '[DONE]') return

      let parsed: unknown
      try {
        parsed = JSON.parse(payload)
      } catch {
        return
      }

      emit(spec.extract(parsed))
    })
  } catch (error) {
    if (signal.aborted) throw error
    if (timeout.aborted) throw new ProviderError(`${provider} stalled mid-answer`, { retryable: false })
    throw error
  }
}

function geminiRequest(
  config: Config,
  options: AskOptions,
  history: Turn[],
  signal: AbortSignal,
): RequestSpec {
  const parts: Array<Record<string, unknown>> = [{ text: options.question }]
  if (options.image?.byteLength) {
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: options.image.toString('base64') } })
  }

  return {
    url:
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}` +
      ':streamGenerateContent?alt=sse',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.apiKey },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          ...history.map((turn) => ({
            role: turn.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: turn.text }],
          })),
          { role: 'user', parts },
        ],
        generationConfig: { temperature: TEMPERATURE, maxOutputTokens: MAX_TOKENS, candidateCount: 1 },
      }),
    },
    extract: (payload) => {
      const candidates = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
        .candidates
      return (candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('')
    },
  }
}

function ollamaRequest(
  config: Config,
  options: AskOptions,
  history: Turn[],
  signal: AbortSignal,
): RequestSpec {
  return {
    url: `${config.ollamaUrl}/api/chat`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: config.ollamaModel || config.model,
        stream: true,
        options: { temperature: TEMPERATURE, num_predict: MAX_TOKENS },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...history,
          {
            role: 'user',
            content: options.question,
            ...(options.image?.byteLength ? { images: [options.image.toString('base64')] } : {}),
          },
        ],
      }),
    },
    extract: (payload) => {
      const data = payload as { message?: { content?: string }; response?: string }
      return data.message?.content ?? data.response ?? ''
    },
  }
}

/** Hands complete lines to the caller so one reader serves both providers. */
async function readLines(response: Response, onLine: (line: string) => void): Promise<void> {
  if (!response.body) throw new Error('Empty response body from provider')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      onLine(buffer.slice(0, newline).replace(/\r$/, ''))
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
    }
  }

  if (buffer.trim()) onLine(buffer.trim())
}

async function providerFailure(provider: Provider, response: Response): Promise<ProviderError> {
  let detail = ''
  try {
    detail = (await response.text()).slice(0, 300)
  } catch {
    detail = ''
  }

  const retryAfter = Number(response.headers.get('retry-after'))
  return new ProviderError(
    `${provider} ${response.status} ${response.statusText}${detail ? ` — ${detail}` : ''}`,
    {
      status: response.status,
      retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : undefined,
    },
  )
}

/** Resolves early when the request is cancelled, so a stop never waits out a backoff. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }

    const timer = setTimeout(done, ms)
    function done(): void {
      signal.removeEventListener('abort', done)
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}
