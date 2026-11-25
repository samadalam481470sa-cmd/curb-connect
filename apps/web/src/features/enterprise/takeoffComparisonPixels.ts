export function markPlanPixelDifferences(earlier: Uint8ClampedArray, current: Uint8ClampedArray) {
  if (earlier.length !== current.length || earlier.length % 4) {
    throw new RangeError('Both drawings must use the same comparison canvas.');
  }
  const overlay = new Uint8ClampedArray(earlier.length);
  let addedPixels = 0;
  let removedPixels = 0;
  const filled = (pixels: Uint8ClampedArray, index: number) =>
    Math.min(pixels[index] ?? 255, pixels[index + 1] ?? 255, pixels[index + 2] ?? 255) < 220;
  for (let index = 0; index < earlier.length; index += 4) {
    const oldInk = filled(earlier, index);
    const newInk = filled(current, index);
    if (oldInk && !newInk) {
      overlay[index] = 194;
      overlay[index + 1] = 50;
      overlay[index + 2] = 37;
      removedPixels++;
    } else if (!oldInk && newInk) {
      overlay[index] = 0;
      overlay[index + 1] = 103;
      overlay[index + 2] = 93;
      addedPixels++;
    } else {
      const shade = oldInk ? 118 : 255;
      overlay[index] = shade;
      overlay[index + 1] = shade;
      overlay[index + 2] = shade;
    }
    overlay[index + 3] = 255;
  }
  return { overlay, addedPixels, removedPixels };
}
