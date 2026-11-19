/**
 * Draws the app icon and writes build/icon.png (1024², RGBA). electron-builder converts it to
 * .icns and .ico, so no binary icon needs to be hand-made or kept in sync.
 *
 * Run with: npm run icons
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

const SIZE = 1024
const SUPERSAMPLE = 3

const BACKGROUND = [15, 18, 25]
const ACCENT = [76, 194, 255]
const CORNER = 0.225 * SIZE
const RING_OUTER = 0.30 * SIZE
const RING_INNER = 0.17 * SIZE

const here = dirname(fileURLToPath(import.meta.url))
const output = join(here, '..', 'build', 'icon.png')

function insideRoundedSquare(x, y, radius) {
  if (x < 0 || y < 0 || x > SIZE || y > SIZE) return false
  const cx = Math.min(Math.max(x, radius), SIZE - radius)
  const cy = Math.min(Math.max(y, radius), SIZE - radius)
  return Math.hypot(x - cx, y - cy) <= radius
}

/** Colour of one sample point; alpha is 0 or 1 and edges are resolved by supersampling. */
function sample(x, y) {
  if (!insideRoundedSquare(x, y, CORNER)) return null

  const distance = Math.hypot(x - SIZE / 2, y - SIZE / 2)
  if (distance <= RING_OUTER && distance >= RING_INNER) return ACCENT
  return BACKGROUND
}

const pixels = new Float64Array(SIZE * SIZE * 4)
const step = 1 / SUPERSAMPLE

for (let sy = 0; sy < SIZE * SUPERSAMPLE; sy += 1) {
  for (let sx = 0; sx < SIZE * SUPERSAMPLE; sx += 1) {
    const x = sx * step + step / 2
    const y = sy * step + step / 2
    const colour = sample(x, y)
    if (!colour) continue

    const index = (Math.floor(y) * SIZE + Math.floor(x)) * 4
    pixels[index] += colour[0]
    pixels[index + 1] += colour[1]
    pixels[index + 2] += colour[2]
    pixels[index + 3] += 1
  }
}

const samples = SUPERSAMPLE * SUPERSAMPLE
const rgba = Buffer.alloc(SIZE * SIZE * 4)
for (let index = 0; index < rgba.length; index += 4) {
  const coverage = pixels[index + 3]
  if (coverage === 0) continue

  // Premultiplied accumulation avoids dark fringes on the rounded corners.
  rgba[index] = Math.round(pixels[index] / coverage)
  rgba[index + 1] = Math.round(pixels[index + 1] / coverage)
  rgba[index + 2] = Math.round(pixels[index + 2] / coverage)
  rgba[index + 3] = Math.round((coverage / samples) * 255)
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(image) {
  const stride = SIZE * 4
  const raw = Buffer.alloc((stride + 1) * SIZE)
  for (let y = 0; y < SIZE; y += 1) {
    const rowStart = y * (stride + 1)
    raw[rowStart] = 0 // filter: none
    image.copy(raw, rowStart + 1, y * stride, (y + 1) * stride)
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(SIZE, 0)
  header.writeUInt32BE(SIZE, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  header[10] = 0
  header[11] = 0
  header[12] = 0

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const png = encodePng(rgba)
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, png)

console.log(`wrote ${output} (${SIZE}×${SIZE}, ${(png.length / 1024).toFixed(1)} KiB)`)
