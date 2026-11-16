/**
 * Runs the compiled electron/overlay.js with a fake `electron` module so the window decisions
 * can be asserted without a display server. It covers what a real screen share would expose:
 * repeated calls that re-order the window (flicker), capture protection, and the macOS
 * activation ordering that decides whether keystrokes land.
 */
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'

const require = createRequire(import.meta.url)

const calls = []
const appFocusCalls = []

class FakeWebContents {
  constructor() {
    this.focusCount = 0
  }

  focus() {
    this.focusCount += 1
    calls.push('webContents.focus')
  }

  send() {}
}

class FakeBrowserWindow extends EventEmitter {
  constructor(options) {
    super()
    this.options = options
    this.destroyed = false
    this.visible = false
    this.alwaysOnTop = Boolean(options.alwaysOnTop)
    this.level = null
    this.counts = {
      setContentProtection: 0,
      setAlwaysOnTop: 0,
      setVisibleOnAllWorkspaces: 0,
      setIgnoreMouseEvents: 0,
      show: 0,
      showInactive: 0,
      focus: 0,
      hide: 0,
    }
    this.webContents = new FakeWebContents()
  }

  isDestroyed() {
    return this.destroyed
  }

  isVisible() {
    return this.visible
  }

  isAlwaysOnTop() {
    return this.alwaysOnTop
  }

  setContentProtection() {
    this.counts.setContentProtection += 1
    calls.push('setContentProtection')
  }

  setAlwaysOnTop(value, level) {
    this.counts.setAlwaysOnTop += 1
    this.alwaysOnTop = value
    this.level = level
    calls.push('setAlwaysOnTop')
  }

  setVisibleOnAllWorkspaces() {
    this.counts.setVisibleOnAllWorkspaces += 1
    calls.push('setVisibleOnAllWorkspaces')
  }

  setIgnoreMouseEvents(on) {
    this.counts.setIgnoreMouseEvents += 1
    this.ignoreMouse = on
  }

  show() {
    this.counts.show += 1
    this.visible = true
    calls.push('show')
  }

  showInactive() {
    this.counts.showInactive += 1
    this.visible = true
    calls.push('showInactive')
  }

  focus() {
    this.counts.focus += 1
    calls.push('focus')
  }

  hide() {
    this.counts.hide += 1
    this.visible = false
  }

  loadFile() {
    return Promise.resolve()
  }
}

const fakeScreen = Object.assign(new EventEmitter(), {
  getPrimaryDisplay: () => ({
    id: 1,
    size: { width: 1440, height: 900 },
    workArea: { x: 0, y: 0, width: 1440, height: 900 },
  }),
})

const fakeElectron = {
  BrowserWindow: FakeBrowserWindow,
  app: {
    focus: (options) => {
      appFocusCalls.push(options)
      calls.push('app.focus')
    },
  },
  screen: fakeScreen,
}

// The macOS branch is read at import time.
Object.defineProperty(process, 'platform', { value: 'darwin' })

const intervals = []
const timeouts = []
const realSetInterval = globalThis.setInterval
const realClearInterval = globalThis.clearInterval
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
globalThis.setInterval = (fn, ms) => {
  const handle = { fn, ms, cleared: false }
  intervals.push(handle)
  return handle
}
globalThis.clearInterval = (handle) => {
  if (handle) handle.cleared = true
}
globalThis.setTimeout = (fn, ms) => {
  const handle = { fn, ms, cleared: false }
  timeouts.push(handle)
  return handle
}
globalThis.clearTimeout = (handle) => {
  if (handle) handle.cleared = true
}

const Module = require('node:module')
const realLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'electron') return fakeElectron
  return realLoad.call(this, request, ...rest)
}

const { createOverlay, getOverlay, showOverlay, hideOverlay, toggleClickThrough } = require(
  '../dist-electron/overlay.js',
)

const results = []
function check(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail })
}

const win = createOverlay('/tmp/preload.js')

check('macOS panel window', win.options.type === 'panel', `type=${win.options.type}`)
check('out of the taskbar', win.options.skipTaskbar === true, `skipTaskbar=${win.options.skipTaskbar}`)
check('accepts the first click', win.options.acceptFirstMouse === true, `acceptFirstMouse=${win.options.acceptFirstMouse}`)
check(
  'renderer is not background-throttled',
  win.options.webPreferences.backgroundThrottling === false,
  `backgroundThrottling=${win.options.webPreferences.backgroundThrottling}`,
)
check(
  'capture protection is applied once at creation',
  win.counts.setContentProtection === 1,
  `setContentProtection=${win.counts.setContentProtection}`,
)
check('pinned with the screen-saver level', win.level === 'screen-saver', `level=${win.level}`)
check(
  'Spaces set once at creation',
  win.counts.setVisibleOnAllWorkspaces === 1,
  `setVisibleOnAllWorkspaces=${win.counts.setVisibleOnAllWorkspaces}`,
)

// Dragging and resizing fire continuously; focus changes come and go.
for (let index = 0; index < 25; index += 1) {
  win.emit('move')
  win.emit('resize')
  win.emit('focus')
  win.emit('blur')
}

check(
  'repeated events never re-apply protection or Spaces',
  win.counts.setContentProtection === 1 && win.counts.setVisibleOnAllWorkspaces === 1,
  `protection=${win.counts.setContentProtection}, spaces=${win.counts.setVisibleOnAllWorkspaces}`,
)
check(
  'level is re-asserted only on show/blur/restore',
  win.counts.setAlwaysOnTop === 1 + 25,
  `setAlwaysOnTop=${win.counts.setAlwaysOnTop} after 25 rounds (1 at creation + 25 blurs)`,
)

// A level lost while away must come back on the next real event.
const beforeRecovery = win.counts.setAlwaysOnTop
win.alwaysOnTop = false
win.emit('show')
check(
  'a show event restores a lost level',
  win.counts.setAlwaysOnTop === beforeRecovery + 1 && win.alwaysOnTop === true,
  `setAlwaysOnTop ${beforeRecovery} -> ${win.counts.setAlwaysOnTop}`,
)

// Activation: activate the process, then show, then focus the window and the page.
calls.length = 0
showOverlay({ activate: true })
const order = calls.filter((entry) => ['app.focus', 'show', 'focus', 'webContents.focus'].includes(entry))
check(
  'activation order is app.focus -> show -> win.focus -> webContents.focus',
  JSON.stringify(order) === JSON.stringify(['app.focus', 'show', 'focus', 'webContents.focus']),
  order.join(' -> '),
)
check('app is activated with steal', appFocusCalls.at(-1)?.steal === true, JSON.stringify(appFocusCalls.at(-1)))
check('page is focused for typing', win.webContents.focusCount === 1, `focusCount=${win.webContents.focusCount}`)

// Launch path stays passive so it never steals focus from a call.
calls.length = 0
hideOverlay()
showOverlay({ activate: false })
check(
  'passive show neither activates nor focuses',
  !calls.includes('app.focus') && !calls.includes('focus') && calls.includes('showInactive'),
  calls.join(' -> '),
)

check(
  'click-through toggles and reaches the window',
  toggleClickThrough() === true &&
    win.ignoreMouse === true &&
    toggleClickThrough() === false &&
    win.ignoreMouse === false &&
    win.counts.setIgnoreMouseEvents === 2,
  `setIgnoreMouseEvents=${win.counts.setIgnoreMouseEvents}`,
)

win.emit('closed')
check('closing clears the singleton', getOverlay() === null && showOverlay() === null, `overlay=${getOverlay()}`)

// No deferred work at all: a timer that fires after the user clicked elsewhere would steal
// focus back, and polling isAlwaysOnTop() cannot see a level lost to a full-screen switch.
check(
  'no timer is ever scheduled',
  intervals.length === 0 && timeouts.length === 0,
  `intervals=${intervals.length} timeouts=${timeouts.length}`,
)

Module._load = realLoad
globalThis.setInterval = realSetInterval
globalThis.clearInterval = realClearInterval
globalThis.setTimeout = realSetTimeout
globalThis.clearTimeout = realClearTimeout

const failed = results.filter((result) => !result.pass)
console.log(
  results.map((result) => `${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`).join('\n'),
)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) process.exit(1)
