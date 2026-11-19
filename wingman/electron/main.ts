import {
  Menu,
  Tray,
  app,
  clipboard,
  globalShortcut,
  ipcMain,
  nativeImage,
  shell,
  type NativeImage,
  type WebContents,
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { Assistant } from './llm.js'
import { describeProvider, setSettingsDirectory, settingsPath, settingsTemplate } from './config.js'
import { prepareClipboardText } from './clipboard.js'
import { createOverlay, getOverlay, hideOverlay, showOverlay, toggleClickThrough } from './overlay.js'
import { TRAY_ACTIVE_COLOR, TRAY_TEMPLATE_COLOR, drawTrayIcon } from './tray-icon.js'
import { captureRegion, captureWholeDisplay, openScreenPermissionSettings, screenPermission } from './screen.js'

/** Change an accelerator here if one clashes with something you use. */
const SHORTCUTS = {
  toggle: 'CommandOrControl+Shift+Space',
  answerClipboard: 'CommandOrControl+Shift+A',
  readScreen: 'CommandOrControl+Shift+Return',
  selectRegion: 'CommandOrControl+Shift+R',
  clickThrough: 'CommandOrControl+Shift+X',
  hide: 'CommandOrControl+Shift+H',
} as const

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// A packaged app cannot read a .env inside its own asar, so settings live in the per-user
// data directory instead (macOS: ~/Library/Application Support/Wingman, Windows: %APPDATA%\Wingman).
// In development the checkout's wingman/.env is still used.
if (app.isPackaged) setSettingsDirectory(app.getPath('userData'))

const assistant = new Assistant()
let tray: Tray | null = null
let pendingReveal = false

function startAsk(sender: WebContents, id: string, question: string, image?: Buffer): void {
  const send = (channel: string, body: unknown): void => {
    if (!sender.isDestroyed()) sender.send(channel, body)
  }

  // Returns immediately: chunks arrive as 'ai:chunk' events, so the renderer paints the empty
  // bubble first instead of waiting for a complete response. Every event carries the request
  // id, so a late event from a stopped request cannot touch the next answer.
  void assistant.ask(
    { question, image },
    {
      onChunk: (text) => send('ai:chunk', { id, text }),
      onDone: (meta) => send('ai:done', { id, ...meta }),
      onError: (message) => send('ai:error', { id, message }),
      onNotice: (message) => send('ai:notice', { id, message }),
    },
  )
}

function revealForInput(): void {
  showOverlay({ activate: true })?.webContents.send('ui:focus-input')
}

function revealWith(channel: string): void {
  showOverlay({ activate: true })?.webContents.send(channel)
}

/**
 * Answers whatever was copied — no screenshot, no OCR, no desktop upload. The text is prepared
 * in main so the renderer only has to report truncation.
 */
function askFromClipboard(): void {
  const win = showOverlay({ activate: true })
  if (!win) return

  win.webContents.send('ui:ask-clipboard', prepareClipboardText(clipboard.readText()))
  win.webContents.send('ui:focus-input')
}

/**
 * Opens the settings file, creating it from the template on first run. Without this an installed
 * app has no text field for a key, and the file's location is not discoverable.
 */
function openSettingsFile(): void {
  const file = settingsPath()

  if (!fs.existsSync(file)) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, settingsTemplate(), { mode: 0o600 })
    } catch (error) {
      console.error('[wingman] could not create the settings file:', error)
      return
    }
  }

  void shell.openPath(file)
}

function toggleOverlay(): void {
  if (getOverlay()?.isVisible()) hideOverlay()
  else revealForInput()
}

function trayImage(): NativeImage {
  const size = 16
  const template = process.platform === 'darwin'
  const color = template ? TRAY_TEMPLATE_COLOR : TRAY_ACTIVE_COLOR

  const image = nativeImage.createFromBitmap(drawTrayIcon(size, color), { width: size, height: size })
  image.addRepresentation({
    scaleFactor: 2,
    width: size * 2,
    height: size * 2,
    buffer: drawTrayIcon(size * 2, color),
  })
  if (template) image.setTemplateImage(true)

  return image
}

/**
 * The only visible affordance in the app besides the overlay itself: with the dock icon hidden,
 * the taskbar entry skipped and the menu removed, this is how the app is found and quit.
 */
function createTray(): void {
  tray = new Tray(trayImage())
  tray.setToolTip('Wingman')

  const menu = Menu.buildFromTemplate([
    { label: describeProvider(), enabled: false },
    { label: 'Settings file…', click: openSettingsFile },
    { type: 'separator' },
    { label: 'Show / hide overlay', click: toggleOverlay },
    { label: 'Answer clipboard', click: askFromClipboard },
    { label: 'Answer screen', click: () => revealWith('ui:ask-screenshot') },
    { label: 'Select an area', click: () => revealWith('ui:ask-region') },
    { type: 'separator' },
    { label: 'Quit Wingman', click: () => app.quit() },
  ])

  if (process.platform === 'darwin') {
    // On macOS a context menu swallows left clicks, so attach it to right-click only.
    tray.on('click', toggleOverlay)
    tray.on('right-click', () => tray?.popUpContextMenu(menu))
  } else {
    tray.setContextMenu(menu)
    tray.on('click', toggleOverlay)
  }
}

function registerIpc(): void {
  ipcMain.handle(
    'ai:ask',
    async (event, payload?: { text?: string; withScreenshot?: boolean; id?: string }) => {
      const id = payload?.id ?? ''
      const question = (payload?.text ?? '').trim() || 'Answer the question shown on screen.'
      if (!payload?.withScreenshot) {
        startAsk(event.sender, id, question)
        return { ok: true, hasImage: false }
      }

      const capture = await captureWholeDisplay()
      if (!capture.ok) return capture
      startAsk(event.sender, id, question, capture.image)
      return { ok: true, hasImage: true }
    },
  )

  ipcMain.handle('ai:ask-region', async (event, payload?: { text?: string; id?: string }) => {
    const id = payload?.id ?? ''
    const question = (payload?.text ?? '').trim() || 'Answer the question in the selected area.'

    const capture = await captureRegion()
    if (!capture.ok) return capture

    // The selector took focus; hand it back so the panel accepts typing again.
    showOverlay({ activate: true })
    startAsk(event.sender, id, question, capture.image)
    return { ok: true, hasImage: true }
  })

  ipcMain.handle('ai:cancel', () => {
    assistant.cancel()
    return true
  })

  ipcMain.handle('ui:provider', () => describeProvider())
  ipcMain.handle('ui:capabilities', () => ({ screenPermission: screenPermission() }))
  ipcMain.handle('ui:screen-settings', () => {
    openScreenPermissionSettings()
    return true
  })
  ipcMain.handle('ui:hide', () => {
    hideOverlay()
    return true
  })
  ipcMain.handle('ui:quit', () => {
    app.quit()
    return true
  })
}

function bindShortcut(accelerator: string, handler: () => void): void {
  if (!globalShortcut.register(accelerator, handler)) {
    console.warn(`[wingman] shortcut unavailable: ${accelerator}`)
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  if (process.platform === 'darwin' && app.dock) app.dock.hide()

  registerIpc()

  const win = createOverlay(path.join(__dirname, 'preload.js'))
  win.once('ready-to-show', () => {
    // Passive at launch unless a second launch asked for the running app.
    showOverlay({ activate: pendingReveal })
    if (pendingReveal) {
      pendingReveal = false
      win.webContents.send('ui:focus-input')
    }
  })
  win.on('closed', () => app.quit())

  createTray()

  bindShortcut(SHORTCUTS.toggle, toggleOverlay)
  bindShortcut(SHORTCUTS.answerClipboard, askFromClipboard)
  bindShortcut(SHORTCUTS.readScreen, () => revealWith('ui:ask-screenshot'))
  bindShortcut(SHORTCUTS.selectRegion, () => revealWith('ui:ask-region'))
  bindShortcut(SHORTCUTS.clickThrough, toggleClickThrough)
  bindShortcut(SHORTCUTS.hide, hideOverlay)

  app.on('activate', revealForInput)
})

// Launching the app again should surface the copy that is already running.
app.on('second-instance', () => {
  if (getOverlay()) revealForInput()
  else pendingReveal = true
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  tray?.destroy()
  tray = null
})

process.on('unhandledRejection', (reason) => {
  console.error('[wingman] unhandled rejection:', reason)
})
