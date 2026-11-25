'use client';

import { TakeoffComparisonRaster, type TakeoffComparisonPreview } from '@fieldline/contracts';
import { takeoffComparisonLayout } from '@fieldline/geometry';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { z } from 'zod';
import { isApiError } from '../../lib/api';
import { useApi } from '../../lib/session';
import { TakeoffComparisonNotes } from './TakeoffComparisonNotes';
import { loadPrivatePdfEngine } from './loadPrivatePdf';
import { markPlanPixelDifferences } from './takeoffComparisonPixels';

type Preview = z.infer<typeof TakeoffComparisonPreview>;
type Layer = 'overlay' | 'earlier' | 'current';
type Raster = {
  images: Record<Layer, ImageData | HTMLImageElement>;
  renderer: 'server' | 'browser';
  addedPixels: number;
  removedPixels: number;
};

async function loadImage(png: string, width: number, height: number) {
  const element = new Image();
  element.src = 'data:image/png;base64,' + png;
  await element.decode();
  if (element.naturalWidth !== width || element.naturalHeight !== height) {
    throw new Error('The drawing raster dimensions changed.');
  }
  return element;
}

export function TakeoffOverlay({
  projectPath,
  preview,
}: {
  projectPath: string;
  preview: Preview;
}) {
  const { api } = useApi();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [layer, setLayer] = useState<Layer>('overlay');
  const [attempt, setAttempt] = useState(0);
  const [raster, setRaster] = useState<Raster | null>(null);
  const [failure, setFailure] = useState('');

  useEffect(() => {
    let active = true;
    const cancellation = new AbortController();
    const loaders: PDFDocumentLoadingTask[] = [];
    const jobs: RenderTask[] = [];
    async function compareInBrowser() {
      const openPdf = await loadPrivatePdfEngine();
      if (!active) return;
      const { earlier, current, alignment } = preview;
      const source = (versionId: string) => {
        const loader = openPdf(projectPath + '/document-versions/' + versionId + '/download');
        loaders.push(loader);
        return loader.promise;
      };
      const [oldPdf, newPdf] = await Promise.all([
        source(earlier.sourceVersionId),
        source(current.sourceVersionId),
      ]);
      if (!active) return;
      const layout = takeoffComparisonLayout(earlier, current, alignment);
      const { width, height } = layout;

      async function paint(
        pdf: PDFDocumentProxy,
        sheet: Preview['earlier'],
        position: typeof layout.earlier,
      ) {
        const page = await pdf.getPage(sheet.pageNumber);
        if (!active) return null;
        const scratch = document.createElement('canvas');
        scratch.width = width;
        scratch.height = height;
        const context = scratch.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('The drawing comparison needs a canvas.');
        const job = page.render({
          canvas: scratch,
          viewport: page.getViewport({
            scale: position.scale,
            rotation: position.rotation,
          }),
          background: '#fff',
          transform: [1, 0, 0, 1, position.x, position.y],
        });
        jobs.push(job);
        await job.promise;
        return context.getImageData(0, 0, width, height);
      }

      const oldInk = await paint(oldPdf, earlier, layout.earlier);
      if (!active || !oldInk) return;
      const newInk = await paint(newPdf, current, layout.current);
      if (!active || !newInk) return;
      const { overlay, addedPixels, removedPixels } = markPlanPixelDifferences(
        oldInk.data,
        newInk.data,
      );
      setRaster({
        renderer: 'browser',
        images: {
          earlier: oldInk,
          current: newInk,
          overlay: new ImageData(new Uint8ClampedArray(overlay), width, height),
        },
        addedPixels,
        removedPixels,
      });
    }
    async function compare() {
      try {
        const result = await api.post(
          projectPath + '/takeoff/compare/raster',
          {
            oldRevisionId: preview.earlier.planId,
            oldSheetId: preview.earlier.sheetId,
            newRevisionId: preview.current.planId,
            newSheetId: preview.current.sheetId,
            alignment: preview.alignment,
            comparisonKey: preview.comparisonKey,
          },
          { schema: TakeoffComparisonRaster, signal: cancellation.signal },
        );
        if (!active) return;
        const { width, height } = result;
        const [earlier, current, overlay] = await Promise.all([
          loadImage(result.earlierPng, width, height),
          loadImage(result.currentPng, width, height),
          loadImage(result.overlayPng, width, height),
        ]);
        if (active)
          setRaster({
            renderer: 'server',
            images: { earlier, current, overlay },
            addedPixels: result.addedPixels,
            removedPixels: result.removedPixels,
          });
      } catch (cause) {
        if (!active) return;
        if (isApiError(cause) && cause.kind === 'problem' && cause.status < 500) throw cause;
        await compareInBrowser();
      }
    }
    void compare().catch((cause: unknown) => {
      if (active)
        setFailure(
          isApiError(cause) ? cause.message : 'The comparison could not render both drawings.',
        );
    });
    return () => {
      active = false;
      cancellation.abort();
      for (const job of jobs) job.cancel();
      for (const loader of loaders) void loader.destroy().catch(() => undefined);
    };
  }, [api, projectPath, preview, attempt]);

  useEffect(() => {
    const visible = canvas.current;
    if (!raster || !visible) return;
    const pixels = raster.images[layer];
    visible.width = pixels.width;
    visible.height = pixels.height;
    const context = visible.getContext('2d');
    if (pixels instanceof HTMLImageElement) context?.drawImage(pixels, 0, 0);
    else context?.putImageData(pixels, 0, 0);
  }, [raster, layer]);

  function drawing(onClick?: (event: MouseEvent<HTMLCanvasElement>) => void) {
    return (
      <canvas
        ref={canvas}
        role="img"
        aria-label="Compared plan drawings"
        hidden={!raster}
        onClick={onClick}
        style={{ maxWidth: '100%', height: 'auto', border: '1px solid var(--border)' }}
      />
    );
  }

  if (failure)
    return (
      <div>
        <p role="alert" className="enterprise-error">
          {failure}
        </p>
        <button
          type="button"
          onClick={() => {
            setRaster(null);
            setFailure('');
            setAttempt((value) => value + 1);
          }}
        >
          Retry drawing comparison
        </button>
      </div>
    );
  return (
    <section
      aria-label="Drawing overlay"
      className="enterprise-stack"
      data-renderer={raster?.renderer}
    >
      {!raster && <p role="status">Rendering both drawing revisions…</p>}
      {raster && (
        <>
          <div className="enterprise-toolbar">
            <button
              type="button"
              aria-pressed={layer === 'overlay'}
              onClick={() => setLayer('overlay')}
            >
              Overlay
            </button>
            <button
              type="button"
              aria-pressed={layer === 'earlier'}
              onClick={() => setLayer('earlier')}
            >
              Earlier drawing
            </button>
            <button
              type="button"
              aria-pressed={layer === 'current'}
              onClick={() => setLayer('current')}
            >
              Current drawing
            </button>
          </div>
          {layer === 'overlay' && (
            <p>
              Green marks were added. Red marks were removed. Gray marks appear in both drawings.
            </p>
          )}
          <p role="status">
            {raster.addedPixels} added pixels · {raster.removedPixels} removed pixels
          </p>
        </>
      )}
      {raster ? (
        <TakeoffComparisonNotes projectPath={projectPath} preview={preview}>
          {drawing}
        </TakeoffComparisonNotes>
      ) : (
        drawing()
      )}
    </section>
  );
}
