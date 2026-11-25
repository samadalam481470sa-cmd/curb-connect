import type { TakeoffComparisonPreview } from '@fieldline/contracts';
import { markPlanPixelDifferences, takeoffComparisonLayout } from '@fieldline/geometry';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { z } from 'zod';
import { withPlanDocument } from './plan-pdf';

type Preview = z.infer<typeof TakeoffComparisonPreview>;
type PlanImage = { data: Uint8ClampedArray };
type RenderOptions = Parameters<PDFPageProxy['render']>[0];
interface PlanCanvas {
  canvas: { toBuffer(format: 'image/png'): Buffer };
  context: {
    getImageData(x: number, y: number, width: number, height: number): PlanImage;
    createImageData(width: number, height: number): PlanImage;
    putImageData(image: PlanImage, x: number, y: number): void;
  };
}

function makeCanvas(pdf: PDFDocumentProxy, width: number, height: number) {
  const factory = pdf.canvasFactory as { create(width: number, height: number): PlanCanvas };
  return factory.create(width, height);
}

export async function renderTakeoffRaster(
  earlier: Uint8Array,
  current: Uint8Array,
  preview: Preview,
) {
  const layout = takeoffComparisonLayout(preview.earlier, preview.current, preview.alignment);
  const { width, height } = layout;
  const render = (bytes: Uint8Array, pageNumber: number, position: typeof layout.earlier) =>
    withPlanDocument(bytes, 15_000, true, async (pdf) => {
      const page = await pdf.getPage(pageNumber);
      const { canvas, context } = makeCanvas(pdf, width, height);
      await page.render({
        canvas: canvas as unknown as RenderOptions['canvas'],
        viewport: page.getViewport({ scale: position.scale, rotation: position.rotation }),
        background: '#fff',
        transform: [1, 0, 0, 1, position.x, position.y],
      }).promise;
      const pixels = context.getImageData(0, 0, width, height).data;
      const png = canvas.toBuffer('image/png').toString('base64');
      return { pixels, png, canvas, context };
    });
  const [before, after] = await Promise.all([
    render(earlier, preview.earlier.pageNumber, layout.earlier),
    render(current, preview.current.pageNumber, layout.current),
  ]);
  const { overlay, addedPixels, removedPixels } = markPlanPixelDifferences(
    before.pixels,
    after.pixels,
  );
  const { canvas, context } = before;
  const image = context.createImageData(width, height);
  image.data.set(overlay);
  context.putImageData(image, 0, 0);
  return {
    width,
    height,
    earlierPng: before.png,
    currentPng: after.png,
    overlayPng: canvas.toBuffer('image/png').toString('base64'),
    addedPixels,
    removedPixels,
  };
}
