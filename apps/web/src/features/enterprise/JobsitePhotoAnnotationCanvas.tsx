'use client';

import type { JobsiteAnnotationPoint, JobsitePhotoAnnotation } from '@fieldline/contracts';
import { useEffect, useRef, useState, type PointerEvent } from 'react';

const amber = '#ffb137';

function paint(
  layer: CanvasRenderingContext2D,
  source: HTMLImageElement,
  annotations: readonly JobsitePhotoAnnotation[],
) {
  const { width, height } = layer.canvas;
  layer.drawImage(source, 0, 0, width, height);
  layer.strokeStyle = amber;
  layer.lineWidth = Math.max(2, 4 * (width / 640));
  layer.lineJoin = 'round';
  for (const shape of annotations) {
    if (shape.kind === 'note') {
      const left = Math.min(shape.at.x * width, width * 0.72);
      const top = Math.min(shape.at.y * height, height - 26);
      layer.fillStyle = '#fff1b5';
      layer.fillRect(left, top, width * 0.28, 26);
      layer.fillStyle = '#10212c';
      layer.font = '14px sans-serif';
      layer.fillText(shape.text, left + 4, top + 18, width * 0.28 - 8);
      continue;
    }
    const x = shape.from.x * width;
    const y = shape.from.y * height;
    const endX = shape.to.x * width;
    const endY = shape.to.y * height;
    if (shape.kind === 'redaction') {
      layer.fillStyle = '#000';
      layer.fillRect(x, y, endX - x, endY - y);
    } else if (shape.kind === 'box') {
      layer.strokeRect(x, y, endX - x, endY - y);
    } else {
      const angle = Math.atan2(endY - y, endX - x);
      const step = Math.min(22, Math.hypot(endX - x, endY - y) / 3);
      layer.beginPath();
      layer.moveTo(x, y);
      layer.lineTo(endX, endY);
      for (const offset of [-0.55, 0.55]) {
        layer.moveTo(endX, endY);
        layer.lineTo(
          endX - Math.cos(angle + offset) * step,
          endY - Math.sin(angle + offset) * step,
        );
      }
      layer.stroke();
    }
  }
}

function position(event: PointerEvent<HTMLCanvasElement>): JobsiteAnnotationPoint {
  const { x, y, width, height } = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - x) / width)),
    y: Math.max(0, Math.min(1, (event.clientY - y) / height)),
  };
}

export function JobsitePhotoAnnotationCanvas({
  sourceUrl,
  annotations,
  active,
  kind,
  onDraw,
}: {
  sourceUrl: string;
  annotations: readonly JobsitePhotoAnnotation[];
  active: boolean;
  kind: JobsitePhotoAnnotation['kind'];
  onDraw: (from: JobsiteAnnotationPoint, to: JobsiteAnnotationPoint) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const start = useRef<JobsiteAnnotationPoint | null>(null);
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [preview, setPreview] = useState<{
    from: JobsiteAnnotationPoint;
    to: JobsiteAnnotationPoint;
  } | null>(null);

  useEffect(() => {
    const image = new window.Image();
    image.onload = () => setSource(image);
    image.onerror = () => setLoadFailed(true);
    image.src = sourceUrl;
    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, [sourceUrl]);

  useEffect(() => {
    const node = canvas.current;
    const layer = node?.getContext('2d');
    if (!source || !node || !layer) return;
    node.width = source.naturalWidth;
    node.height = source.naturalHeight;
    const drawing =
      preview && kind !== 'note' ? [...annotations, { kind, ...preview }] : annotations;
    paint(layer, source, drawing);
  }, [source, annotations, kind, preview]);

  return (
    <>
      {loadFailed && <p role="alert">The photo preview could not be loaded.</p>}
      {!loadFailed && !source && <p role="status">Loading the photo preview…</p>}
      <canvas
        ref={canvas}
        aria-label="Photo annotation canvas"
        className="enterprise-photo-annotation-canvas"
        hidden={!source}
        onPointerDown={(event) => {
          if (!active || !event.isPrimary || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          start.current = position(event);
        }}
        onPointerMove={(event) => {
          if (event.isPrimary && start.current && kind !== 'note')
            setPreview({ from: start.current, to: position(event) });
        }}
        onPointerUp={(event) => {
          if (!event.isPrimary || !start.current) return;
          const from = start.current;
          start.current = null;
          setPreview(null);
          if (active) onDraw(from, position(event));
        }}
        onPointerCancel={() => {
          start.current = null;
          setPreview(null);
        }}
        onLostPointerCapture={() => {
          start.current = null;
          setPreview(null);
        }}
      />
    </>
  );
}
