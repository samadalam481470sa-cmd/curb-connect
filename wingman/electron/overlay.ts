import { BrowserWindow, app, screen, type BrowserWindowConstructorOptions } from 'electron'
import path from 'node:path'

const LEVEL = 'screen-saver' as const

let overlay: BrowserWindow | null = null
let clickThrough = false

export function getOverlay(): BrowserWindow | null {
  return overlay && !overlay.isDestroyed() ? overlay : null
}

export function createOverlay(preloadPath: string): BrowserWindow {
  const existing = getOverlay()
  if (existing) return existing

  const { x, y, width: areaWidth } = screen.getPrimaryDisplay().workArea
  const width = 560
  const height = 440

  const options: BrowserWindowConstructorOptions = {
    width,
    height,
    minWidth: 380,
    minHeight: 240,
    x: Math.round(x + areaWidth - width - 24),
    y: Math.round(y + 24),
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    // Clicks activate the app and still reach the page, so no separate activation hook is
    // needed for the first click on the textarea.
    acceptFirstMouse: true,
    title: 'Wingman',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  }

  // A panel floats over other apps on macOS without taking focus from them.
  if (process.platform === 'darwin') {
    ;(options as { type?: string }).type = 'panel'
  }

  const win = new BrowserWindow(options)
  overlay = win

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html')).catch(() => {
    /* surfaced inside the window by the renderer */
  })

  // Invisible to screen capture for the life of the window: Windows
  // SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE), macOS NSWindowSharingNone. Nothing in
  // this app clears it, so it is set once.
  win.setContentProtection(true)

  // Above the shared app, on every Space including full-screen ones.
  win.setAlwaysOnTop(true, LEVEL, 1)
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })

  // The level is the only part of that which can be lost: leaving the window, another app
  // going full-screen, coming back from a minimised state or changing displays. Re-assert
  // there — never on a timer (isAlwaysOnTop() only reports the flag we set) and never on
  // move/resize, which fire continuously while dragging and flicker.
  const keepOnTop = (): void => {
    if (!win.isDestroyed()) win.setAlwaysOnTop(true, LEVEL, 1)
  }
  win.on('show', keepOnTop)
  win.on('blur', keepOnTop)
  win.on('restore', keepOnTop)
  screen.on('display-metrics-changed', keepOnTop)

  win.on('closed', () => {
    screen.removeListener('display-metrics-changed', keepOnTop)
    overlay = null
  })

  return win
}

export function toggleClickThrough(): boolean {
  const win = getOverlay()
  clickThrough = !clickThrough
  win?.setIgnoreMouseEvents(clickThrough, { forward: true })
  return clickThrough
}

/**
 * Shows and activates the overlay. This is the only place the app is activated.
 *
 * macOS: the app is an accessory (dock icon hidden) and the window is an NSPanel, so the
 * process is activated *before* the panel is ordered front. A panel shown by an inactive
 * accessory app arrives non-key, which is the "overlay is up but I cannot type" symptom.
 * There is no retry timer: a delayed second activation races the user's next click.
 */
export function showOverlay(options: { activate?: boolean } = {}): BrowserWindow | null {
  const win = getOverlay()
  if (!win) return null

  if (options.activate === false) {
    win.showInactive()
    return win
  }

  if (process.platform === 'darwin') {
    app.focus({ steal: true })
  }
  win.show()
  win.focus()
  win.webContents.focus()

  return win
}

export function hideOverlay(): void {
  getOverlay()?.hide()
}
