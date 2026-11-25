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

type SheetSize = { widthPoints: number; heightPoints: number; rotation: number };
type Alignment = { offsetX: number; offsetY: number; scale: number; rotation: number };

function drawingSize(sheet: SheetSize, rotation: number, scale: number) {
  const sideways = rotation % 180 !== 0;
  return {
    width: (sideways ? sheet.heightPoints : sheet.widthPoints) * scale,
    height: (sideways ? sheet.widthPoints : sheet.heightPoints) * scale,
  };
}

export function takeoffComparisonLayout(
  earlier: SheetSize,
  current: SheetSize,
  alignment: Alignment,
) {
  const currentRotation = (current.rotation + alignment.rotation) % 360;
  const earlierSize = drawingSize(earlier, earlier.rotation, 1);
  const currentSize = drawingSize(current, currentRotation, alignment.scale);
  const minX = Math.min(0, alignment.offsetX);
  const minY = Math.min(0, alignment.offsetY);
  const unitsWide = Math.max(earlierSize.width, alignment.offsetX + currentSize.width) - minX;
  const unitsHigh = Math.max(earlierSize.height, alignment.offsetY + currentSize.height) - minY;
  const pixelsPerPoint = Math.min(2, 1200 / unitsWide, 1200 / unitsHigh);
  return {
    width: Math.max(1, Math.min(1200, Math.ceil(unitsWide * pixelsPerPoint))),
    height: Math.max(1, Math.min(1200, Math.ceil(unitsHigh * pixelsPerPoint))),
    earlier: {
      scale: pixelsPerPoint,
      rotation: earlier.rotation,
      x: -minX * pixelsPerPoint,
      y: -minY * pixelsPerPoint,
    },
    current: {
      scale: pixelsPerPoint * alignment.scale,
      rotation: currentRotation,
      x: (alignment.offsetX - minX) * pixelsPerPoint,
      y: (alignment.offsetY - minY) * pixelsPerPoint,
    },
  };
}
