/** Pure checks for the selector-to-pixel mapping; no Electron or display needed. */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { toPixelRegion, MIN_REGION_FRACTION } = require('../dist-electron/region.js')

const results = []
function check(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail })
}

const screen = { width: 2000, height: 1000 }

check(
  'full selection maps to the whole image',
  JSON.stringify(toPixelRegion({ x: 0, y: 0, w: 1, h: 1 }, screen.width, screen.height)) ===
    JSON.stringify({ x: 0, y: 0, width: 2000, height: 1000 }),
  JSON.stringify(toPixelRegion({ x: 0, y: 0, w: 1, h: 1 }, screen.width, screen.height)),
)

check(
  'quarter selection maps proportionally',
  JSON.stringify(toPixelRegion({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 2000, 1000)) ===
    JSON.stringify({ x: 500, y: 250, width: 1000, height: 500 }),
  JSON.stringify(toPixelRegion({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 2000, 1000)),
)

// Starting off the top-left keeps the selection's own extent: -0.5..0.75 is 75% of the image.
const clamped = toPixelRegion({ x: -0.5, y: -0.5, w: 1.25, h: 1.25 }, 2000, 1000)
check(
  'a selection starting off-image clamps its start and keeps its extent',
  clamped.x === 0 && clamped.y === 0 && clamped.width === 1500 && clamped.height === 750,
  JSON.stringify(clamped),
)

const spanning = toPixelRegion({ x: -0.5, y: -0.5, w: 2, h: 2 }, 2000, 1000)
check(
  'a selection spanning past both edges covers the whole image',
  spanning.x === 0 &&
    spanning.y === 0 &&
    spanning.width === 2000 &&
    spanning.height === 1000,
  JSON.stringify(spanning),
)

const rightEdge = toPixelRegion({ x: 0.9, y: 0.1, w: 0.5, h: 0.1 }, 2000, 1000)
check(
  'a selection running past the edge stops at the edge',
  rightEdge.x === 1800 && rightEdge.width === 200 && rightEdge.y === 100 && rightEdge.height === 100,
  JSON.stringify(rightEdge),
)

check(
  'a click-sized selection is rejected',
  toPixelRegion({ x: 0.5, y: 0.5, w: 0.01, h: 0.01 }, 2000, 1000) === null,
  `min fraction ${MIN_REGION_FRACTION}`,
)

const zeroWidth = toPixelRegion({ x: 0.5, y: 0.5, w: 0, h: 0.5 }, 2000, 1000)
check('a zero-width selection is rejected', zeroWidth === null, JSON.stringify(zeroWidth))

check(
  'non-finite input is rejected',
  toPixelRegion({ x: Number.NaN, y: 0, w: 0.5, h: 0.5 }, 2000, 1000) === null,
  'NaN x',
)

check(
  'an empty image is rejected',
  toPixelRegion({ x: 0, y: 0, w: 1, h: 1 }, 0, 0) === null,
  '0x0',
)

check(
  'rounding stays inside the image bounds',
  (() => {
    const region = toPixelRegion({ x: 0.333333, y: 0.666666, w: 0.123456, h: 0.234567 }, 1366, 768)
    return region.x + region.width <= 1366 && region.y + region.height <= 768
  })(),
  JSON.stringify(toPixelRegion({ x: 0.333333, y: 0.666666, w: 0.123456, h: 0.234567 }, 1366, 768)),
)

const failed = results.filter((result) => !result.pass)
console.log(
  results.map((result) => `${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`).join('\n'),
)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) process.exit(1)
