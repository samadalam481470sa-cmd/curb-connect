'use strict'

/**
 * Electron's NativeImage.toBitmap() returns BGRA. The probe paints a field of near-pure magenta,
 * which no normal UI uses, so a strict test has almost no false positives.
 */
function isMarker(blue, green, red) {
  return red >= 230 && green <= 40 && blue >= 230
}

/** Scans a BGRA frame for marker pixels and returns their count, bounding box and coverage. */
function findMarker({ data, width, height }) {
  let count = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4
    for (let x = 0; x < width; x += 1) {
      const index = row + x * 4
      if (!isMarker(data[index], data[index + 1], data[index + 2])) continue

      count += 1
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  if (count === 0) return { count: 0, box: null, ratio: 0 }

  return {
    count,
    box: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
    ratio: count / (width * height),
  }
}

/**
 * Describes what a capture shows inside the rectangle the marker used to occupy.
 * A near-uniform dark region means the window was captured as an opaque black box
 * (Windows WDA_MONITOR, pre-2004 builds) rather than excluded from the capture.
 */
function describeRegion({ data, width, height }, box) {
  if (!box) return null

  const x0 = Math.max(0, box.x)
  const y0 = Math.max(0, box.y)
  const x1 = Math.min(width - 1, box.x + box.width - 1)
  const y1 = Math.min(height - 1, box.y + box.height - 1)

  let count = 0
  let sum = 0
  let lit = 0

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const index = (y * width + x) * 4
      const luminance = 0.114 * data[index] + 0.587 * data[index + 1] + 0.299 * data[index + 2]
      sum += luminance
      if (luminance > 30) lit += 1
      count += 1
    }
  }

  return count === 0 ? null : { mean: sum / count, litRatio: lit / count, pixels: count }
}

module.exports = { findMarker, describeRegion, isMarker }
