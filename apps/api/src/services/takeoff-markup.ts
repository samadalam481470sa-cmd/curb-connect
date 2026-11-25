import type { EnterpriseTakeoffMarkerSymbol, EnterpriseTakeoffPoint } from '@fieldline/contracts';
import type { TakeoffMarkupSnapshot } from '@fieldline/pdf';
import type { PDFPageProxy } from 'pdfjs-dist';
import { createPlanCanvas, withPlanDocument } from './plan-pdf';

export type MarkupGeometry =
  | { kind: 'length' | 'area'; id: string; rings: EnterpriseTakeoffPoint[][] }
  | {
      kind: 'count';
      id: string;
      point: EnterpriseTakeoffPoint;
      symbol: EnterpriseTakeoffMarkerSymbol;
    };

export async function renderTakeoffMarkupDrawing(
  file: Buffer,
  sheet: { pageNumber: number; rotation: 0 | 90 | 180 | 270 },
  geometry: readonly MarkupGeometry[],
): Promise<TakeoffMarkupSnapshot['drawing']> {
  return withPlanDocument(new Uint8Array(file), 15_000, true, async (document) => {
    const page = await document.getPage(sheet.pageNumber);
    const upright = page.getViewport({ scale: 1, rotation: sheet.rotation });
    const reference = page.getViewport({ scale: 1, rotation: 0 });
    const viewport = page.getViewport({
      scale: Math.min(3, 2400 / Math.max(upright.width, upright.height)),
      rotation: sheet.rotation,
    });
    const { width, height } = viewport;
    const { canvas } = createPlanCanvas(document, Math.ceil(width), Math.ceil(height));
    await page.render({
      canvas: canvas as unknown as Parameters<PDFPageProxy['render']>[0]['canvas'],
      viewport,
      background: '#ffffff',
      annotationMode: 0, // Leave interactive annotations from the source PDF out of the export.
    }).promise;
    const plot = (point: EnterpriseTakeoffPoint) => {
      const [pdfX = 0, pdfY = 0] = reference.convertToPdfPoint(point.x, point.y);
      const [x = 0, y = 0] = viewport.convertToViewportPoint(pdfX, pdfY);
      return { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) };
    };
    const marks = geometry.map((mark) => {
      if (mark.kind === 'count')
        return { kind: mark.kind, id: mark.id, symbol: mark.symbol, ...plot(mark.point) };
      const path = mark.rings
        .map((ring) => {
          const points = ring.map((point, index) => {
            const { x, y } = plot(point);
            return (index === 0 ? 'M' : 'L') + x + ' ' + y;
          });
          return points.join(' ') + (mark.kind === 'area' ? ' Z' : '');
        })
        .join(' ');
      return { kind: mark.kind, id: mark.id, path };
    });
    return {
      width: Math.ceil(width),
      height: Math.ceil(height),
      image: 'data:image/png;base64,' + canvas.toBuffer('image/png').toString('base64'),
      marks,
    };
  });
}
