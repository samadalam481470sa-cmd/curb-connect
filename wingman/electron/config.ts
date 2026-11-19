import fs from 'node:fs'
import path from 'node:path'

export type Provider = 'gemini' | 'ollama'

export interface Config {
  provider: Provider | null
  /** Gemini key; empty for Ollama. */
  apiKey: string
  /** Model for the primary provider. */
  model: string
  ollamaUrl: string
  /** Empty when no local model is configured. Also the fallback when the cloud fails. */
  ollamaModel: string
}

let loaded = false
let settingsDirectory = path.join(__dirname, '..')

/**
 * Points settings at another directory. A packaged app reads the per-user data directory instead
 * of the folder next to the binary, which is inside a read-only asar.
 */
export function setSettingsDirectory(directory: string): void {
  settingsDirectory = directory
  loaded = false
}

/** The `.env` that is read, and that the tray's settings item opens. */
export function settingsPath(): string {
  return path.join(settingsDirectory, '.env')
}

/** Written when no settings file exists yet, so the keys are discoverable. */
export function settingsTemplate(): string {
  return [
    '# Wingman settings. Real environment variables win over this file.',
    '# A Gemini key is all that is required; the file is read at startup.',
    'GEMINI_API_KEY=',
    '# GEMINI_MODEL=gemini-2.0-flash',
    '#',
    '# Optional local model, used when the cloud request fails:',
    '# OLLAMA_URL=http://localhost:11434',
    '# OLLAMA_MODEL=llama3.2',
    '#',
    '# Force one provider:',
    '# WINGMAN_PROVIDER=gemini',
    '',
  ].join('\n')
}

/** Reads the settings file once. Real environment variables always win. */
function loadEnv(): void {
  if (loaded) return
  loaded = true

  let raw: string
  try {
    raw = fs.readFileSync(settingsPath(), 'utf8')
  } catch {
    return
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator < 1) continue

    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()
    if (value.length > 1 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

function env(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim()
}

export function getConfig(): Config {
  loadEnv()

  const ollamaUrl = env('OLLAMA_URL', 'http://localhost:11434').replace(/\/+$/, '')
  const apiKey = env('GEMINI_API_KEY')
  const ollamaModel = env('OLLAMA_MODEL')
  const forced = env('WINGMAN_PROVIDER').toLowerCase()
  const wantsGemini = Boolean(apiKey) || forced === 'gemini'

  if (forced === 'ollama' || (!forced && !wantsGemini && ollamaModel)) {
    const model = ollamaModel || 'llama3.2'
    return { provider: 'ollama', apiKey: '', model, ollamaUrl, ollamaModel: model }
  }

  if (wantsGemini) {
    return {
      provider: 'gemini',
      apiKey,
      model: env('GEMINI_MODEL', 'gemini-2.0-flash'),
      ollamaUrl,
      ollamaModel,
    }
  }

  return { provider: null, apiKey: '', model: '', ollamaUrl, ollamaModel }
}

export function describeProvider(): string {
  const config = getConfig()
  if (!config.provider) return 'no provider configured'

  const fallback =
    config.provider === 'gemini' && config.ollamaModel ? ` · fallback ${config.ollamaModel}` : ''
  return `${config.provider} · ${config.model}${fallback}`
}
