'use client';

// A project photo with an SVG overlay in image-pixel coordinates. Clicking (or tapping) adds a
// point; every point is also listed as editable numbers so the editor works by keyboard and
// screen reader. Used by calibration (reference endpoints, curb-plane points) and the segment
// editor (curb path on the photo).
import type { ReactNode } from 'react';
import { useState } from 'react';

export type Pt = [number, number];

export function PhotoStage({
  src,
  alt,
  onAddPoint,
  children,
  footer,
}: {
  src: string | null;
  alt: string;
  onAddPoint?: (p: Pt) => void;
  children?: (size: { w: number; h: number; displayScale: number }) => ReactNode;
  footer?: ReactNode;
}) {
  const [size, setSize] = useState({ w: 1600, h: 1200 });
  const [displayW, setDisplayW] = useState(800);
  return (
    <figure className="curb-stage">
      <div className="curb-stage__frame">
        {src ? (
          <img
            src={src}
            alt={alt}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth) setSize({ w: img.naturalWidth, h: img.naturalHeight });
              setDisplayW(img.clientWidth || 800);
            }}
          />
        ) : (
          <div className="curb-stage__placeholder" style={{ aspectRatio: `${size.w} / ${size.h}` }}>
            Photo preview unavailable (still processing or offline). Points can still be typed below.
          </div>
        )}
        <svg
          className="curb-stage__overlay"
          viewBox={`0 0 ${size.w} ${size.h}`}
          preserveAspectRatio="none"
          data-testid="photo-overlay"
          onClick={(e) => {
            if (!onAddPoint) return;
            const r = e.currentTarget.getBoundingClientRect();
            if (!r.width || !r.height) return;
            onAddPoint([Math.round(((e.clientX - r.left) / r.width) * size.w), Math.round(((e.clientY - r.top) / r.height) * size.h)]);
          }}
        >
          {children?.({ ...size, displayScale: displayW / size.w })}
        </svg>
      </div>
      {footer && <figcaption>{footer}</figcaption>}
    </figure>
  );
}

export function PointMarkers({ points, color, label }: { points: Pt[]; color: string; label?: (i: number) => string }) {
  return (
    <g>
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p[0]} cy={p[1]} r={14} fill="none" stroke={color} strokeWidth={4} vectorEffect="non-scaling-stroke" />
          <text x={p[0] + 18} y={p[1] - 18} fill={color} fontSize={36} fontWeight={700}>
            {label ? label(i) : i + 1}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Editable list of points (keyboard alternative to clicking on the photo). */
export function PointList({ points, onChange, legend }: { points: Pt[]; onChange: (p: Pt[]) => void; legend: string }) {
  return (
    <fieldset className="curb-points">
      <legend>{legend}</legend>
      {points.length === 0 && <p className="web-muted">Click the photo to place points, or add one here.</p>}
      {points.map((p, i) => (
        <div key={i} className="curb-row">
          <span>#{i + 1}</span>
          <label>
            x <input type="number" value={p[0]} onChange={(e) => onChange(points.map((q, j) => (j === i ? [Number(e.target.value), q[1]] : q)))} />
          </label>
          <label>
            y <input type="number" value={p[1]} onChange={(e) => onChange(points.map((q, j) => (j === i ? [q[0], Number(e.target.value)] : q)))} />
          </label>
          <button type="button" className="curb-link" onClick={() => onChange(points.filter((_, j) => j !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="curb-link" onClick={() => onChange([...points, [0, 0]])}>
        Add point
      </button>
    </fieldset>
  );
}
