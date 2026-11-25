'use client';

import type { EnterpriseTakeoffSheet } from '@fieldline/contracts';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { z } from 'zod';

type Sheet = z.infer<typeof EnterpriseTakeoffSheet>;
const magnifications = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const preferenceKey = 'fieldpro.enterprise.takeoff.zoom';
const maxCanvasPixels = 12_000_000;
const assets = '/pdfjs/';

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
  sheet,
  siblings,
  revisionLabel,
  onView,
  onClose,
}: {
  url: string;
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

  function changeZoom(value: number) {
    setZoom(value);
    rememberZoom(value);
  }

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (
      !pdf ||
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
      <div className="enterprise-takeoff-view-body">
        <nav aria-label="Sheets in this PDF" className="enterprise-takeoff-thumbnails">
          {siblings.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === sheet.id}
              onClick={() => onView(item.id)}
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
            />
          )}
        </div>
      </div>
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
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  rotation: number;
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<'rendering' | 'ready' | 'failed'>('rendering');

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
      if (active) setState('ready');
    }
    void render().catch(() => {
      if (active) setState('failed');
    });
    return () => {
      active = false;
      task?.cancel();
    };
  }, [pdf, pageNumber, scale, rotation]);

  return (
    <>
      <canvas
        ref={ref}
        role={label ? 'img' : undefined}
        aria-label={label}
        hidden={state !== 'ready'}
      />
      {label && state === 'rendering' && <p role="status">Rendering sheet…</p>}
      {label && state === 'failed' && (
        <p role="alert" className="enterprise-error">
          This sheet could not be rendered.
        </p>
      )}
    </>
  );
}
