/**
 * The packaged app reads its settings from a writable directory rather than the app bundle, so the
 * path, precedence and template are worth pinning down without launching Electron.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { getConfig, setSettingsDirectory, settingsPath, settingsTemplate } = require('../dist-electron/config.js')

const results = []
function check(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail })
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wingman-config-'))
const file = path.join(directory, '.env')

function reset() {
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_MODEL
  delete process.env.OLLAMA_MODEL
  delete process.env.WINGMAN_PROVIDER
  setSettingsDirectory(directory)
}

function write(contents) {
  fs.writeFileSync(file, contents, 'utf8')
  setSettingsDirectory(directory)
}

// 1. Path resolution — the packaged app points this at its user data directory.
setSettingsDirectory(directory)
check('settings live in the given directory', settingsPath() === file, settingsPath())

// 2. No file at all: no provider, and no throw.
reset()
fs.rmSync(file, { force: true })
check('a missing settings file means no provider', getConfig().provider === null, JSON.stringify(getConfig()))
check('the missing file is not created by reading', fs.existsSync(file) === false)

// 3. A key in the file is picked up.
write('GEMINI_API_KEY=from-file\nGEMINI_MODEL=model-from-file\n')
const fromFile = getConfig()
check('reads the key from the settings file', fromFile.apiKey === 'from-file', fromFile.apiKey)
check('reads the model from the settings file', fromFile.model === 'model-from-file', fromFile.model)

// 4. A real environment variable wins over the file.
process.env.GEMINI_API_KEY = 'from-env'
setSettingsDirectory(directory)
check('environment wins over the file', getConfig().apiKey === 'from-env', getConfig().apiKey)

// 5. Quoting and comments.
reset()
write('# a comment\n\nGEMINI_API_KEY="quoted key"\n')
check('strips quotes around a value', getConfig().apiKey === 'quoted key', getConfig().apiKey)

// 6. Comments alone configure nothing.
reset()
write('# GEMINI_API_KEY=nope\n\n')
check('ignores commented-out keys', getConfig().provider === null, JSON.stringify(getConfig()))

// 7. Provider forcing still works from the file.
write('WINGMAN_PROVIDER=ollama\n')
const forced = getConfig()
check('honours WINGMAN_PROVIDER from the file', forced.provider === 'ollama', forced.provider)
check('falls back to the default local model', forced.model === 'llama3.2', forced.model)

// 8. The template actually names the keys the app reads.
const template = settingsTemplate()
check('template documents the Gemini key', template.includes('GEMINI_API_KEY='), 'GEMINI_API_KEY=')
check('template documents the Ollama fallback', template.includes('OLLAMA_MODEL'), 'OLLAMA_MODEL')
check('template documents provider forcing', template.includes('WINGMAN_PROVIDER'), 'WINGMAN_PROVIDER')

fs.rmSync(directory, { recursive: true, force: true })

const failed = results.filter((result) => !result.pass)
console.log(
  results.map((result) => `${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`).join('\n'),
)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) process.exit(1)
