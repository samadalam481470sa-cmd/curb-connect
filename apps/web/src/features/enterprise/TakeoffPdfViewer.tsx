'use client';

import type { EnterpriseTakeoffPoint, EnterpriseTakeoffSheet } from '@fieldline/contracts';
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
  RenderTask,
} from 'pdfjs-dist';
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import type { z } from 'zod';
import {
  calibrationPointLabels,
  parseCalibrationPoint,
  TakeoffCalibrationControls,
  type CalibrationPointKey,
  type CalibrationPoints,
} from './TakeoffCalibrationControls';

type Sheet = z.infer<typeof EnterpriseTakeoffSheet>;
const magnifications = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const preferenceKey = 'fieldpro.enterprise.takeoff.zoom';
const maxCanvasPixels = 12_000_000;
const assets = '/pdfjs/';

const markerLabels = { referenceA: 'A', referenceB: 'B', checkA: 'C', checkB: 'D' };
type Viewport = ReturnType<PDFPageProxy['getViewport']>;
type PageRender =
  { status: 'rendering' | 'failed' } | { status: 'ready'; viewport: Viewport; reference: Viewport };

function readZoom() {
  try {
    const zoom = Number(localStorage.getItem(preferenceKey));
    return magnifications.includes(zoom) ? zoom : 1;
  } catch {
    return 1;
  }
}

function rememberZoom(zoom: number) {
  try {
    localStorage.setItem(preferenceKey, String(zoom));
  } catch {
    // The viewer still works when storage is disabled.
  }
}

export function TakeoffPdfViewer({
  url,
  calibrationPath,
  sheet,
  siblings,
  revisionLabel,
  onView,
  onClose,
}: {
  url: string;
  calibrationPath: string;
  sheet: Sheet;
  siblings: readonly Sheet[];
  revisionLabel: string;
  onView: (id: string) => void;
  onClose: () => void;
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(readZoom);
  const [turn, setTurn] = useState(0);
  const [available, setAvailable] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState<{ sheetId: string; points: CalibrationPoints } | null>(null);
  const [capture, setCapture] = useState<{ sheetId: string; key: CalibrationPointKey } | null>(
    null,
  );
  const captureButton = useRef<HTMLButtonElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    const viewport = frame.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailable({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    let loading: PDFDocumentLoadingTask | undefined;
    async function load() {
      const engine = await import('pdfjs-dist/legacy/build/pdf.mjs');
      if (!active) return;
      engine.GlobalWorkerOptions.workerSrc = assets + 'pdf.worker.min.mjs';
      loading = engine.getDocument({
        url,
        withCredentials: true,
        disableRange: true,
        disableStream: true,
        disableAutoFetch: true,
        cMapUrl: assets + 'cmaps/',
        cMapPacked: true,
        standardFontDataUrl: assets + 'standard_fonts/',
        wasmUrl: assets + 'wasm/',
        stopAtErrors: true,
      });
      const document = await loading.promise;
      if (active) setPdf(document);
    }
    void load().catch(() => {
      if (active)
        setLoadError('This PDF revision could not be opened. Retry or download the source PDF.');
    });
    return () => {
      active = false;
      void loading?.destroy().catch(() => undefined);
    };
  }, [url, attempt]);

  const rotation = (sheet.rotation + turn) % 360;
  const quarterTurn = rotation % 180 !== 0;
  const width = quarterTurn ? sheet.heightPoints : sheet.widthPoints;
  const height = quarterTurn ? sheet.widthPoints : sheet.heightPoints;
  const fitScale = Math.min(
    Math.max(1, available.width - 20) / width,
    Math.max(1, available.height - 20) / height,
  );
  const scale = fitScale * zoom;
  const zoomIndex = magnifications.indexOf(zoom);
  const points = draft?.sheetId === sheet.id ? draft.points : {};
  const activeCapture = capture?.sheetId === sheet.id ? capture.key : null;

  function capturePoint(point: EnterpriseTakeoffPoint) {
    if (!activeCapture) return;
    setDraft({
      sheetId: sheet.id,
      points: {
        ...points,
        [activeCapture]: {
          x: String(Math.min(sheet.widthPoints, Number(point.x.toFixed(6)))),
          y: String(Math.min(sheet.heightPoints, Number(point.y.toFixed(6)))),
        },
      },
    });
    setCapture(null);
    captureButton.current?.focus();
  }

  function changeZoom(value: number) {
    setZoom(value);
    rememberZoom(value);
  }

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (
      !pdf ||
      activeCapture ||
      event.pointerType !== 'mouse' ||
      event.button !== 0 ||
      (event.target !== event.currentTarget && !(event.target instanceof HTMLCanvasElement))
    )
      return;
    const target = event.currentTarget;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      left: target.scrollLeft,
      top: target.scrollTop,
    };
    target.setPointerCapture(event.pointerId);
  }

  function pan(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start) return;
    event.currentTarget.scrollLeft = start.left + start.x - event.clientX;
    event.currentTarget.scrollTop = start.top + start.y - event.clientY;
  }

  return (
    <section className="enterprise-takeoff-viewer" aria-label="Plan sheet viewer">
      <header className="enterprise-control-head">
        <div>
          <h4 ref={heading} tabIndex={-1}>
            Sheet {sheet.pageLabel}
          </h4>
          <p>
            {revisionLabel} · {sheet.sourceTitle} · Vault version {sheet.sourceRevision}
          </p>
        </div>
        <button type="button" onClick={onClose}>
          Close sheet
        </button>
      </header>
      <div className="enterprise-actions" aria-label="Sheet view controls">
        <button
          type="button"
          disabled={zoomIndex <= 0}
          onClick={() => changeZoom(magnifications[zoomIndex - 1] ?? zoom)}
        >
          Zoom out
        </button>
        <button
          type="button"
          disabled={zoomIndex >= magnifications.length - 1}
          onClick={() => changeZoom(magnifications[zoomIndex + 1] ?? zoom)}
        >
          Zoom in
        </button>
        <output aria-label="View zoom">{Math.round(zoom * 100)}% of fit</output>
        <button type="button" onClick={() => changeZoom(1)}>
          Fit sheet
        </button>
        <button type="button" onClick={() => setTurn((value) => (value + 90) % 360)}>
          Rotate clockwise
        </button>
      </div>
      {activeCapture && (
        <p role="status">
          Select {calibrationPointLabels[activeCapture].toLowerCase()} on the drawing.
        </p>
      )}
      <div className="enterprise-takeoff-view-body">
        <nav aria-label="Sheets in this PDF" className="enterprise-takeoff-thumbnails">
          {siblings.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === sheet.id}
              onClick={() => {
                if (item.id === sheet.id) return;
                setDraft(null);
                setCapture(null);
                onView(item.id);
              }}
            >
              {pdf && <SheetThumbnail pdf={pdf} sheet={item} />}
              <span>Sheet {item.pageLabel}</span>
            </button>
          ))}
        </nav>
        <div
          className="enterprise-takeoff-viewport"
          ref={frame}
          tabIndex={0}
          aria-label={'Drawing viewport for sheet ' + sheet.pageLabel}
          onPointerDown={startPan}
          onPointerMove={pan}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
        >
          {!pdf && !loadError && <p role="status">Loading this PDF revision…</p>}
          {loadError && (
            <div>
              <p className="enterprise-error" role="alert">
                {loadError}
              </p>
              <button
                type="button"
                onClick={() => {
                  setLoadError('');
                  setAttempt((value) => value + 1);
                }}
              >
                Retry loading PDF
              </button>
              <a href={url}>Download source PDF</a>
            </div>
          )}
          {pdf && available.width > 0 && (
            <PlanCanvas
              key={sheet.id + ':' + scale + ':' + rotation}
              pdf={pdf}
              pageNumber={sheet.pageNumber}
              scale={scale}
              rotation={rotation}
              label={'Rendered drawing for sheet ' + sheet.pageLabel}
              markers={points}
              onPoint={activeCapture ? capturePoint : undefined}
            />
          )}
        </div>
      </div>
      <TakeoffCalibrationControls
        key={sheet.id}
        path={calibrationPath}
        sheet={sheet}
        points={points}
        canPick={pdf !== null}
        onPoints={(next) => setDraft({ sheetId: sheet.id, points: next })}
        onPointInput={(key, point) => {
          setDraft({ sheetId: sheet.id, points: { ...points, [key]: point } });
          setCapture(null);
        }}
        onPick={(key, button) => {
          captureButton.current = button;
          setCapture({ sheetId: sheet.id, key });
          frame.current?.focus();
        }}
        onCancelPick={() => setCapture(null)}
      />
    </section>
  );
}

function SheetThumbnail({ pdf, sheet }: { pdf: PDFDocumentProxy; sheet: Sheet }) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="enterprise-takeoff-thumbnail" ref={host} aria-hidden="true">
      {visible && (
        <PlanCanvas
          pdf={pdf}
          pageNumber={sheet.pageNumber}
          scale={
            sheet.rotation % 180 === 0
              ? Math.min(88 / sheet.widthPoints, 72 / sheet.heightPoints)
              : Math.min(88 / sheet.heightPoints, 72 / sheet.widthPoints)
          }
          rotation={sheet.rotation}
        />
      )}
    </div>
  );
}

function PlanCanvas({
  pdf,
  pageNumber,
  scale,
  rotation,
  label,
  markers,
  onPoint,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  rotation: number;
  label?: string;
  markers?: CalibrationPoints;
  onPoint?: ((point: EnterpriseTakeoffPoint) => void) | undefined;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<PageRender>({ status: 'rendering' });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let active = true;
    let task: RenderTask | undefined;
    async function render() {
      const page = await pdf.getPage(pageNumber);
      if (!active || !canvas) return;
      const viewport = page.getViewport({ scale, rotation });
      const pixelRatio = Math.min(
        window.devicePixelRatio || 1,
        2,
        4096 / viewport.width,
        4096 / viewport.height,
        Math.sqrt(maxCanvasPixels / (viewport.width * viewport.height)),
      );
      canvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio));
      canvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio));
      canvas.style.width = Math.ceil(viewport.width) + 'px';
      canvas.style.height = Math.ceil(viewport.height) + 'px';
      task = page.render({
        canvas,
        viewport,
        transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
      });
      await task.promise;
      if (active)
        setState({
          status: 'ready',
          viewport,
          reference: page.getViewport({ scale: 1, rotation: 0 }),
        });
    }
    void render().catch(() => {
      if (active) setState({ status: 'failed' });
    });
    return () => {
      active = false;
      task?.cancel();
    };
  }, [pdf, pageNumber, scale, rotation]);

  function selectPoint(event: MouseEvent<HTMLCanvasElement>) {
    if (!onPoint || state.status !== 'ready') return;
    const rect = event.currentTarget.getBoundingClientRect();
    const source = state.viewport.convertToPdfPoint(
      ((event.clientX - rect.left) / rect.width) * state.viewport.width,
      ((event.clientY - rect.top) / rect.height) * state.viewport.height,
    );
    const [x = 0, y = 0] = state.reference.convertToViewportPoint(source[0] ?? 0, source[1] ?? 0);
    onPoint({
      x: Math.min(state.reference.width, Math.max(0, x)),
      y: Math.min(state.reference.height, Math.max(0, y)),
    });
  }

  return (
    <>
      <div className={label ? 'enterprise-takeoff-drawing' : undefined}>
        <canvas
          ref={ref}
          role={label ? 'img' : undefined}
          aria-label={label}
          data-capturing={onPoint ? 'true' : undefined}
          onClick={onPoint ? selectPoint : undefined}
          hidden={state.status !== 'ready'}
        />
        {state.status === 'ready' &&
          markers &&
          Object.entries(markers).map(([id, draft]) => {
            const point = parseCalibrationPoint(draft);
            if (
              !point ||
              point.x < 0 ||
              point.x > state.reference.width ||
              point.y < 0 ||
              point.y > state.reference.height
            )
              return null;
            const source = state.reference.convertToPdfPoint(point.x, point.y);
            const [x = 0, y = 0] = state.viewport.convertToViewportPoint(
              source[0] ?? 0,
              source[1] ?? 0,
            );
            return (
              <span
                key={id}
                aria-hidden="true"
                className="enterprise-takeoff-marker"
                style={{
                  left: (x / state.viewport.width) * 100 + '%',
                  top: (y / state.viewport.height) * 100 + '%',
                }}
              >
                {markerLabels[id as CalibrationPointKey]}
              </span>
            );
          })}
      </div>
      {label && state.status === 'rendering' && <p role="status">Rendering sheet…</p>}
      {label && state.status === 'failed' && (
        <p role="alert" className="enterprise-error">
          This sheet could not be rendered.
        </p>
      )}
    </>
  );
}
