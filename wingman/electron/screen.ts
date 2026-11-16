import {
  BrowserWindow,
  app,
  desktopCapturer,
  ipcMain,
  screen,
  shell,
  systemPreferences,
  type Display,
  type NativeImage,
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { toPixelRegion, type NormalizedRegion } from './region.js'

export type ScreenPermission = 'granted' | 'required' | 'denied'

export type CaptureResult =
  | { ok: true; image: Buffer }
  | { ok: false; reason: 'screen-permission' | 'capture-failed' | 'cancelled' }

/** Above this the upload is re-encoded smaller; a native 5K JPEG still fits comfortably. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

export function screenPermission(): ScreenPermission {
  if (process.platform !== 'darwin') return 'granted'

  const status = systemPreferences.getMediaAccessStatus('screen')
  if (status === 'granted') return 'granted'
  return status === 'denied' || status === 'restricted' ? 'denied' : 'required'
}

export function openScreenPermissionSettings(): void {
  if (process.platform !== 'darwin') return
  void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
}

function displayUnderCursor(): Display {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}

/**
 * Native-resolution capture of the display under the pointer. `thumbnailSize` is requested at
 * the display's pixel size so nothing is downscaled before it reaches the model.
 */
async function captureDisplay(display: Display): Promise<NativeImage | null> {
  const scale = display.scaleFactor || 1
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * scale),
      height: Math.round(display.size.height * scale),
    },
  })

  const source = sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) return null
  return source.thumbnail
}

function encode(image: NativeImage): Buffer {
  const jpeg = image.toJPEG(82)
  if (jpeg.byteLength <= MAX_UPLOAD_BYTES) return jpeg

  const factor = Math.sqrt(MAX_UPLOAD_BYTES / jpeg.byteLength)
  return image.resize({ width: Math.round(image.getSize().width * factor) }).toJPEG(78)
}

/** Empty thumbnails are how macOS reports a missing Screen Recording grant. */
function failureReason(permission: ScreenPermission): CaptureResult {
  return { ok: false, reason: permission === 'granted' ? 'capture-failed' : 'screen-permission' }
}

export async function captureWholeDisplay(): Promise<CaptureResult> {
  const permission = screenPermission()
  if (permission === 'denied') return { ok: false, reason: 'screen-permission' }

  const image = await captureDisplay(displayUnderCursor())
  return image ? { ok: true, image: encode(image) } : failureReason(permission)
}

let selecting = false

export async function captureRegion(): Promise<CaptureResult> {
  // A second region request while the selector is up would stack a second selector window.
  if (selecting) return { ok: false, reason: 'cancelled' }

  const permission = screenPermission()
  if (permission === 'denied') return { ok: false, reason: 'screen-permission' }

  const display = displayUnderCursor()
  const image = await captureDisplay(display)
  if (!image) return failureReason(permission)

  selecting = true
  const region = await selectRegion(display, image).finally(() => {
    selecting = false
  })
  if (!region) return { ok: false, reason: 'cancelled' }

  const pixels = toPixelRegion(region, image.getSize().width, image.getSize().height)
  if (!pixels) return { ok: false, reason: 'cancelled' }

  return { ok: true, image: encode(image.crop(pixels)) }
}

/**
 * Freezes the capture into a full-display selector window, so the crop maps to the pixels that
 * were actually captured and the selector can never appear inside the screenshot.
 */
async function selectRegion(display: Display, image: NativeImage): Promise<NormalizedRegion | null> {
  const previewFile = path.join(app.getPath('temp'), `wingman-select-${Date.now()}.jpg`)
  const preview = image.getSize().width > 2400 ? image.resize({ width: 2400 }) : image
  fs.writeFileSync(previewFile, preview.toJPEG(74))

  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload-select.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })

  // A selector showing a frozen desktop must not leak through a screen share either.
  win.setContentProtection(true)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })

  return new Promise<NormalizedRegion | null>((resolve) => {
    let settled = false

    const finish = (region: NormalizedRegion | null): void => {
      if (settled) return
      settled = true
      ipcMain.removeListener('selector:done', onDone)
      ipcMain.removeListener('selector:cancel', onCancel)
      if (!win.isDestroyed()) win.destroy()
      try {
        fs.unlinkSync(previewFile)
      } catch {
        /* temp file already gone */
      }
      resolve(region)
    }

    const onDone = (event: Electron.IpcMainEvent, region: NormalizedRegion): void => {
      if (event.sender === win.webContents) finish(region ?? null)
    }
    const onCancel = (event: Electron.IpcMainEvent): void => {
      if (event.sender === win.webContents) finish(null)
    }

    ipcMain.on('selector:done', onDone)
    ipcMain.on('selector:cancel', onCancel)
    win.on('closed', () => finish(null))

    // Listeners before loadFile: a local page can finish loading before a listener added after.
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('selector:image', pathToFileURL(previewFile).href)
    })
    win.once('ready-to-show', () => {
      win.show()
      win.focus()
    })
    win.loadFile(path.join(__dirname, '..', 'renderer', 'select.html')).catch(() => {
      finish(null)
    })
  })
}
