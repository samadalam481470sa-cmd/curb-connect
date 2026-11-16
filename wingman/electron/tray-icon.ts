export interface Rgb {
  r: number
  g: number
  b: number
}

/** Menu-bar template images use alpha only; macOS recolours them for light and dark. */
export const TRAY_TEMPLATE_COLOR: Rgb = { r: 255, g: 255, b: 255 }
export const TRAY_ACTIVE_COLOR: Rgb = { r: 76, g: 194, b: 255 }

/**
 * Draws a ring at `size` × `size` in BGRA. Only opaque pixels carry colour, so the bitmap is
 * safe for platform alpha handling and works as a macOS template image.
 */
export function drawTrayIcon(size: number, color: Rgb): Buffer {
  const buffer = Buffer.alloc(size * size * 4)
  const radius = size / 2
  const outer = radius - 0.5
  const inner = radius * 0.45

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x + 0.5 - radius, y + 0.5 - radius)
      if (distance > outer || distance < inner) continue

      const index = (y * size + x) * 4
      buffer[index] = color.b
      buffer[index + 1] = color.g
      buffer[index + 2] = color.r
      buffer[index + 3] = 255
    }
  }

  return buffer
}
