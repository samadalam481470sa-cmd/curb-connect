import type { BuildSpec, PricedLine, Takeoff } from './takeoff';
import { PRICE_BOOK } from './prices';

function safeCsv(value: unknown): string {
  let text = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

/** Schematic room/footprint export. Actual egress, structural and MEP plans require design work. */
export function floorPlanSvg(takeoff: Takeoff, floorIndex: number): string {
  const floor = takeoff.layout.floors[floorIndex];
  if (!floor) throw new Error('Floor not found.');
  const W = takeoff.layout.footprint.lengthFt;
  const H = takeoff.layout.footprint.widthFt;
  const out = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -6 ' + (W + 12) + ' ' + (H + 12) + '">',
    '<rect x="-6" y="-6" width="' + (W + 12) + '" height="' + (H + 12) + '" fill="#101b2c"/>',
    '<rect x="0" y="0" width="' + W + '" height="' + H + '" stroke="#22d3ee" stroke-width=".5" fill="none"/>',
  ];
  for (const room of floor.rooms) {
    // Generated room names are escaped before they are placed into SVG.
    const label = room.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
    out.push('<rect x="' + room.x + '" y="' + room.y + '" width="' + room.w +
      '" height="' + room.h + '" fill="#243b54" stroke="#73d9ee" stroke-width=".15"/>');
    out.push('<text x="' + (room.x + room.w / 2) + '" y="' + (room.y + room.h / 2) +
      '" font-size="1.1" text-anchor="middle" fill="white">' + label + '</text>');
  }
  out.push('</svg>');
  return out.join('\n');
}

export function takeoffCsv(lines: readonly PricedLine[]): string {
  const rows: unknown[][] = [[
    'Group', 'Material', 'Quantity', 'Unit', 'Unit price USD',
    'Line total USD', 'Supplier/source', 'Pricing basis', 'Formula / assumptions',
  ]];
  for (const line of lines) {
    const mat = PRICE_BOOK[line.material];
    rows.push([
      line.group, mat.label, line.quantity, mat.unit, line.unitPrice ?? '',
      line.total ?? '', line.seller ?? '', line.basis ?? 'unpriced', line.formula,
    ]);
  }
  return rows.map((row) => row.map(safeCsv).join(',')).join('\r\n') + '\r\n';
}

export function designManifest(spec: BuildSpec, takeoff: Takeoff): string {
  return JSON.stringify({
    kind: 'field-pro-schematic-design',
    source: 'parametric house layout (not licensed AI-generated architectural plans)',
    units: 'ft',
    status: 'preliminary - not for construction',
    requiresReview: ['site survey', 'zoning and setbacks', 'structural engineer',
      'foundation and geotechnical design', 'MEP design', 'energy code',
      'fire and egress', 'local permits'],
    spec, layout: takeoff.layout, summary: takeoff.summary,
  }, null, 2);
}
