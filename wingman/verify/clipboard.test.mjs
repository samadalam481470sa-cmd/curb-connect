/** Pure checks for the clipboard-text preparation; no Electron needed. */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { prepareClipboardText, CLIPBOARD_TEXT_LIMIT } = require('../dist-electron/clipboard.js')

const results = []
function check(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail })
}

const padded = prepareClipboardText('\n\n  reverse this linked list  \n\n')
check('trims surrounding whitespace', padded.text === 'reverse this linked list', JSON.stringify(padded.text))
check('short text is not truncated', padded.truncated === false, `truncated=${padded.truncated}`)
check('reports the trimmed length', padded.originalLength === 24, `originalLength=${padded.originalLength}`)

const crlf = prepareClipboardText('line one\r\nline two\r\nline three')
check('normalises Windows newlines', crlf.text === 'line one\nline two\nline three', JSON.stringify(crlf.text))

const exact = prepareClipboardText('x'.repeat(CLIPBOARD_TEXT_LIMIT))
check(
  'text exactly at the limit is not truncated',
  exact.truncated === false && exact.text.length === CLIPBOARD_TEXT_LIMIT,
  `length=${exact.text.length}, truncated=${exact.truncated}`,
)

const long = prepareClipboardText('y'.repeat(CLIPBOARD_TEXT_LIMIT + 500))
check('caps text over the limit', long.text.length === CLIPBOARD_TEXT_LIMIT, `length=${long.text.length}`)
check('flags truncation', long.truncated === true, `truncated=${long.truncated}`)
check(
  'reports how much was originally there',
  long.originalLength === CLIPBOARD_TEXT_LIMIT + 500,
  `originalLength=${long.originalLength}`,
)

const empty = prepareClipboardText('   \n\t  ')
check(
  'whitespace-only clipboard is empty',
  empty.text === '' && empty.truncated === false && empty.originalLength === 0,
  JSON.stringify(empty),
)

const custom = prepareClipboardText('abcdef', 3)
check('honours a custom limit', custom.text === 'abc' && custom.truncated === true, JSON.stringify(custom))

const failed = results.filter((result) => !result.pass)
console.log(
  results.map((result) => `${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`).join('\n'),
)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) process.exit(1)
