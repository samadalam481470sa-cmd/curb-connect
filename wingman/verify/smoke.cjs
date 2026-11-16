#!/usr/bin/env node
/**
 * Real-window smoke test. Run on macOS or Windows with:
 *
 *   npm run smoke
 *
 * It launches the actual overlay window (same createOverlay/showOverlay the app uses, same
 * preload, same renderer) with the dock icon hidden on macOS, then checks:
 *
 *   1. the window is created, visible and pinned above other apps
 *   2. the panel becomes the KEY window (the claim that cannot be tested off-device)
 *   3. sendInputEvent text lands in the textarea
 *   4. Enter submits and opens an answer bubble with a streaming caret
 *   5. the window really is unfocused before streaming starts
 *   6. every streamed chunk paints, progressively, while unfocused
 *   7. the done state clears the caret and reports latency
 *
 * Streaming is injected on the same `ai:chunk` / `ai:done` channels the main process uses, so
 * no API key and no provider are involved. This does NOT test screen-share invisibility: that
 * needs a second machine or a recorder, because a capture of your own screen proves nothing.
 *
 * Exit code 0 = everything passed, 1 = at least one check failed.
 */
const path = require('node:path')
const { app, ipcMain } = require('electron')

const results = []
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function record(status, name, detail) {
  results.push({ status, name, detail })
  console.log(`${status}  ${name}${detail ? `  — ${detail}` : ''}`)
}
const pass = (name, detail) => record('PASS', name, detail)
const fail = (name, detail) => record('FAIL', name, detail)

async function waitFor(predicate, timeoutMs = 2500, stepMs = 50) {
  const started = Date.now()
  for (;;) {
    const value = await predicate()
    if (value) return value
    if (Date.now() - started > timeoutMs) return null
    await delay(stepMs)
  }
}

function platformLabel() {
  const version = process.getSystemVersion ? process.getSystemVersion() : ''
  return `${process.platform} ${version} · electron ${process.versions.electron}`.trim()
}

const readLastAssistant = `(() => {
  const rows = document.querySelectorAll('#log .row--assistant');
  const row = rows[rows.length - 1];
  if (!row) return null;
  const body = row.querySelector('.body');
  return { text: body ? body.textContent : '', caret: Boolean(row.querySelector('.caret')) };
})()`

async function run() {
  console.log(`Wingman overlay smoke test · ${platformLabel()}\n`)

  await app.whenReady()

  // Reproduce the app's real configuration: accessory app with no dock icon.
  if (process.platform === 'darwin' && app.dock) app.dock.hide()

  // The renderer talks to these channels; stub them so no provider or network is needed.
  let requestId = ''
  ipcMain.handle('ai:ask', (_event, payload) => {
    requestId = payload && payload.id ? payload.id : ''
    return { ok: true, hasImage: false }
  })
  ipcMain.handle('ai:cancel', () => true)
  ipcMain.handle('ui:provider', () => 'smoke test (no provider)')
  ipcMain.handle('ui:capabilities', () => ({ screenPermission: 'granted' }))
  ipcMain.handle('ui:screen-settings', () => true)
  ipcMain.handle('ui:hide', () => true)

  const overlay = require('../dist-electron/overlay.js')
  const preload = path.join(__dirname, '..', 'dist-electron', 'preload.js')

  const win = overlay.createOverlay(preload)
  const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve))
  const loadTimeout = await Promise.race([loaded.then(() => true), delay(8000).then(() => false)])

  if (!loadTimeout) {
    fail('renderer loads', 'did-finish-load did not fire within 8s')
    return
  }
  pass('renderer loads', platformLabel())

  // Same call a hotkey reveal makes.
  overlay.showOverlay({ activate: true })
  await delay(400)

  if (win.isVisible()) pass('overlay window is visible', `visible=${win.isVisible()}`)
  else fail('overlay window is not visible', `visible=${win.isVisible()}`)

  if (win.isAlwaysOnTop()) pass('overlay is pinned above other apps', `alwaysOnTop=${win.isAlwaysOnTop()}`)
  else fail('overlay is not always-on-top', `alwaysOnTop=${win.isAlwaysOnTop()}`)

  // ---- 2. the key-window claim -------------------------------------------------------
  const becameKey = await waitFor(() => win.isFocused(), 2500)
  if (becameKey) {
    pass('panel becomes the key window (real keystrokes would land)', 'isFocused=true')
  } else {
    fail(
      'panel never becomes the key window — typing would go nowhere',
      `isFocused=false after 2500ms; visible=${win.isVisible()}; alwaysOnTop=${win.isAlwaysOnTop()}; ` +
        `platform=${platformLabel()}; activation policy=${process.platform === 'darwin' ? 'accessory (dock hidden)' : 'n/a'}`,
    )
    console.log('      note: sendInputEvent bypasses OS key routing, so the typing check below can still pass.')
    console.log('      the key-window check above is the one that decides whether real keystrokes land.')
  }

  // ---- 3. typing ----------------------------------------------------------------------
  const typed = 'hello overlay 42'
  const textareaFocused = await win.webContents.executeJavaScript(
    `(() => { const el = document.getElementById('input'); if (!el) return false; el.focus(); el.value = ''; return document.activeElement === el; })()`,
  )

  for (const character of typed) {
    win.webContents.sendInputEvent({ type: 'char', keyCode: character })
    await delay(12)
  }
  await delay(150)

  const typedValue = await win.webContents.executeJavaScript(`document.getElementById('input').value`)
  if (typedValue === typed) {
    pass('sendInputEvent text lands in the textarea', `value="${typedValue}"`)
  } else {
    fail(
      'sendInputEvent text does not land in the textarea',
      `expected "${typed}", got "${typedValue}", textarea focused=${textareaFocused}`,
    )
  }

  // ---- 4. submit + streaming bubble ----------------------------------------------------
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' })

  const bubble = await waitFor(() => win.webContents.executeJavaScript(readLastAssistant), 2500)
  const streaming = Boolean(bubble && bubble.caret)
  if (streaming) {
    pass('Enter submits and opens a streaming answer bubble', 'caret visible before any chunk')
  } else {
    fail('Enter does not open a streaming answer bubble', JSON.stringify(bubble))
  }

  // ---- 5. blur -----------------------------------------------------------------------
  win.blur()
  const lostFocus = await waitFor(() => !win.isFocused(), 1500)
  const domFocused = await win.webContents.executeJavaScript('document.hasFocus()')
  if (lostFocus && domFocused === false) {
    pass('window is unfocused before streaming starts', `isFocused=${win.isFocused()}, document.hasFocus=${domFocused}`)
  } else {
    fail(
      'window did not lose focus, so unfocused rendering was not proven',
      `isFocused=${win.isFocused()}, document.hasFocus=${domFocused}`,
    )
  }

  // ---- 6. stream chunks while unfocused ----------------------------------------------
  const tokens = ['The ', 'answer ', 'streams ', 'in ', 'while ', 'unfocused.']
  const lengths = []

  if (streaming) {
    for (const token of tokens) {
      const previous = lengths.length > 0 ? lengths[lengths.length - 1] : 0
      win.webContents.send('ai:chunk', { id: requestId, text: token })
      // Wait for this chunk to be in the DOM before sending the next one. Reading on a fixed
      // delay races the IPC message and would report a false failure.
      const painted = await waitFor(async () => {
        const current = await win.webContents.executeJavaScript(readLastAssistant)
        return current && current.text.length > previous ? current.text.length : null
      }, 800, 20)
      lengths.push(painted ?? previous)
    }
    win.webContents.send('ai:done', {
      id: requestId,
      firstTokenMs: 70,
      totalMs: tokens.length * 70,
      stopped: false,
      fallback: false,
    })
    await delay(200)
  }

  const final = await win.webContents.executeJavaScript(readLastAssistant)
  const expected = tokens.join('')
  const grewEveryStep =
    lengths.length === tokens.length && lengths.every((length, index) => index === 0 || length > lengths[index - 1])

  if (!streaming) {
    fail('streamed chunks render while unfocused', 'no answer bubble existed to stream into')
  } else if (final && final.text === expected) {
    pass('all streamed chunks render while unfocused', `text="${final.text}"`)
  } else {
    fail('streamed chunks did not render correctly while unfocused', `expected "${expected}", got "${final ? final.text : 'null'}"`)
  }

  if (streaming) {
    if (grewEveryStep) pass('chunks paint progressively, not once at the end', lengths.join(' → '))
    else fail('chunks did not paint progressively', `body lengths after each chunk: ${lengths.join(' → ')}`)
  }

  // ---- 7. done state -----------------------------------------------------------------
  const doneState = streaming
    ? await waitFor(
        () =>
          win.webContents.executeJavaScript(`(() => {
            const rows = document.querySelectorAll('#log .row--assistant');
            const row = rows[rows.length - 1];
            const status = document.getElementById('status').textContent;
            return row && !row.querySelector('.caret') && /answered in/.test(status) ? status : null;
          })()`),
        2000,
      )
    : null

  if (doneState) pass('done state clears the caret and reports latency', doneState)
  else if (streaming) fail('done state not reached', 'caret still present or status line never reported latency')
}

let finished = false

function finish() {
  if (finished) return
  finished = true

  const failures = results.filter((result) => result.status === 'FAIL')
  const passed = results.length - failures.length
  const line = '='.repeat(64)

  console.log(`\n${line}`)
  console.log(`${passed}/${results.length} checks passed · ${platformLabel()}`)
  if (failures.length > 0) {
    console.log('\nFAILED:')
    for (const failure of failures) console.log(`  · ${failure.name}\n    ${failure.detail}`)
    console.log('\nCopy everything above, including this block, back to the chat.')
  }
  console.log(line)

  app.exit(failures.length > 0 ? 1 : 0)
}

const watchdog = setTimeout(() => {
  fail('smoke test timed out', 'the run did not finish within 45s')
  finish()
}, 45000)
watchdog.unref?.()

run()
  .then(finish)
  .catch((error) => {
    fail('smoke test crashed', error && error.stack ? error.stack : String(error))
    finish()
  })

app.on('window-all-closed', () => {
  /* keep the harness alive until it reports */
})
