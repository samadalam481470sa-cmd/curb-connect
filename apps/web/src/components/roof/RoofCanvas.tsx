'use client';

// Roof drawing surface (RF-023, RR-032, COS-204, ADD-027, ADD-030). Plan coordinates are metres in
// a local east/north frame; the SVG flips y so north is up. Pointer and keyboard are equivalent:
// arrow keys move a crosshair (Shift = 1 m, otherwise 0.1 m; with a selected vertex in Select mode
// they nudge it), Enter/Space places a corner, Escape cancels, Backspace removes the last corner.
// Snapping to existing vertices happens within a screen-size tolerance.
import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { EDGE_LABELS, EDGE_STYLE, snapPoint, type Preview, type Pt } from './model';
import styles from './roof.module.css';

export type Tool = 'select' | 'draw' | 'edge' | 'exclude';

export interface ViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export function viewBoxFor(vertices: readonly Pt[], pad = 4): ViewBox {
  if (vertices.length === 0) return { minX: -20, minY: -15, width: 40, height: 30 };
  const xs = vertices.map((v) => v.x);
  const ys = vertices.map((v) => v.y);
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  let width = Math.max(maxX - minX, 8);
  let height = Math.max(maxY - minY, 6);
  // Keep the 4:3 surface aspect.
  if (width / height > 4 / 3) height = (width * 3) / 4;
  else width = (height * 4) / 3;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { minX: cx - width / 2, minY: cy - height / 2, width, height };
}

export interface RoofCanvasProps {
  preview: Preview;
  viewBox: ViewBox;
  tool: Tool;
  selectedFacetId: string | null;
  selectedEdgeId: string | null;
  readOnly: boolean;
  backdrop?: ReactNode;
  legend?: ReactNode;
  onSelectFacet: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
  onMoveVertex: (id: string, p: Pt) => void;
  /** A closed polygon was traced (draw or exclude tool). */
  onPolygon: (points: { point: Pt; vertexId: string | null }[]) => void;
}

export function RoofCanvas(props: RoofCanvasProps) {
  const { preview, viewBox: vb, tool, readOnly } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const [draft, setDraft] = useState<{ point: Pt; vertexId: string | null }[]>([]);
  const [cursor, setCursor] = useState<Pt>({ x: vb.minX + vb.width / 2, y: vb.minY + vb.height / 2 });
  const [drag, setDrag] = useState<{ id: string; p: Pt } | null>(null);
  const [selectedVertex, setSelectedVertex] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const vById = useMemo(() => new Map(preview.vertices.map((v) => [v.id, v])), [preview.vertices]);
  const snapTol = vb.width / 60;
  const stroke = vb.width / 400;

  const toPlan = (e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current;
    const r = svg?.getBoundingClientRect();
    if (!r || r.width === 0) return cursor;
    const x = vb.minX + ((e.clientX - r.left) / r.width) * vb.width;
    const y = -(-(vb.minY + vb.height) + ((e.clientY - r.top) / r.height) * vb.height);
    return { x, y };
  };

  const place = (raw: Pt) => {
    if (readOnly || (tool !== 'draw' && tool !== 'exclude')) return;
    const snapped = tool === 'draw' ? snapPoint(raw, preview.vertices, snapTol, 0.05) : { point: snapPoint(raw, [], 0, 0.05).point, vertexId: null };
    const first = draft[0];
    if (first && draft.length >= 3 && Math.hypot(first.point.x - snapped.point.x, first.point.y - snapped.point.y) <= snapTol) {
      finish();
      return;
    }
    setDraft((d) => [...d, snapped]);
    setAnnounce(`Corner ${draft.length + 1} placed${snapped.vertexId ? ', snapped to an existing corner' : ''}.`);
  };

  const finish = () => {
    if (draft.length >= 3) {
      props.onPolygon(draft);
      setAnnounce(tool === 'exclude' ? 'Exclusion added.' : 'Facet added.');
    } else setAnnounce('A facet needs at least three corners.');
    setDraft([]);
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const stepM = e.shiftKey ? 1 : 0.1;
    const d: Record<string, Pt> = { ArrowLeft: { x: -stepM, y: 0 }, ArrowRight: { x: stepM, y: 0 }, ArrowUp: { x: 0, y: stepM }, ArrowDown: { x: 0, y: -stepM } };
    const delta = d[e.key];
    if (delta) {
      e.preventDefault();
      if (tool === 'select' && selectedVertex && !readOnly) {
        const v = vById.get(selectedVertex);
        if (v) props.onMoveVertex(selectedVertex, { x: v.x + delta.x, y: v.y + delta.y });
        return;
      }
      setCursor((c) => ({ x: c.x + delta.x, y: c.y + delta.y }));
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (tool === 'draw' || tool === 'exclude') {
        if (e.key === 'Enter' && draft.length >= 3 && e.ctrlKey) finish();
        else place(cursor);
      }
    } else if (e.key === 'Escape') {
      setDraft([]);
      setSelectedVertex(null);
      setAnnounce('Cancelled.');
    } else if (e.key === 'Backspace' && draft.length) {
      e.preventDefault();
      setDraft((dd) => dd.slice(0, -1));
    } else if (e.key.toLowerCase() === 'c' && draft.length >= 3) {
      finish();
    }
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    svgRef.current?.focus();
    const p = toPlan(e);
    setCursor(p);
    if (tool === 'draw' || tool === 'exclude') place(p);
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const p = toPlan(e);
    if (drag) setDrag({ id: drag.id, p: snapPoint(p, preview.vertices.filter((v) => v.id !== drag.id), snapTol, 0.05).point });
    else if (tool === 'draw' || tool === 'exclude') setCursor(p);
  };
  const onPointerUp = () => {
    if (drag) {
      props.onMoveVertex(drag.id, drag.p);
      setDrag(null);
    }
  };

  const pos = (id: string): Pt | undefined => (drag?.id === id ? drag.p : vById.get(id));
  const sy = (y: number) => -y;

  return (
    <div className={styles.canvasWrap}>
      {props.backdrop}
      <svg
        ref={svgRef}
        className={styles.svg}
        viewBox={`${vb.minX} ${sy(vb.minY + vb.height)} ${vb.width} ${vb.height}`}
        role="application"
        aria-label={`Roof drawing surface, ${tool} tool. Arrow keys move the crosshair, Enter places a corner, C closes the shape, Escape cancels.`}
        aria-describedby="roof-canvas-help"
        tabIndex={0}
        onKeyDown={onKey}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        data-testid="roof-canvas"
      >
        {preview.facets.map((f) => {
          const pts = f.vertexIds.map(pos).filter((p): p is Pt => Boolean(p));
          const sel = f.id === props.selectedFacetId;
          return (
            <polygon
              key={f.id}
              points={pts.map((p) => `${p.x},${sy(p.y)}`).join(' ')}
              fill={sel ? 'rgba(34,211,238,0.28)' : 'rgba(34,211,238,0.10)'}
              stroke="none"
              data-facet={f.id}
              onPointerDown={(e) => {
                if (tool === 'select') {
                  e.stopPropagation();
                  props.onSelectFacet(f.id);
                }
              }}
            >
              <title>{`Facet ${f.id}`}</title>
            </polygon>
          );
        })}
        {preview.edges.map((e) => {
          const a = pos(e.a);
          const b = pos(e.b);
          if (!a || !b) return null;
          const st = EDGE_STYLE[e.type];
          const sel = e.id === props.selectedEdgeId;
          return (
            <line
              key={e.id}
              x1={a.x}
              y1={sy(a.y)}
              x2={b.x}
              y2={sy(b.y)}
              stroke={e.conflict ? '#f87171' : st.color}
              strokeWidth={sel ? stroke * 3 : stroke * 1.6}
              strokeDasharray={st.dash ? st.dash.split(' ').map((n) => Number(n) * stroke).join(' ') : undefined}
              data-edge={e.id}
              onPointerDown={(ev) => {
                if (tool === 'edge' || tool === 'select') {
                  ev.stopPropagation();
                  props.onSelectEdge(e.id);
                }
              }}
            >
              <title>{`${EDGE_LABELS[e.type]}${e.conflict ? ` (conflict: ${e.conflict})` : ''}`}</title>
            </line>
          );
        })}
        {preview.vertices.map((v) => {
          const p = pos(v.id)!;
          return (
            <circle
              key={v.id}
              cx={p.x}
              cy={sy(p.y)}
              r={stroke * (selectedVertex === v.id ? 5 : 3)}
              fill={selectedVertex === v.id ? '#22d3ee' : '#e2e8f0'}
              stroke="#0b0f14"
              strokeWidth={stroke}
              onPointerDown={(e) => {
                if (tool === 'select' && !readOnly) {
                  e.stopPropagation();
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  setSelectedVertex(v.id);
                  setDrag({ id: v.id, p });
                }
              }}
            />
          );
        })}
        {draft.length > 0 && (
          <polyline points={[...draft.map((d) => d.point), cursor].map((p) => `${p.x},${sy(p.y)}`).join(' ')} fill="none" stroke="#22d3ee" strokeWidth={stroke * 1.5} strokeDasharray={`${stroke * 4} ${stroke * 2}`} />
        )}
        {(tool === 'draw' || tool === 'exclude') && (
          <g aria-hidden="true">
            <line x1={cursor.x - stroke * 8} y1={sy(cursor.y)} x2={cursor.x + stroke * 8} y2={sy(cursor.y)} stroke="#22d3ee" strokeWidth={stroke} />
            <line x1={cursor.x} y1={sy(cursor.y) - stroke * 8} x2={cursor.x} y2={sy(cursor.y) + stroke * 8} stroke="#22d3ee" strokeWidth={stroke} />
          </g>
        )}
      </svg>
      {props.legend}
      <p id="roof-canvas-help" hidden>
        Select tool: click or Tab to a facet; drag a corner or nudge it with the arrow keys. Draw tool: place corners; close on the first corner or press C. Edge tool: click an edge to relabel it.
      </p>
      <div role="status" aria-live="polite" className="fl-visually-hidden" data-testid="canvas-announce">
        {announce}
      </div>
    </div>
  );
}
