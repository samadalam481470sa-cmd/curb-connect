'use client';

// CAD plan editor for the House Studio (CAD Studio: editing, snaps, undo, DXF round trip).
// The plan is the same house the 3D studio, takeoff and prices use: drag the outside walls to
// resize (snapped to whole feet, inside the layout limits), type exact sizes, pick the floor,
// pan and zoom, undo and redo, and export the floor plan to AutoCAD as DXF. AutoCAD DXF files are
// opened through "Upload plan" in the AI bar, which measures them and fills this plan.
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react';
import { floorPlanDxf } from './BlueprintPlan';
import { LIMITS } from './layout';
import { type BuildSpec, computeTakeoff } from './takeoff';

type Edge = 'east' | 'south';
const PAD = 14;

export function CadEditor({ spec, onSpec }: { spec: BuildSpec; onSpec: (next: BuildSpec) => void }) {
  const [floor, setFloor] = useState(0);
  const [history, setHistory] = useState<BuildSpec[]>([]);
  const [future, setFuture] = useState<BuildSpec[]>([]);
  const [drag, setDrag] = useState<{ edge: Edge; startPx: number; startFt: number; ftPerPx: number } | null>(null);
  const [preview, setPreview] = useState<{ lengthFt: number; widthFt: number } | null>(null);
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [pan, setPan] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const layout = useMemo(() => computeTakeoff(preview ? { ...spec, ...preview } : spec).layout, [spec, preview]);
  const safeFloor = Math.min(floor, layout.floors.length - 1);
  const rooms = layout.floors[safeFloor]?.rooms ?? [];
  const L = layout.footprint.lengthFt;
  const W = layout.footprint.widthFt;
  const garage = safeFloor === 0 ? layout.garage : null;
  const totalL = L + (garage ? garage.w : 0);
  const vbW = totalL + PAD * 2;
  const vbH = W + PAD * 2;

  const commit = (next: BuildSpec) => {
    if (next.lengthFt === spec.lengthFt && next.widthFt === spec.widthFt && next.stories === spec.stories) return;
    setHistory((h) => [...h.slice(-49), spec]);
    setFuture([]);
    onSpec(next);
  };
  const undo = () => {
    const prev = history.at(-1);
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setFuture((f) => [spec, ...f]);
    onSpec(prev);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((f) => f.slice(1));
    setHistory((h) => [...h, spec]);
    onSpec(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const ftPerPx = () => {
    const box = svgRef.current?.getBoundingClientRect();
    return box && box.width > 0 ? vbW / view.zoom / box.width : 0.1;
  };
  const startEdge = (edge: Edge, e: ReactPointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ edge, startPx: edge === 'east' ? e.clientX : e.clientY, startFt: edge === 'east' ? spec.lengthFt : spec.widthFt, ftPerPx: ftPerPx() });
  };
  const onMove = (e: ReactPointerEvent) => {
    if (drag) {
      const delta = ((drag.edge === 'east' ? e.clientX : e.clientY) - drag.startPx) * drag.ftPerPx;
      const raw = Math.round(drag.startFt + delta);
      if (drag.edge === 'east') setPreview({ lengthFt: Math.min(LIMITS.maxLength, Math.max(LIMITS.minLength, raw)), widthFt: spec.widthFt });
      else setPreview({ lengthFt: spec.lengthFt, widthFt: Math.min(LIMITS.maxWidth, Math.max(LIMITS.minWidth, raw)) });
    } else if (pan) {
      const k = ftPerPx();
      setView((v) => ({ ...v, panX: pan.panX - (e.clientX - pan.x) * k, panY: pan.panY - (e.clientY - pan.y) * k }));
    }
  };
  const onUp = () => {
    if (drag && preview) commit({ ...spec, ...preview });
    setDrag(null);
    setPreview(null);
    setPan(null);
  };
  const onWheel = (e: WheelEvent) => {
    setView((v) => ({ ...v, zoom: Math.min(6, Math.max(0.5, v.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))) }));
  };

  const setSize = (key: 'lengthFt' | 'widthFt', raw: string) => {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n)) return;
    const [min, max] = key === 'lengthFt' ? [LIMITS.minLength, LIMITS.maxLength] : [LIMITS.minWidth, LIMITS.maxWidth];
    commit({ ...spec, [key]: Math.min(max, Math.max(min, n)) });
  };
  const exportDxf = () => {
    const url = URL.createObjectURL(new Blob([floorPlanDxf(computeTakeoff(spec).layout, safeFloor)], { type: 'application/dxf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `fieldpro-plan-L${safeFloor + 1}.dxf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const vw = vbW / view.zoom;
  const vh = vbH / view.zoom;
  const vx = (vbW - vw) / 2 + view.panX;
  const vy = (vbH - vh) / 2 + view.panY;
  const room = rooms.find((r) => r.id === selected) ?? (garage?.id === selected ? garage : null);

  return (
    <div className="cad">
      <div className="cad-tools" role="toolbar" aria-label="Plan editor tools">
        <label>
          Length
          <input type="number" aria-label="Plan length in feet" value={spec.lengthFt} min={LIMITS.minLength} max={LIMITS.maxLength} onChange={(e) => setSize('lengthFt', e.target.value)} />
          ft
        </label>
        <label>
          Width
          <input type="number" aria-label="Plan width in feet" value={spec.widthFt} min={LIMITS.minWidth} max={LIMITS.maxWidth} onChange={(e) => setSize('widthFt', e.target.value)} />
          ft
        </label>
        {layout.floors.length > 1 &&
          layout.floors.map((f, i) => (
            <button key={f.level} type="button" className={`hs-pill ${i === safeFloor ? 'is-on' : ''}`} onClick={() => setFloor(i)}>
              Level {i + 1}
            </button>
          ))}
        <button type="button" className="hs-pill" onClick={undo} disabled={!history.length} aria-label="Undo">
          Undo
        </button>
        <button type="button" className="hs-pill" onClick={redo} disabled={!future.length} aria-label="Redo">
          Redo
        </button>
        <button type="button" className="hs-pill" onClick={() => setView({ zoom: 1, panX: 0, panY: 0 })}>
          Fit
        </button>
        <button type="button" className="hs-pill is-on" onClick={exportDxf}>
          Export DXF (AutoCAD)
        </button>
      </div>
      <svg
        ref={svgRef}
        className="cad-sheet"
        viewBox={`${vx} ${vy} ${vw} ${vh}`}
        role="img"
        aria-label={`Floor plan level ${safeFloor + 1}, ${L} by ${W} feet. Drag the blue handles to resize.`}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        onPointerDown={(e) => {
          if (e.target === svgRef.current) {
            setSelected(null);
            setPan({ x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY });
          }
        }}
        onWheel={onWheel}
        style={{ touchAction: 'none' }}
      >
        <defs>
          <pattern id="cad-grid" width="1" height="1" patternUnits="userSpaceOnUse">
            <path d="M 1 0 L 0 0 0 1" fill="none" stroke="rgba(120,170,255,.10)" strokeWidth="0.04" />
          </pattern>
        </defs>
        <rect x={-200} y={-200} width={vbW + 400} height={vbH + 400} fill="url(#cad-grid)" pointerEvents="none" />
        <g transform={`translate(${PAD} ${PAD})`}>
          {rooms.map((r) => (
            <g key={r.id} onPointerDown={(e) => { e.stopPropagation(); setSelected(r.id); }} className="cad-room">
              <rect x={r.x} y={r.y} width={r.w} height={r.h} className={selected === r.id ? 'is-sel' : ''} />
              {r.w > 6 && r.h > 4 && (
                <text x={r.x + r.w / 2} y={r.y + r.h / 2} textAnchor="middle" fontSize={Math.min(1.4, r.w / 7)}>
                  {r.name}
                  <tspan x={r.x + r.w / 2} dy={1.5} fontSize={Math.min(1.1, r.w / 9)}>
                    {r.w.toFixed(1)} × {r.h.toFixed(1)}
                  </tspan>
                </text>
              )}
            </g>
          ))}
          {garage && (
            <g className="cad-room cad-garage" onPointerDown={(e) => { e.stopPropagation(); setSelected(garage.id); }}>
              <rect x={garage.x} y={garage.y} width={garage.w} height={garage.h} className={selected === garage.id ? 'is-sel' : ''} />
              <text x={garage.x + garage.w / 2} y={garage.y + garage.h / 2} textAnchor="middle" fontSize={1.3}>
                Garage
              </text>
            </g>
          )}
          <rect x={0} y={0} width={L} height={W} className="cad-outline" />
          {/* Dimensions */}
          <g className="cad-dim">
            <line x1={0} y1={-4} x2={L} y2={-4} />
            <text x={L / 2} y={-5} textAnchor="middle" fontSize={1.4}>
              {L}&apos;-0&quot;
            </text>
            <line x1={-4} y1={0} x2={-4} y2={W} />
            <text x={-5} y={W / 2} textAnchor="middle" fontSize={1.4} transform={`rotate(-90 ${-5} ${W / 2})`}>
              {W}&apos;-0&quot;
            </text>
          </g>
          {/* Resize handles */}
          <rect x={L - 0.6} y={W / 2 - 3} width={1.2} height={6} rx={0.4} className="cad-handle" onPointerDown={(e) => startEdge('east', e)} aria-label="Drag to change length" role="slider" aria-valuenow={L} aria-valuemin={LIMITS.minLength} aria-valuemax={LIMITS.maxLength} />
          <rect x={L / 2 - 3} y={W - 0.6} width={6} height={1.2} rx={0.4} className="cad-handle" onPointerDown={(e) => startEdge('south', e)} aria-label="Drag to change width" role="slider" aria-valuenow={W} aria-valuemin={LIMITS.minWidth} aria-valuemax={LIMITS.maxWidth} />
        </g>
      </svg>
      <p className="cad-status" role="status">
        {room
          ? `${room.name}: ${room.w.toFixed(1)} × ${room.h.toFixed(1)} ft (${Math.round(room.w * room.h)} SF)`
          : `${L} × ${W} ft, ${layout.conditionedAreaSqFt.toLocaleString('en-US')} SF living. Drag the blue handles, scroll to zoom, drag the background to pan, Ctrl+Z to undo.`}
      </p>
      {layout.warnings.length > 0 && <p className="cad-warn">{layout.warnings.join(' ')}</p>}
      <p className="cad-note">
        AutoCAD: export here as DXF and open it in AutoCAD. To bring a drawing back, upload the .dwg or .dxf in the AI bar.
      </p>
    </div>
  );
}
