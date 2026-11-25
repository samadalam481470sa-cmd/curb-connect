import type { TakeoffSnapSegment } from '@fieldline/geometry';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

type Position = TakeoffSnapSegment['from'];
type Viewport = ReturnType<PDFPageProxy['getViewport']>;
type GraphicsState = { matrix: DOMMatrixReadOnly; opacity: number; eligible: boolean };
type DrawingGeometry = {
  segments: TakeoffSnapSegment[];
  contours: Position[][];
  curvedContours: Position[][];
};
const maxSegments = 20_000;
const maxContours = 5_000;
const curveSteps = 6;
const maxContourPoints = 64;
const pending = new WeakMap<PDFDocumentProxy, Map<number, Promise<DrawingGeometry>>>();

export function pdfDrawingGeometry(pdf: PDFDocumentProxy, pageNumber: number) {
  let pages = pending.get(pdf);
  if (!pages) {
    pages = new Map();
    pending.set(pdf, pages);
  }
  const existing = pages.get(pageNumber);
  if (existing) return existing;
  const task = readGeometry(pdf, pageNumber).catch((cause: unknown) => {
    pages.delete(pageNumber);
    throw cause;
  });
  pages.set(pageNumber, task);
  return task;
}

async function readGeometry(pdf: PDFDocumentProxy, pageNumber: number) {
  const { OPS, AnnotationMode } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1, rotation: 0 });
  const [{ fnArray, argsArray }, optional] = await Promise.all([
    page.getOperatorList({ intent: 'display', annotationMode: AnnotationMode.DISABLE }),
    pdf.getOptionalContentConfig({ intent: 'display' }),
  ]);
  const strokePaints = new Set<number>([
    OPS.stroke,
    OPS.closeStroke,
    OPS.fillStroke,
    OPS.eoFillStroke,
    OPS.closeFillStroke,
    OPS.closeEOFillStroke,
  ]);
  const saved: GraphicsState[] = [];
  const visibility: boolean[] = [];
  const drawing: DrawingGeometry = { segments: [], contours: [], curvedContours: [] };
  let state = { matrix: new DOMMatrixReadOnly(), opacity: 1, eligible: true };
  for (const [index, op] of fnArray.entries()) {
    if (drawing.segments.length >= maxSegments) break;
    const args = argsArray[index];
    switch (op) {
      case OPS.beginMarkedContent:
        visibility.push(true);
        break;
      case OPS.beginMarkedContentProps:
        visibility.push(args?.[0] !== 'OC' || optional.isVisible(args[1]) === true);
        break;
      case OPS.endMarkedContent:
        visibility.pop();
        break;
      case OPS.save:
        saved.push(state);
        break;
      case OPS.paintFormXObjectBegin:
        saved.push(state);
        state = { ...state, matrix: transform(state.matrix, args?.[0]) };
        break;
      case OPS.beginGroup:
        saved.push(state);
        // Soft masks and transparency groups can paint geometry that is invisible on the sheet.
        state = { ...state, eligible: false };
        break;
      case OPS.restore:
      case OPS.paintFormXObjectEnd:
      case OPS.endGroup:
        state = saved.pop() ?? state;
        break;
      case OPS.transform:
        state = { ...state, matrix: transform(state.matrix, args) };
        break;
      case OPS.setGState:
        for (const entry of args?.[0] ?? []) {
          if (Array.isArray(entry) && entry[0] === 'CA' && typeof entry[1] === 'number')
            state = { ...state, opacity: entry[1] };
        }
        break;
      case OPS.constructPath:
        if (
          state.opacity > 0 &&
          state.eligible &&
          !visibility.includes(false) &&
          strokePaints.has(args?.[0]) &&
          args?.[1]?.[0] instanceof Float32Array
        )
          readPath(args[1][0], state.matrix, viewport, drawing);
        break;
    }
  }
  return drawing;
}

function transform(base: DOMMatrixReadOnly, values: unknown) {
  if (
    (!Array.isArray(values) && !ArrayBuffer.isView(values)) ||
    !('length' in values) ||
    values.length !== 6
  )
    return base;
  const entries: unknown[] = Array.from(values as ArrayLike<unknown>);
  if (
    !entries.every((value): value is number => typeof value === 'number' && Number.isFinite(value))
  )
    return base;
  return base.multiply(new DOMMatrixReadOnly(entries));
}

// PDF.js 6 operator lists encode path segments as a Float32Array of DrawOPS and operands.
function readPath(
  data: Float32Array,
  matrix: DOMMatrixReadOnly,
  viewport: Viewport,
  { segments, contours, curvedContours }: DrawingGeometry,
) {
  const position = (x: number | undefined, y: number | undefined): Position | undefined => {
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const world = matrix.transformPoint({ x, y });
    const [px, py] = viewport.convertToViewportPoint(world.x, world.y);
    if (px === undefined || py === undefined || !Number.isFinite(px) || !Number.isFinite(py))
      return;
    return { x: px, y: py };
  };
  let current: Position | undefined;
  let start: Position | undefined;
  let contour: Position[] | null = null;
  let curved = false;
  function finishContour(closed: boolean) {
    if (!contour || !current || !start) return;
    const endpointsMeet = current.x === start.x && current.y === start.y;
    if (!closed && !endpointsMeet) return;
    if (endpointsMeet) contour.pop();
    if (
      contours.length + curvedContours.length < maxContours &&
      contour.length >= (curved ? 16 : 3) &&
      contour.length <= (curved ? maxContourPoints : 12) &&
      contour.every((point) => insideSheet(point, viewport))
    ) {
      (curved ? curvedContours : contours).push(contour);
    }
  }
  for (let i = 0; i < data.length && segments.length < maxSegments;) {
    const command = data[i++];
    switch (command) {
      case 0: // move
        finishContour(false);
        start = current = position(data[i], data[i + 1]);
        contour = start ? [start] : null;
        curved = false;
        i += 2;
        break;
      case 1: {
        // line
        const next = position(data[i], data[i + 1]);
        if (current && next) addVisibleSegment(current, next, viewport, segments);
        if (next && contour && contour.length <= (curved ? maxContourPoints : 12))
          contour.push(next);
        else contour = null;
        current = next;
        i += 2;
        break;
      }
      case 2:
      case 3: {
        const endOffset = command === 2 ? 4 : 2;
        const control = position(data[i], data[i + 1]);
        const second = command === 2 ? position(data[i + 2], data[i + 3]) : control;
        const end = position(data[i + endOffset], data[i + endOffset + 1]);
        if (
          contour &&
          current &&
          control &&
          second &&
          end &&
          contours.length + curvedContours.length < maxContours &&
          contour.length + curveSteps <= maxContourPoints + 1
        ) {
          const controls =
            command === 2 ? [current, control, second, end] : [current, control, end];
          for (let step = 1; step < curveSteps; step++)
            contour.push(curvePoint(controls, step / curveSteps));
          contour.push(end);
          curved = true;
        } else {
          contour = null;
        }
        current = end;
        i += endOffset + 2;
        break;
      }
      case 4: // close
        if (current && start) addVisibleSegment(current, start, viewport, segments);
        finishContour(true);
        contour = null;
        current = start;
        break;
      default:
        return;
    }
  }
  finishContour(false);
}

function curvePoint(controls: readonly Position[], t: number): Position {
  let points = [...controls];
  while (points.length > 1) {
    points = points.slice(0, -1).map((point, index) => {
      const next = points[index + 1]!;
      return { x: point.x + (next.x - point.x) * t, y: point.y + (next.y - point.y) * t };
    });
  }
  return points[0]!;
}

function addVisibleSegment(
  from: Position,
  to: Position,
  viewport: Viewport,
  segments: TakeoffSnapSegment[],
) {
  if (
    insideSheet(from, viewport) &&
    insideSheet(to, viewport) &&
    (from.x !== to.x || from.y !== to.y)
  )
    segments.push({ from, to });
}

function insideSheet({ x, y }: Position, viewport: Viewport) {
  return x >= 0 && x <= viewport.width && y >= 0 && y <= viewport.height;
}
