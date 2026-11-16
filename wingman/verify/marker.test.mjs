/** Pure checks for the probe's pixel scanning; no Electron or display needed. */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { findMarker, describeRegion, isMarker } = require('./marker.cjs')

const results = []
function check(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail })
}

/** BGRA frame filled with a colour, optionally with a magenta rectangle drawn into it. */
function makeFrame(width, height, { b = 0, g = 0, r = 0 } = {}, rect) {
  const data = Buffer.alloc(width * height * 4)
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = b
    data[index * 4 + 1] = g
    data[index * 4 + 2] = r
    data[index * 4 + 3] = 255
  }
  if (rect) {
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        const index = (y * width + x) * 4
        data[index] = 255 // B
        data[index + 1] = 0 // G
        data[index + 2] = 255 // R
      }
    }
  }
  return { data, width, height }
}

const withMarker = makeFrame(200, 100, { b: 30, g: 90, r: 140 }, { x: 40, y: 20, width: 50, height: 30 })
const found = findMarker(withMarker)
check('finds the marker rectangle', found.count === 1500, `count=${found.count}`)
check(
  'reports its bounding box',
  found.box.x === 40 && found.box.y === 20 && found.box.width === 50 && found.box.height === 30,
  JSON.stringify(found.box),
)
check(
  'reports coverage as a fraction of the frame',
  Math.abs(found.ratio - 1500 / 20000) < 1e-9,
  `ratio=${found.ratio}`,
)

const empty = findMarker(makeFrame(200, 100, { b: 30, g: 90, r: 140 }))
check('returns nothing for a frame without magenta', empty.count === 0 && empty.box === null, `count=${empty.count}`)

// Common UI colours must not be mistaken for the marker.
const uiColours = [
  [255, 0, 255],
  [200, 60, 200],
  [255, 20, 200],
  [220, 40, 220],
]
check(
  'threshold accepts magenta and rejects near-misses',
  isMarker(255, 0, 255) === true &&
    isMarker(245, 5, 245) === true &&
    isMarker(200, 60, 200) === false &&
    isMarker(255, 120, 255) === false,
  JSON.stringify(uiColours),
)

const blackFrame = makeFrame(200, 100, { b: 8, g: 6, r: 5 })
const blackRegion = describeRegion(blackFrame, { x: 40, y: 20, width: 50, height: 30 })
check(
  'uniform dark region reads as a black box',
  blackRegion.mean < 20 && blackRegion.litRatio < 0.02,
  `mean=${blackRegion.mean.toFixed(1)}, lit=${blackRegion.litRatio}`,
)

const desktopRegion = describeRegion(withMarker, { x: 0, y: 0, width: 200, height: 100 })
check(
  'ordinary desktop pixels read as lit',
  desktopRegion.litRatio > 0.9,
  `lit=${desktopRegion.litRatio.toFixed(2)}, mean=${desktopRegion.mean.toFixed(1)}`,
)

check('describeRegion tolerates a box at the frame edge', (() => {
  const edge = describeRegion(withMarker, { x: 180, y: 90, width: 100, height: 100 })
  return edge !== null && edge.pixels === 20 * 10
})(), 'clamped box')

const failed = results.filter((result) => !result.pass)
console.log(
  results.map((result) => `${result.pass ? 'PASS' : 'FAIL'}  ${result.name}  (${result.detail})`).join('\n'),
)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) process.exit(1)
