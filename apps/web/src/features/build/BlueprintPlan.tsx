'use client';

// Top view: a blueprint-style floor plan sheet (A-101) drawn from the schematic layout, with the
// column grid, dimension strings, room names, door swings and a title block.
import type { HouseLayout, Room } from './layout';
import { partitionSegments } from './studioScene';
import { feetInches } from './studioScene';

const LINE = '#a9c6f0';
const DIM = '#7fa3d6';

export function BlueprintPlan({
  layout,
  floorIndex,
  projectName,
}: {
  layout: HouseLayout;
  floorIndex: number;
  projectName: string;
}) {
  const L = layout.footprint.lengthFt;
  const W = layout.footprint.widthFt;
  const floor = layout.floors[floorIndex] ?? layout.floors[0]!;
  const g = floorIndex === 0 ? layout.garage : null;
  const totalL = L + (g?.w ?? 0);
  const margin = 18;
  const block = 30;
  const vbW = totalL + margin * 2 + block;
  const vbH = W + margin * 2;
  const ox = margin + block;
  const oy = margin;
  const xs = Array.from(new Set([0, ...floor.rooms.flatMap((r) => [r.x, r.x + r.w]), L].map((v) => Math.round(v * 100) / 100))).sort((a, b) => a - b);
  const gridX = xs.filter((v, i) => i === 0 || i === xs.length - 1 || v - xs[i - 1]! > 6).slice(0, 8);
  const zs = Array.from(new Set([0, ...floor.rooms.flatMap((r) => [r.y, r.y + r.h]), W].map((v) => Math.round(v * 100) / 100))).sort((a, b) => a - b);
  const gridZ = zs.filter((v, i) => i === 0 || i === zs.length - 1 || v - zs[i - 1]! > 6).slice(0, 6);
  const partitions = partitionSegments(floor.rooms, L, W);
  const wall = 0.5;
  const fs = Math.max(1.1, Math.min(1.8, L / 40));
  const label = (r: Room) => r.name.toUpperCase();

  return (
    <svg
      className="hs-blueprint"
      viewBox={`0 0 ${vbW} ${vbH}`}
      role="img"
      aria-label={`Floor plan sheet A-10${floorIndex + 1}, ${floor.rooms.length} rooms`}
    >
      <rect x={0.5} y={0.5} width={vbW - 1} height={vbH - 1} fill="#0b1424" stroke={LINE} strokeWidth={0.25} />
      {/* Title block */}
      <g>
        <rect x={2} y={2} width={block - 4} height={vbH - 4} fill="none" stroke={LINE} strokeWidth={0.25} />
        <text x={block / 2} y={8} fill={LINE} fontSize={1.4} textAnchor="middle" fontWeight={700}>
          {projectName.toUpperCase().slice(0, 28)}
        </text>
        <line x1={4} x2={block - 4} y1={11} y2={11} stroke={LINE} strokeWidth={0.15} />
        <text x={block / 2} y={15} fill={LINE} fontSize={1.2} textAnchor="middle">
          FLOOR PLAN · LEVEL {floor.level}
        </text>
        <text x={block / 2} y={18} fill={DIM} fontSize={1} textAnchor="middle">
          {layout.conditionedAreaSqFt.toLocaleString('en-US')} SF CONDITIONED
        </text>
        {Array.from({ length: Math.max(0, Math.floor((vbH - 34) / 5)) }, (_, i) => (
          <line key={i} x1={4} x2={block - 4} y1={22 + i * 5} y2={22 + i * 5} stroke={LINE} strokeWidth={0.08} opacity={0.6} />
        ))}
        <rect x={4} y={vbH - 12} width={block - 8} height={8} fill="none" stroke={LINE} strokeWidth={0.2} />
        <text x={block / 2} y={vbH - 6.6} fill={LINE} fontSize={2.4} textAnchor="middle" fontWeight={700}>
          A-10{floorIndex + 1}
        </text>
      </g>
      {/* North arrow */}
      <g transform={`translate(${ox + 4} ${oy - 9})`}>
        <circle r={3} fill="none" stroke={LINE} strokeWidth={0.2} />
        <path d="M0 -2.4 L1 1.6 L0 0.8 L-1 1.6 Z" fill={LINE} />
        <text y={4.8} fill={LINE} fontSize={1.2} textAnchor="middle">N</text>
      </g>
      <g transform={`translate(${ox} ${oy})`}>
        {/* Column grid */}
        {gridX.map((x, i) => (
          <g key={`gx${x}`}>
            <line x1={x} x2={x} y1={-10} y2={W + 10} stroke={DIM} strokeWidth={0.1} strokeDasharray="1.2 0.8" />
            {[-12, W + 12].map((y) => (
              <g key={y}>
                <circle cx={x} cy={y} r={1.6} fill="#0b1424" stroke={LINE} strokeWidth={0.2} />
                <text x={x} y={y + 0.5} fill={LINE} fontSize={1.4} textAnchor="middle">{String.fromCharCode(65 + i)}</text>
              </g>
            ))}
          </g>
        ))}
        {gridZ.map((z, i) => (
          <g key={`gz${z}`}>
            <line x1={-10} x2={totalL + 10} y1={z} y2={z} stroke={DIM} strokeWidth={0.1} strokeDasharray="1.2 0.8" />
            {[-12, totalL + 12].map((x) => (
              <g key={x}>
                <circle cx={x} cy={z} r={1.6} fill="#0b1424" stroke={LINE} strokeWidth={0.2} />
                <text x={x} y={z + 0.5} fill={LINE} fontSize={1.4} textAnchor="middle">{i + 1}</text>
              </g>
            ))}
          </g>
        ))}
        {/* Rooms */}
        {floor.rooms.map((r) => (
          <g key={r.id}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={r.kind === 'bath' ? 'rgba(120,170,230,0.08)' : 'none'} />
            <text x={r.x + r.w / 2} y={r.y + r.h / 2} fill={LINE} fontSize={Math.min(fs, r.w / 6)} textAnchor="middle" fontWeight={600}>
              {label(r)}
            </text>
            <text x={r.x + r.w / 2} y={r.y + r.h / 2 + fs * 1.2} fill={DIM} fontSize={Math.min(fs * 0.75, r.w / 8)} textAnchor="middle">
              {feetInches(r.w)} × {feetInches(r.h)}
            </text>
          </g>
        ))}
        {/* Partitions */}
        {partitions.map(([x0, z0, x1, z1]) => (
          <line key={`${x0}-${z0}-${x1}-${z1}`} x1={x0} y1={z0} x2={x1} y2={z1} stroke={LINE} strokeWidth={0.35} />
        ))}
        {/* Exterior walls (double line) */}
        <rect x={0} y={0} width={L} height={W} fill="none" stroke="#e4eefc" strokeWidth={wall} />
        <rect x={wall} y={wall} width={L - wall * 2} height={W - wall * 2} fill="none" stroke={LINE} strokeWidth={0.12} />
        {g && (
          <g>
            <rect x={g.x} y={g.y} width={g.w} height={g.h} fill="none" stroke="#e4eefc" strokeWidth={wall} />
            <text x={g.x + g.w / 2} y={g.y + g.h / 2} fill={LINE} fontSize={fs} textAnchor="middle" fontWeight={600}>
              {g.name.toUpperCase()}
            </text>
          </g>
        )}
        {/* Front door swing on the street side */}
        {floorIndex === 0 && (
          <path d={`M ${L * 0.42} ${W} A 3 3 0 0 1 ${L * 0.42 + 3} ${W - 3} L ${L * 0.42} ${W - 3}`} fill="none" stroke={LINE} strokeWidth={0.12} />
        )}
        {/* Overall dimensions */}
        <g stroke={DIM} strokeWidth={0.12}>
          <line x1={0} x2={totalL} y1={W + 6} y2={W + 6} />
          <line x1={0} x2={0} y1={W + 5} y2={W + 7} />
          <line x1={totalL} x2={totalL} y1={W + 5} y2={W + 7} />
          <line x1={-6} x2={-6} y1={0} y2={W} />
          <line x1={-7} x2={-5} y1={0} y2={0} />
          <line x1={-7} x2={-5} y1={W} y2={W} />
        </g>
        <text x={totalL / 2} y={W + 5.2} fill={LINE} fontSize={1.3} textAnchor="middle">{feetInches(totalL)}</text>
        <text x={-7} y={W / 2} fill={LINE} fontSize={1.3} textAnchor="middle" transform={`rotate(-90 -7 ${W / 2})`}>
          {feetInches(W)}
        </text>
      </g>
    </svg>
  );
}

/** DXF (AutoCAD R12 ASCII) of a floor: walls, partitions, room names, garage and dimensions. */
export function floorPlanDxf(layout: HouseLayout, floorIndex: number): string {
  const L = layout.footprint.lengthFt;
  const W = layout.footprint.widthFt;
  const floor = layout.floors[floorIndex] ?? layout.floors[0]!;
  const g = floorIndex === 0 ? layout.garage : null;
  const out: string[] = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '2', '0', 'ENDSEC'];
  out.push('0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '5');
  for (const [name, color] of [['A-WALL', 7], ['A-WALL-PRTN', 8], ['A-ANNO-TEXT', 3], ['A-ANNO-DIMS', 4], ['A-GARAGE', 5]] as const) {
    out.push('0', 'LAYER', '2', name, '70', '0', '62', String(color), '6', 'CONTINUOUS');
  }
  out.push('0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
  // y is flipped so the street side (layout y = W) is at the bottom, like the sheet.
  const Y = (y: number) => W - y;
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) =>
    out.push('0', 'LINE', '8', layer, '10', x1.toFixed(3), '20', Y(y1).toFixed(3), '30', '0', '11', x2.toFixed(3), '21', Y(y2).toFixed(3), '31', '0');
  const rect = (layer: string, x: number, y: number, w: number, h: number) => {
    line(layer, x, y, x + w, y);
    line(layer, x + w, y, x + w, y + h);
    line(layer, x + w, y + h, x, y + h);
    line(layer, x, y + h, x, y);
  };
  const text = (layer: string, x: number, y: number, h: number, value: string) =>
    out.push('0', 'TEXT', '8', layer, '10', x.toFixed(3), '20', Y(y).toFixed(3), '30', '0', '40', h.toFixed(2), '1', value.replace(/\r?\n/g, ' '), '72', '1', '11', x.toFixed(3), '21', Y(y).toFixed(3), '31', '0');
  rect('A-WALL', 0, 0, L, W);
  rect('A-WALL', 0.5, 0.5, L - 1, W - 1);
  for (const [x0, z0, x1, z1] of partitionSegments(floor.rooms, L, W)) line('A-WALL-PRTN', x0, z0, x1, z1);
  for (const r of floor.rooms) text('A-ANNO-TEXT', r.x + r.w / 2, r.y + r.h / 2, 0.9, `${r.name} ${feetInches(r.w)} x ${feetInches(r.h)}`);
  if (g) {
    rect('A-GARAGE', g.x, g.y, g.w, g.h);
    text('A-ANNO-TEXT', g.x + g.w / 2, g.y + g.h / 2, 0.9, g.name);
  }
  const totalL = L + (g?.w ?? 0);
  line('A-ANNO-DIMS', 0, W + 6, totalL, W + 6);
  text('A-ANNO-DIMS', totalL / 2, W + 5, 1, feetInches(totalL));
  line('A-ANNO-DIMS', -6, 0, -6, W);
  text('A-ANNO-DIMS', -8, W / 2, 1, feetInches(W));
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n');
}
