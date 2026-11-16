#!/usr/bin/env node
/**
 * Self-capture probe: is the overlay really excluded from screen capture on this machine?
 *
 *   npm run probe
 *
 * It paints the real overlay window solid magenta, then captures the display from this same
 * process and looks for those pixels. The sequence is A/B/A so the result means something:
 *
 *   control A  protection OFF -> marker MUST be captured, or the capture path is not working
 *   protected  protection ON  -> marker MUST be absent
 *   control B  protection OFF -> marker MUST come back, proving the toggle was the cause
 *
 * A capture that never sees the window would look like a pass, so control A/B make that an
 * INCONCLUSIVE result instead of a false pass.
 *
 * Exit codes: 0 = excluded, 1 = detectable or only a black box, 2 = inconclusive.
 *
 * Limit worth knowing: this measures Electron/Chromium's screen capture, which is the same stack
 * a browser screen share (Meet in Chrome) uses. A pass is strong evidence, and a FAIL is
 * definitive — if this sees the overlay, so will anything else that captures the screen.
 */
const { app, desktopCapturer, screen } = require('electron')
const path = require('node:path')
const { findMarker, describeRegion } = require('./marker.cjs')

const MARKER_CSS = [
  'html,body{background:#ff00ff !important;overflow:hidden !important}',
  '.panel{display:none !important}',
].join('\n')

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function platformLabel() {
  const version = process.getSystemVersion ? process.getSystemVersion() : ''
  return `${process.platform} ${version} · electron ${process.versions.electron}`.trim()
}

async function waitForLoad(contents, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      if (done) return
      done = true
      resolve(false)
    }, timeoutMs)
    contents.once('did-finish-load', finish)
  })
}

async function capture(display) {
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

  const image = source.thumbnail
  const size = image.getSize()
  return { width: size.width, height: size.height, data: image.toBitmap() }
}

function formatBox(box) {
  return box ? `${box.width}×${box.height} at ${box.x},${box.y}` : '—'
}

async function main() {
  console.log(`Wingman capture probe · ${platformLabel()}\n`)

  await app.whenReady()
  if (process.platform === 'darwin' && app.dock) app.dock.hide()

  const { screenPermission } = require('../dist-electron/screen.js')
  const permission = screenPermission()
  if (permission !== 'granted') {
    console.log(`INCONCLUSIVE — screen capture permission is "${permission}" on this machine.`)
    console.log('The probe cannot test anything until the OS lets it capture the screen.')
    if (process.platform === 'darwin') {
      console.log(
        'Grant Wingman under System Settings → Privacy & Security → Screen & System Audio Recording,\n' +
          'then relaunch the app (macOS applies screen-capture grants only to new processes).',
      )
    }
    console.log('\nINCONCLUSIVE')
    app.exit(2)
    return
  }

  const overlayModule = require('../dist-electron/overlay.js')
  const win = overlayModule.createOverlay(path.join(__dirname, '..', 'dist-electron', 'preload.js'))

  const loaded = await waitForLoad(win.webContents)
  if (!loaded) {
    console.log('INCONCLUSIVE — the overlay renderer never finished loading.')
    app.exit(2)
    return
  }

  overlayModule.showOverlay({ activate: false })
  await win.webContents.insertCSS(MARKER_CSS)
  await delay(500)

  const display = screen.getDisplayMatching(win.getBounds())
  const bounds = win.getBounds()
  const scale = display.scaleFactor || 1
  const expectedPixels = Math.round(bounds.width * scale) * Math.round(bounds.height * scale)

  const runs = []
  const run = async (label, protect) => {
    win.setContentProtection(protect)
    await delay(450)
    const frame = await capture(display)
    if (!frame) {
      runs.push({ label, protect, failed: true })
      return
    }
    runs.push({ label, protect, frame, marker: findMarker(frame) })
  }

  await run('control A', false)
  await run('protected', true)
  await run('control B', false)

  if (runs.some((entry) => entry.failed)) {
    console.log('INCONCLUSIVE — the capture came back empty even with protection off.')
    console.log('That is the OS refusing to hand over pixels (permission or a secure desktop).')
    console.log('\nINCONCLUSIVE')
    app.exit(2)
    return
  }

  const [controlA, protectedRun, controlB] = runs
  const overlayRect = controlA.marker.box ?? null
  const region = overlayRect ? describeRegion(protectedRun.frame, overlayRect) : null
  const blackBox = Boolean(region && region.mean < 20 && region.litRatio < 0.02)

  console.log(`display        ${display.size.width}×${display.size.height} @${scale} (capture ${runs[0].frame.width}×${runs[0].frame.height})`)
  console.log(`overlay bounds ${bounds.width}×${bounds.height} at ${bounds.x},${bounds.y}`)
  console.log(`expected area  ${expectedPixels.toLocaleString()} marker pixels if captured\n`)
  console.log('run          protection   marker pixels        bbox')
  for (const entry of runs) {
    console.log(
      `${entry.label.padEnd(12)} ${String(entry.protect ? 'on' : 'off').padEnd(12)} ` +
        `${String(entry.marker.count.toLocaleString()).padEnd(19)} ${formatBox(entry.marker.box)}`,
    )
  }
  if (region) {
    console.log(
      `\nwhat the protected capture shows where the overlay was: mean luminance ${region.mean.toFixed(1)}, ` +
        `${(region.litRatio * 100).toFixed(0)}% of pixels lit`,
    )
  }
  console.log('')

  const controlsSawOverlay = controlA.marker.count > 0 && controlB.marker.count > 0
  const protectedSawOverlay = protectedRun.marker.count > 20

  let verdict
  let code
  let detail

  if (!controlsSawOverlay) {
    verdict = 'INCONCLUSIVE'
    code = 2
    detail =
      'The marker was not captured even with protection OFF, so the capture never contained the\n' +
      'window. Most likely the window sat on a different display than the one captured, or the\n' +
      'compositor refused to include it. Nothing can be concluded about content protection.'
  } else if (protectedSawOverlay) {
    verdict = 'FAIL'
    code = 1
    detail =
      `The overlay was captured with protection ON (${protectedRun.marker.count.toLocaleString()} marker pixels at\n` +
      `${formatBox(protectedRun.marker.box)}). On this platform setContentProtection does not hide the window\n` +
      'from this capture path. Anything recording the screen sees it too.'
  } else if (blackBox) {
    verdict = 'PARTIAL'
    code = 1
    detail =
      'The marker is gone, but the area where the overlay was captures as a near-uniform black\n' +
      'rectangle. That is WDA_MONITOR mode: the contents are hidden, yet the window is still a\n' +
      'visible black box on any recording. Windows 10 builds before 2004 behave this way.'
  } else {
    verdict = 'PASS'
    code = 0
    detail =
      'The marker is absent with protection ON, present in both control runs, and the area where\n' +
      'the overlay sits captures as ordinary desktop. The window is excluded from this capture path.'
  }

  console.log(`${verdict} — ${detail}`)
  console.log('')
  console.log(`platform: ${platformLabel()}`)
  console.log('Copy the block above back to the chat.')

  app.exit(code)
}

main().catch((error) => {
  console.log(`INCONCLUSIVE — the probe crashed: ${error && error.stack ? error.stack : String(error)}`)
  app.exit(2)
})

setTimeout(() => {
  console.log('INCONCLUSIVE — the probe did not finish within 45s.')
  app.exit(2)
}, 45000).unref?.()
