/**
 * A selection is reported by the selector page in 0..1 coordinates relative to the captured
 * display, so the same numbers work on any DPI, window size or monitor arrangement.
 */
export interface NormalizedRegion {
  x: number
  y: number
  w: number
  h: number
}

export interface PixelRegion {
  x: number
  y: number
  width: number
  height: number
}

/** Selections thinner than this fraction of a side are an accidental click, not a request. */
export const MIN_REGION_FRACTION = 0.02

export function toPixelRegion(
  region: NormalizedRegion,
  width: number,
  height: number,
): PixelRegion | null {
  const values = [region.x, region.y, region.w, region.h]
  if (!values.every(Number.isFinite) || width <= 0 || height <= 0) return null

  const clamp = (value: number): number => Math.min(1, Math.max(0, value))
  const left = Math.round(clamp(region.x) * width)
  const top = Math.round(clamp(region.y) * height)
  const right = Math.round(clamp(region.x + region.w) * width)
  const bottom = Math.round(clamp(region.y + region.h) * height)

  const pixelWidth = right - left
  const pixelHeight = bottom - top
  if (pixelWidth < width * MIN_REGION_FRACTION || pixelHeight < height * MIN_REGION_FRACTION) return null

  return { x: left, y: top, width: pixelWidth, height: pixelHeight }
}
