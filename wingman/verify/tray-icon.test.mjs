/** Pure checks for the generated tray icon; no Electron needed. */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { drawTrayIcon, TRAY_ACTIVE_COLOR } = require('../dist-electron/tray-icon.js')

const results = []
function check(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail })
}

function pixel(buffer, size, x, y) {
  const index = (y * size + x) * 4
  return { b: buffer[index], g: buffer[index + 1], r: buffer[index + 2], a: buffer[index + 3] }
}

for (const size of [16, 32]) {
  const buffer = drawTrayIcon(size, TRAY_ACTIVE_COLOR)
  const centre = pixel(buffer, size, size / 2, size / 2)
  const ring = pixel(buffer, size, size / 2, 1)
  const corner = pixel(buffer, size, 0, 0)

  check(`${size}px: bitmap has the right length`, buffer.length === size * size * 4, `${buffer.length} bytes`)
  check(`${size}px: the hole in the middle is transparent`, centre.a === 0, JSON.stringify(centre))
  check(`${size}px: the ring is opaque`, ring.a === 255, JSON.stringify(ring))
  check(`${size}px: corners stay transparent`, corner.a === 0, JSON.stringify(corner))
  check(
    `${size}px: colour is written as BGRA`,
    ring.b === TRAY_ACTIVE_COLOR.b && ring.g === TRAY_ACTIVE_COLOR.g && ring.r === TRAY_ACTIVE_COLOR.r,
    JSON.stringify(ring),
  )
  check(
    `${size}px: transparent pixels carry no colour`,
    corner.b === 0 && corner.g === 0 && corner.r === 0,
    JSON.stringify(corner),
  )
}

const dark = drawTrayIcon(16, { r: 10, g: 20, b: 30 })
const darkRing = pixel(dark, 16, 8, 1)
check(
  'channel order is not swapped for a non-grey colour',
  darkRing.b === 30 && darkRing.g === 20 && darkRing.r === 10,
  JSON.stringify(darkRing),
)

check(
  'the ring covers a plausible share of the icon',
  (() => {
    const buffer = drawTrayIcon(16, TRAY_ACTIVE_COLOR)
    let opaque = 0
    for (let index = 3; index < buffer.length; index += 4) if (buffer[index] === 255) opaque += 1
    return opaque > 100 && opaque < 200
  })(),
  'between 100 and 200 of 256 pixels',
)

const failed = results.filter((result) => !result.pass)
console.log(
  results.map((result) => `${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`).join('\n'),
)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) process.exit(1)
