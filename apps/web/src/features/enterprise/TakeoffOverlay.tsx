'use client';

import type { TakeoffComparisonPreview } from '@fieldline/contracts';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { loadPrivatePdfEngine } from './loadPrivatePdf';
import { markPlanPixelDifferences } from './takeoffComparisonPixels';

type Preview = z.infer<typeof TakeoffComparisonPreview>;
type Layer = 'overlay' | 'earlier' | 'current';
type Raster = { images: Record<Layer, ImageData>; addedPixels: number; removedPixels: number };

export function TakeoffOverlay({
  projectPath,
  preview,
}: {
  projectPath: string;
  preview: Preview;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [layer, setLayer] = useState<Layer>('overlay');
  const [attempt, setAttempt] = useState(0);
  const [raster, setRaster] = useState<Raster | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const loaders: PDFDocumentLoadingTask[] = [];
    const jobs: RenderTask[] = [];
    async function compare() {
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
      const currentRotation = (current.rotation + alignment.rotation) % 360;
      function size(sheet: Preview['earlier'], rotation: number, scale: number) {
        const sideways = rotation % 180 !== 0;
        return {
          width: (sideways ? sheet.heightPoints : sheet.widthPoints) * scale,
          height: (sideways ? sheet.widthPoints : sheet.heightPoints) * scale,
        };
      }
      const previousSize = size(earlier, earlier.rotation, 1);
      const currentSize = size(current, currentRotation, alignment.scale);
      const minX = Math.min(0, alignment.offsetX);
      const minY = Math.min(0, alignment.offsetY);
      const unitsWide = Math.max(previousSize.width, alignment.offsetX + currentSize.width) - minX;
      const unitsHigh =
        Math.max(previousSize.height, alignment.offsetY + currentSize.height) - minY;
      const scale = Math.min(2, 1200 / unitsWide, 1200 / unitsHigh);
      const width = Math.max(1, Math.ceil(unitsWide * scale));
      const height = Math.max(1, Math.ceil(unitsHigh * scale));

      async function paint(pdf: PDFDocumentProxy, sheet: Preview['earlier'], moved: boolean) {
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
            scale: scale * (moved ? alignment.scale : 1),
            rotation: moved ? currentRotation : sheet.rotation,
          }),
          background: '#fff',
          transform: [
            1,
            0,
            0,
            1,
            ((moved ? alignment.offsetX : 0) - minX) * scale,
            ((moved ? alignment.offsetY : 0) - minY) * scale,
          ],
        });
        jobs.push(job);
        await job.promise;
        return context.getImageData(0, 0, width, height);
      }

      const oldInk = await paint(oldPdf, earlier, false);
      if (!active || !oldInk) return;
      const newInk = await paint(newPdf, current, true);
      if (!active || !newInk) return;
      const { overlay, addedPixels, removedPixels } = markPlanPixelDifferences(
        oldInk.data,
        newInk.data,
      );
      setRaster({
        images: {
          earlier: oldInk,
          current: newInk,
          overlay: new ImageData(new Uint8ClampedArray(overlay), width, height),
        },
        addedPixels,
        removedPixels,
      });
    }
    void compare().catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
      for (const job of jobs) job.cancel();
      for (const loader of loaders) void loader.destroy().catch(() => undefined);
    };
  }, [projectPath, preview, attempt]);

  useEffect(() => {
    const visible = canvas.current;
    if (!raster || !visible) return;
    const pixels = raster.images[layer];
    visible.width = pixels.width;
    visible.height = pixels.height;
    visible.getContext('2d')?.putImageData(pixels, 0, 0);
  }, [raster, layer]);

  if (failed)
    return (
      <div>
        <p role="alert" className="enterprise-error">
          The comparison could not render both drawings.
        </p>
        <button
          type="button"
          onClick={() => {
            setRaster(null);
            setFailed(false);
            setAttempt((value) => value + 1);
          }}
        >
          Retry drawing comparison
        </button>
      </div>
    );
  return (
    <section aria-label="Drawing overlay" className="enterprise-stack">
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
      <canvas
        ref={canvas}
        role="img"
        aria-label="Compared plan drawings"
        hidden={!raster}
        style={{ maxWidth: '100%', height: 'auto', border: '1px solid var(--border)' }}
      />
    </section>
  );
}
