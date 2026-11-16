/**
 * Drives the compiled Assistant against a stubbed fetch: no network, no Electron, no provider.
 * Covers the behaviour a live call depends on — retry/backoff, the overall budget, stopping,
 * and falling back to the local model instead of dying.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { Assistant } = require('../dist-electron/llm.js')

const results = []
function check(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail })
}

// Node unrefs the timer behind AbortSignal.timeout(), so a test waiting on a request that only
// ends by timeout can let the event loop drain and exit with an unsettled await. This watchdog
// keeps the loop alive and turns a hang into a loud failure instead of exit code 13.
const watchdog = setTimeout(() => {
  console.log('FAIL  the test run hung and was stopped after 20s')
  process.exit(1)
}, 20000)

const encoder = new TextEncoder()

function geminiStream(texts) {
  const body = texts
    .map((text) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`)
    .join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function ollamaStream(texts) {
  const body = texts.map((text) => `${JSON.stringify({ message: { content: text } })}\n`).join('')
  return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } })
}

function setEnv({ gemini = 'test-key', ollama = 'llama-test' } = {}) {
  if (gemini) process.env.GEMINI_API_KEY = gemini
  else delete process.env.GEMINI_API_KEY
  if (ollama) process.env.OLLAMA_MODEL = ollama
  else delete process.env.OLLAMA_MODEL
  process.env.GEMINI_MODEL = 'gemini-test'
  process.env.OLLAMA_URL = 'http://localhost:11434'
  delete process.env.WINGMAN_PROVIDER
}

function collect(assistant, question) {
  const state = { chunks: [], notices: [], meta: null, error: null }
  const finished = assistant.ask(
    { question },
    {
      onChunk: (text) => state.chunks.push(text),
      onDone: (meta) => {
        state.meta = meta
      },
      onError: (message) => {
        state.error = message
      },
      onNotice: (message) => state.notices.push(message),
    },
  )
  return { state, finished }
}

// 1. A 429 is retried and the retry succeeds.
setEnv()
let calls = 0
globalThis.fetch = async () => {
  calls += 1
  if (calls === 1) return new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } })
  return geminiStream(['Hello ', 'there'])
}
{
  const assistant = new Assistant({ retryDelaysMs: [5], budgetMs: 5000 })
  const { state, finished } = collect(assistant, 'hi')
  await finished
  check('retries a 429 and then succeeds', calls === 2, `fetch calls=${calls}`)
  check('streams the retried answer', state.chunks.join('') === 'Hello there', JSON.stringify(state.chunks))
  check('reports success after a retry', state.meta !== null && state.error === null, JSON.stringify(state.meta))
}

// 2. 5xx exhausts the retries and reports the failure (no fallback configured).
setEnv({ ollama: null })
calls = 0
globalThis.fetch = async () => {
  calls += 1
  return new Response('upstream down', { status: 503 })
}
{
  const assistant = new Assistant({ retryDelaysMs: [5], budgetMs: 5000 })
  const { state, finished } = collect(assistant, 'hi')
  await finished
  check('gives up after the retry budget', calls === 2, `fetch calls=${calls} (1 attempt + 1 retry)`)
  check('surfaces a 503 as an error', /503/.test(state.error ?? ''), state.error)
}

// 3. A failing cloud call falls back to the local model.
setEnv()
const urls = []
globalThis.fetch = async (url) => {
  urls.push(String(url))
  if (String(url).includes('generativelanguage')) return new Response('boom', { status: 500 })
  return ollamaStream(['local ', 'answer'])
}
{
  const assistant = new Assistant({ retryDelaysMs: [5], budgetMs: 5000 })
  const { state, finished } = collect(assistant, 'hi')
  await finished
  check('falls back to Ollama when the cloud fails', state.chunks.join('') === 'local answer', JSON.stringify(state.chunks))
  check('marks the answer as a fallback', state.meta?.fallback === true, JSON.stringify(state.meta))
  check('tells the user the local model answered', state.notices.length === 1, JSON.stringify(state.notices))
  check(
    'the fallback used the Ollama endpoint',
    urls.some((url) => url.includes('/api/chat')),
    urls.join(' | '),
  )
}

// 4. No fallback when no local model is configured.
setEnv({ ollama: null })
calls = 0
globalThis.fetch = async () => {
  calls += 1
  return new Response('boom', { status: 500 })
}
{
  const assistant = new Assistant({ retryDelaysMs: [5], budgetMs: 5000 })
  const { state, finished } = collect(assistant, 'hi')
  await finished
  check('reports an error when there is nothing to fall back to', /500/.test(state.error ?? ''), state.error)
  check('did not call a second provider', calls === 2, `fetch calls=${calls}`)
}

// 5. Stopping mid-answer returns what arrived, marked as stopped.
setEnv({ ollama: null })
globalThis.fetch = async (_url, init) => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'partial' }] } }] })}\n\n`),
      )
      // Stream stays open, like a model still generating.
      init.signal.addEventListener('abort', () => {
        try {
          controller.error(new Error('aborted'))
        } catch {
          /* already closed */
        }
      })
    },
  })
  return new Response(body, { status: 200 })
}
{
  const assistant = new Assistant({ retryDelaysMs: [5], budgetMs: 5000 })
  const { state, finished } = collect(assistant, 'hi')
  await new Promise((resolve) => setTimeout(resolve, 60))
  assistant.cancel()
  await finished
  check('stop keeps the partial answer', state.chunks.join('') === 'partial', JSON.stringify(state.chunks))
  check('stop is reported as stopped, not an error', state.meta?.stopped === true && state.error === null, JSON.stringify(state.meta))
}

// 6. The overall budget aborts a request that never answers.
setEnv({ ollama: null })
globalThis.fetch = (_url, init) =>
  new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')))
  })
{
  const assistant = new Assistant({ retryDelaysMs: [5], budgetMs: 150 })
  const started = Date.now()
  const { state, finished } = collect(assistant, 'hi')
  const keepAlive = setInterval(() => {}, 25)
  await finished
  clearInterval(keepAlive)
  const elapsed = Date.now() - started
  check('times out instead of hanging forever', /timed out/i.test(state.error ?? ''), state.error)
  check('honours the budget', elapsed < 1000, `${elapsed}ms for a 150ms budget`)
}

// 7. A failure after tokens have arrived must not restart the answer.
setEnv({ ollama: null })
calls = 0
globalThis.fetch = async () => {
  calls += 1
  let sent = false
  const body = new ReadableStream({
    // pull(), not start(): the chunk must be read before the connection drops, otherwise the
    // queue is discarded and this would test "fails before showing anything" instead.
    pull(controller) {
      if (!sent) {
        sent = true
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'half' }] } }] })}\n\n`),
        )
        return
      }
      controller.error(new Error('connection reset'))
    },
  })
  return new Response(body, { status: 200 })
}
{
  const assistant = new Assistant({ retryDelaysMs: [5, 5], budgetMs: 5000 })
  const { state, finished } = collect(assistant, 'hi')
  await finished
  check('does not retry once text has been shown', calls === 1, `fetch calls=${calls}`)
  check('keeps the partial text and reports the failure', state.chunks.join('') === 'half' && state.error !== null, state.error)
}

clearTimeout(watchdog)

const failed = results.filter((result) => !result.pass)
console.log(
  results.map((result) => `${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`).join('\n'),
)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) process.exit(1)
