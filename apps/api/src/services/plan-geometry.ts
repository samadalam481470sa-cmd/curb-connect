// Drawing intelligence for vector plan PDFs (Home Builder part 02: vector geometry extraction,
// scale calibration, walls and rooms, openings, uncertainty). A plan exported from CAD keeps its
// walls as drawn lines, its door swings as arcs and its labels as positioned text. This file reads
// those without any AI service:
//
//   extractPlanGeometry(pdf)  pulls segments, arcs and positioned text out of each page (pdf.js)
//   analyzePlanGeometry(raw)  pure: scale, walls, footprint, rooms, doors, windows, confidence
//
// Safety matches plan-pdf.ts: pdf.js 6 (no eval path), no fonts, no network, a page cap, an
// operator cap per page and an overall timeout. Every number it reports carries a confidence and
// the UI shows them in a correction table, because a reading is a starting point, not a survey.

import type { PlanGeometryReading, PlanRoom } from '@fieldline/contracts';

const MAX_PAGES = 6;
const MAX_OPS_PER_PAGE = 200_000;
const MAX_SEGMENTS = 60_000;

export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface Arc {
  cx: number;
  cy: number;
  r: number;
}
export interface PlacedText {
  str: string;
  x: number;
  y: number;
}
export interface RawPage {
  segments: Seg[];
  arcs: Arc[];
  texts: PlacedText[];
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** pdf.js 6 path buffer codes (DrawOPS). */
const MOVE = 0;
const LINE = 1;
const CURVE = 2;
const QUAD = 3;
const CLOSE = 4;

/** Turns one pdf.js path buffer into segments and (for quarter-circle-like curves) arcs. */
export function readPathBuffer(buf: ArrayLike<number>, ctm: Matrix, out: RawPage): void {
  let i = 0;
  let sx = 0;
  let sy = 0;
  let cx = 0;
  let cy = 0;
  while (i < buf.length && out.segments.length < MAX_SEGMENTS) {
    const op = buf[i++];
    if (op === MOVE) {
      [cx, cy] = apply(ctm, buf[i]!, buf[i + 1]!);
      sx = cx;
      sy = cy;
      i += 2;
    } else if (op === LINE) {
      const [x, y] = apply(ctm, buf[i]!, buf[i + 1]!);
      out.segments.push({ x1: cx, y1: cy, x2: x, y2: y });
      cx = x;
      cy = y;
      i += 2;
    } else if (op === CURVE || op === QUAD) {
      const n = op === CURVE ? 6 : 4;
      const [x, y] = apply(ctm, buf[i + n - 2]!, buf[i + n - 1]!);
      const [px, py] = apply(ctm, buf[i]!, buf[i + 1]!);
      // A door swing is drawn as a quarter circle. Its center is the corner of the bounding square
      // whose sides meet the control point; the radius is the chord over sqrt(2).
      const chord = Math.hypot(x - cx, y - cy);
      if (chord > 0) {
        const r = chord / Math.SQRT2;
        const centers: [number, number][] = [
          [cx, y],
          [x, cy],
        ];
        // The center is the candidate farther from the control point.
        const [ax, ay] = centers.sort((a, b) => Math.hypot(b[0] - px, b[1] - py) - Math.hypot(a[0] - px, a[1] - py))[0]!;
        out.arcs.push({ cx: ax, cy: ay, r });
      }
      cx = x;
      cy = y;
      i += n;
    } else if (op === CLOSE) {
      if (cx !== sx || cy !== sy) out.segments.push({ x1: cx, y1: cy, x2: sx, y2: sy });
      cx = sx;
      cy = sy;
    } else {
      break; // Unknown code: stop reading this path rather than misreading it.
    }
  }
}

export async function extractPlanGeometry(data: Uint8Array, timeoutMs = 12_000): Promise<RawPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
    disableAutoFetch: true,
    disableStream: true,
    stopAtErrors: false,
    verbosity: 0,
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('plan geometry read timed out')), timeoutMs);
  });
  const read = (async () => {
    const doc = await task.promise;
    const { OPS } = pdfjs;
    const pages: RawPage[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n += 1) {
      const page = await doc.getPage(n);
      const out: RawPage = { segments: [], arcs: [], texts: [] };
      const ops = await page.getOperatorList();
      const stack: Matrix[] = [];
      let ctm: Matrix = IDENTITY;
      const count = Math.min(ops.fnArray.length, MAX_OPS_PER_PAGE);
      for (let k = 0; k < count; k += 1) {
        const fn = ops.fnArray[k];
        const args = ops.argsArray[k] as unknown[];
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() ?? IDENTITY;
        else if (fn === OPS.transform) ctm = multiply(ctm, args as Matrix);
        else if (fn === OPS.constructPath) {
          const buf = (args[1] as unknown[] | undefined)?.[0];
          if (buf && typeof (buf as ArrayLike<number>).length === 'number') readPathBuffer(buf as ArrayLike<number>, ctm, out);
        }
      }
      const content = await page.getTextContent();
      for (const item of content.items) {
        const it = item as { str?: unknown; transform?: number[] };
        if (typeof it.str !== 'string' || !it.str.trim() || !it.transform) continue;
        out.texts.push({ str: it.str.trim().slice(0, 80), x: it.transform[4]!, y: it.transform[5]! });
        if (out.texts.length > 4000) break;
      }
      pages.push(out);
      page.cleanup();
    }
    return pages;
  })();
  try {
    return await Promise.race([read, timeout]);
  } finally {
    clearTimeout(timer);
    await task.destroy().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------
// Analysis (pure)

/** "24'-6"", "24' 6"", "24'", "12'-0 1/2"" -> feet. */
export function parseFeetInches(raw: string): number | null {
  const m = raw.replace(/[’′]/g, "'").replace(/[”″]/g, '"').match(/^\s*(\d{1,3})\s*'\s*-?\s*(?:(\d{1,2})(?:\s+(\d)\/(\d))?\s*"?)?\s*$/);
  if (!m) return null;
  const ft = Number(m[1]);
  const inch = m[2] ? Number(m[2]) : 0;
  const frac = m[3] && m[4] ? Number(m[3]) / Number(m[4]) : 0;
  if (inch >= 12) return null;
  return ft + (inch + frac) / 12;
}

/** "1/4" = 1'-0"" -> feet per point (1 inch of paper = 72 points). */
export function parseScaleNote(raw: string): { feetPerPoint: number; label: string } | null {
  const m = raw.replace(/[’′]/g, "'").replace(/[”″]/g, '"').match(/(\d+)\s*\/\s*(\d+)\s*"?\s*=\s*1\s*'\s*-?\s*0?\s*"?/);
  if (!m) return null;
  const paperIn = Number(m[1]) / Number(m[2]);
  if (!(paperIn > 0 && paperIn <= 1)) return null;
  return { feetPerPoint: 1 / (paperIn * 72), label: `${m[1]}/${m[2]}" = 1'-0"` };
}

const ROOM_KINDS: [RegExp, PlanRoom['kind']][] = [
  [/\b(master\s+)?(bed(room)?|br|suite)\b/i, 'bedroom'],
  [/\b(bath(room)?|powder|wc|half\s*bath|ensuite)\b/i, 'bathroom'],
  [/\bkitchen\b/i, 'kitchen'],
  [/\b(living|family|great\s*room|den)\b/i, 'living'],
  [/\b(dining|breakfast|nook)\b/i, 'dining'],
  [/\bgarage\b/i, 'garage'],
  [/\b(laundry|utility|mud\s*room)\b/i, 'laundry'],
  [/\b(closet|wic|w\.i\.c\.|pantry|storage)\b/i, 'closet'],
  [/\b(office|study)\b/i, 'office'],
  [/\b(foyer|entry|hall|porch|patio|mech)\b/i, 'other'],
];

function roomKind(label: string): PlanRoom['kind'] | null {
  for (const [re, kind] of ROOM_KINDS) if (re.test(label)) return kind;
  return null;
}

/** "12'-0" x 14'-6"" or "12x14" -> [w, l] feet. */
export function parseRoomSize(raw: string): [number, number] | null {
  const parts = raw.replace(/[\u2018\u2019\u2032]/g, "'").replace(/[\u201c\u201d\u2033]/g, '"').split(/\s*[x×X]\s*/);
  if (parts.length !== 2) return null;
  const read = (s: string) => parseFeetInches(s.includes("'") ? s : `${s}'`);
  const a = read(parts[0]!);
  const b = read(parts[1]!);
  return a && b && a < 100 && b < 100 ? [a, b] : null;
}

const AXIS_TOL = 0.02; // ~1 degree

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

interface Axial {
  /** Coordinate across the line (y for horizontal, x for vertical). */
  at: number;
  lo: number;
  hi: number;
}

function axial(segments: Seg[]): { h: Axial[]; v: Axial[] } {
  const h: Axial[] = [];
  const v: Axial[] = [];
  for (const s of segments) {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const len = Math.hypot(dx, dy);
    if (len < 2) continue;
    if (Math.abs(dy) / len < AXIS_TOL) h.push({ at: (s.y1 + s.y2) / 2, lo: Math.min(s.x1, s.x2), hi: Math.max(s.x1, s.x2) });
    else if (Math.abs(dx) / len < AXIS_TOL) v.push({ at: (s.x1 + s.x2) / 2, lo: Math.min(s.y1, s.y2), hi: Math.max(s.y1, s.y2) });
  }
  return { h: mergeCollinear(h), v: mergeCollinear(v) };
}

/** Joins pieces of the same line (same offset, touching or overlapping) into one. */
function mergeCollinear(lines: Axial[]): Axial[] {
  const sorted = [...lines].sort((a, b) => a.at - b.at || a.lo - b.lo);
  const out: Axial[] = [];
  for (const l of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.at - l.at) < 0.3 && l.lo <= last.hi + 0.5) last.hi = Math.max(last.hi, l.hi);
    else out.push({ ...l });
  }
  return out;
}

interface Wall {
  horizontal: boolean;
  at: number;
  lo: number;
  hi: number;
  gap: number;
}

/** Pairs parallel lines a wall's thickness apart (3.5 to 14 inches at scale) into walls. */
function pairWalls(lines: Axial[], horizontal: boolean, minGap: number, maxGap: number): Wall[] {
  const walls: Wall[] = [];
  const used = new Set<number>();
  for (let i = 0; i < lines.length; i += 1) {
    if (used.has(i)) continue;
    const a = lines[i]!;
    let best = -1;
    let bestGap = Infinity;
    for (let j = i + 1; j < lines.length; j += 1) {
      const b = lines[j]!;
      const gap = b.at - a.at;
      if (gap > maxGap) break;
      if (gap < minGap || used.has(j)) continue;
      const overlap = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
      const shorter = Math.min(a.hi - a.lo, b.hi - b.lo);
      if (overlap > 0.6 * shorter && gap < bestGap) {
        best = j;
        bestGap = gap;
      }
    }
    if (best >= 0) {
      const b = lines[best]!;
      used.add(i);
      used.add(best);
      walls.push({ horizontal, at: (a.at + b.at) / 2, lo: Math.max(a.lo, b.lo), hi: Math.min(a.hi, b.hi), gap: bestGap });
    }
  }
  return walls;
}

const round = (n: number, step = 0.5) => Math.round(n / step) * step;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Reads one plan page (the one with the most wall-like lines is chosen by the caller). */
export function analyzePlanGeometry(
  pages: RawPage[],
  known?: { feetPerPoint: number; label: string },
): PlanGeometryReading {
  const notes: string[] = [];
  const empty: PlanGeometryReading = {
    pages: pages.length,
    scale: { feetPerPoint: null, source: 'none', label: null, confidence: 0 },
    footprint: null,
    walls: { count: 0, totalLf: 0, exteriorLf: 0, thicknessIn: null, confidence: 0 },
    rooms: [],
    doors: 0,
    windows: 0,
    stories: null,
    confidence: 0,
    notes,
  };
  if (!pages.length) {
    notes.push('The file has no pages that could be read.');
    return empty;
  }
  // Floor plans are the pages with the most straight axis lines.
  const ranked = pages.map((p, i) => ({ p, i, n: axial(p.segments).h.length + axial(p.segments).v.length })).sort((a, b) => b.n - a.n);
  const page = ranked[0]!.p;
  const allText = pages.flatMap((p) => p.texts.map((t) => t.str)).join(' ');

  const floorTitles = new Set((allText.match(/\b(first|second|third|1st|2nd|3rd|main|upper|lower)\s+floor\b/gi) ?? []).map((s) => s.toLowerCase().split(/\s+/)[0]));
  const stories = floorTitles.size >= 2 ? Math.min(3, floorTitles.size) : allText.match(/\b(two|2)[-\s]?stor(y|ies)\b/i) ? 2 : floorTitles.size === 1 ? 1 : null;

  // 1. Scale: a written scale note wins; otherwise measure dimension strings against nearby lines.
  const { h, v } = axial(page.segments);
  let feetPerPoint: number | null = null;
  let scaleSource: PlanGeometryReading['scale']['source'] = 'none';
  let scaleLabel: string | null = null;
  let scaleConf = 0;
  if (known) {
    feetPerPoint = known.feetPerPoint;
    scaleLabel = known.label;
    scaleSource = 'scale_note';
    scaleConf = 0.95;
  }
  for (const t of known ? [] : pages.flatMap((p) => p.texts)) {
    const note = parseScaleNote(t.str);
    if (note) {
      feetPerPoint = note.feetPerPoint;
      scaleLabel = note.label;
      scaleSource = 'scale_note';
      scaleConf = 0.8;
      break;
    }
  }
  const dimRatios: number[] = [];
  for (const t of page.texts) {
    const ft = parseFeetInches(t.str);
    if (!ft || ft < 2) continue;
    // The dimension line is the nearest axis line within a short distance whose midpoint is near the text.
    let bestD = Infinity;
    let bestLen = 0;
    for (const l of h) {
      const mid = (l.lo + l.hi) / 2;
      const d = Math.abs(l.at - t.y) + Math.abs(mid - t.x) * 0.5;
      if (d < bestD && Math.abs(l.at - t.y) < 14 && t.x > l.lo - 4 && t.x < l.hi + 4) {
        bestD = d;
        bestLen = l.hi - l.lo;
      }
    }
    for (const l of v) {
      const mid = (l.lo + l.hi) / 2;
      const d = Math.abs(l.at - t.x) + Math.abs(mid - t.y) * 0.5;
      if (d < bestD && Math.abs(l.at - t.x) < 14 && t.y > l.lo - 4 && t.y < l.hi + 4) {
        bestD = d;
        bestLen = l.hi - l.lo;
      }
    }
    if (bestLen > 8) dimRatios.push(ft / bestLen);
  }
  const dimScale = median(dimRatios);
  if (dimScale) {
    const agree = dimRatios.filter((r) => Math.abs(r - dimScale) / dimScale < 0.05).length / dimRatios.length;
    if (known) {
      // Drawing units are exact; dimension text only confirms.
    } else if (feetPerPoint) {
      if (Math.abs(dimScale - feetPerPoint) / feetPerPoint < 0.05) scaleConf = 0.95;
      else {
        notes.push(`The written scale (${scaleLabel}) does not match the dimension strings; the dimensions were trusted. The sheet may have been printed at a different size.`);
        feetPerPoint = dimScale;
        scaleSource = 'dimensions';
        scaleConf = clamp01(0.4 + 0.5 * agree);
      }
    } else {
      feetPerPoint = dimScale;
      scaleSource = 'dimensions';
      scaleConf = clamp01((dimRatios.length >= 3 ? 0.45 : 0.25) + 0.45 * agree);
    }
  }
  if (!feetPerPoint) {
    notes.push('No scale note or measurable dimension strings were found, so sizes could not be measured. Enter the overall length and width.');
  }

  // 2. Walls: parallel line pairs 3.5" to 14" apart at the found scale.
  let walls: Wall[] = [];
  if (feetPerPoint) {
    const minGap = 3.25 / 12 / feetPerPoint;
    const maxGap = 14.5 / 12 / feetPerPoint;
    walls = [...pairWalls(h, true, minGap, maxGap), ...pairWalls(v, false, minGap, maxGap)].filter((w) => (w.hi - w.lo) * feetPerPoint! >= 1.5);
  }
  const fpp = feetPerPoint ?? 0;
  const totalLf = walls.reduce((s, w) => s + (w.hi - w.lo) * fpp, 0);

  // 3. Footprint: the extent of the walls. Exterior walls sit on that boundary.
  let footprint: PlanGeometryReading['footprint'] = null;
  let exteriorLf = 0;
  if (walls.length >= 4 && feetPerPoint) {
    const xs = walls.flatMap((w) => (w.horizontal ? [w.lo, w.hi] : [w.at]));
    const ys = walls.flatMap((w) => (w.horizontal ? [w.at] : [w.lo, w.hi]));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    // Walls are tracked on their centerlines; the outline is measured to the outside faces.
    const wallFt = median(walls.map((w) => w.gap))! * fpp;
    const a = (maxX - minX) * fpp + wallFt;
    const b = (maxY - minY) * fpp + wallFt;
    const edge = 1.5 / fpp; // within 1.5 ft of the outline
    for (const w of walls) {
      const onEdge = w.horizontal ? Math.abs(w.at - minY) < edge || Math.abs(w.at - maxY) < edge : Math.abs(w.at - minX) < edge || Math.abs(w.at - maxX) < edge;
      if (onEdge) exteriorLf += (w.hi - w.lo) * fpp;
    }
    const perimeter = 2 * (a + b);
    // A closed outline has exterior walls close to the bounding perimeter (less door and window gaps).
    const closure = perimeter > 0 ? clamp01(exteriorLf / perimeter) : 0;
    footprint = {
      lengthFt: round(Math.max(a, b)),
      widthFt: round(Math.min(a, b)),
      confidence: clamp01(scaleConf * (0.4 + 0.6 * Math.min(1, closure / 0.7))),
    };
    if (closure < 0.5) notes.push('The outside walls do not close into a clear outline; check the length and width.');
  } else if (feetPerPoint) {
    notes.push('Too few wall lines were found to measure an outline. The plan may use single lines or filled shapes for walls.');
  }
  const thicknessIn = walls.length && feetPerPoint ? round((median(walls.map((w) => w.gap))! * fpp) * 12, 0.5) : null;
  const wallConf = walls.length >= 6 ? clamp01(scaleConf * 0.9) : walls.length ? clamp01(scaleConf * 0.5) : 0;

  // 4. Rooms: labels, with a size string just below or on the same line.
  const rooms: PlanRoom[] = [];
  const texts = page.texts;
  for (const t of texts) {
    const kind = roomKind(t.str);
    if (!kind || t.str.length > 40 || /\bscale\b/i.test(t.str)) continue;
    let size: [number, number] | null = parseRoomSize(t.str.replace(/^[^\d]*/, ''));
    if (!size) {
      const near = texts
        .filter((o) => o !== t && Math.abs(o.x - t.x) < 60 && t.y - o.y > -2 && t.y - o.y < 24)
        .sort((a, b) => Math.abs(t.y - a.y) - Math.abs(t.y - b.y));
      for (const o of near) {
        size = parseRoomSize(o.str);
        if (size) break;
      }
    }
    rooms.push({ name: t.str.replace(/\s+/g, ' ').slice(0, 60), kind, widthFt: size ? round(size[0]) : null, lengthFt: size ? round(size[1]) : null });
    if (rooms.length >= 80) break;
  }

  // 5. Openings: door swings are arcs about 2 to 3.5 ft in radius; windows by tags or schedule.
  const doors = feetPerPoint ? page.arcs.filter((a) => a.r * fpp >= 1.8 && a.r * fpp <= 3.6).length : 0;
  const windowTags = new Set(page.texts.map((t) => t.str).filter((s) => /^W-?\d{1,3}[A-Z]?$/.test(s)));
  const windows = windowTags.size;

  const bedrooms = rooms.filter((r) => r.kind === 'bedroom').length;
  const baths = rooms.filter((r) => r.kind === 'bathroom').length;
  if (rooms.length) notes.push(`Found ${rooms.length} labeled rooms (${bedrooms} bedrooms, ${baths} bathrooms).`);
  else notes.push('No room labels were found on the plan.');
  if (footprint) notes.push(`Measured the outline at ${footprint.lengthFt} ft by ${footprint.widthFt} ft from the wall lines.`);
  if (walls.length) notes.push(`Found ${walls.length} wall runs, ${Math.round(totalLf)} LF in total, about ${thicknessIn}" thick.`);
  if (doors) notes.push(`Counted ${doors} door swings.`);

  const confidence = clamp01(0.45 * (footprint?.confidence ?? 0) + 0.25 * scaleConf + 0.15 * wallConf + 0.15 * (rooms.length ? 0.8 : 0));
  return {
    pages: pages.length,
    scale: { feetPerPoint, source: scaleSource, label: scaleLabel, confidence: scaleConf },
    footprint,
    walls: { count: walls.length, totalLf: Math.round(totalLf), exteriorLf: Math.round(exteriorLf), thicknessIn, confidence: wallConf },
    rooms,
    doors,
    windows,
    stories,
    confidence,
    notes: notes.slice(0, 12),
  };
}

// ---------------------------------------------------------------------------------------------
// AutoCAD DXF (ASCII). AutoCAD saves DXF with "Save As"; DWG is a closed format and is not read.
// Entities read: LINE, LWPOLYLINE, POLYLINE/VERTEX, ARC, TEXT, MTEXT, and INSERT (blocks such as
// doors, expanded with their position, scale and rotation). Coordinates are converted so that one
// foot is 18 units, the same as a 1/4" = 1'-0" sheet, and the drawing units set the scale exactly.

const DXF_UNITS_FT: Record<number, [number, string]> = {
  0: [1 / 12, 'unitless (read as inches)'],
  1: [1 / 12, 'inches'],
  2: [1, 'feet'],
  4: [1 / 304.8, 'millimeters'],
  5: [1 / 30.48, 'centimeters'],
  6: [3.28084, 'meters'],
};
const DXF_FT_UNITS = 18;
const MAX_DXF_ENTITIES = 80_000;
const MAX_BLOCK_DEPTH = 4;

interface DxfEntity {
  type: string;
  codes: [number, string][];
}

function dxfPairs(text: string): [number, string][] {
  const lines = text.split(/\r?\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    if (!Number.isInteger(code)) break;
    pairs.push([code, lines[i + 1]!.trim()]);
  }
  return pairs;
}

function groupEntities(pairs: [number, string][], from: number, to: number): DxfEntity[] {
  const out: DxfEntity[] = [];
  let cur: DxfEntity | null = null;
  for (let i = from; i < to && out.length < MAX_DXF_ENTITIES; i += 1) {
    const [code, value] = pairs[i]!;
    if (code === 0) {
      if (cur) out.push(cur);
      cur = { type: value, codes: [] };
    } else cur?.codes.push([code, value]);
  }
  if (cur) out.push(cur);
  return out;
}

const num = (e: DxfEntity, code: number, fallback = 0) => {
  const hit = e.codes.find(([c]) => c === code);
  const n = hit ? Number(hit[1]) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const str = (e: DxfEntity, code: number) => e.codes.filter(([c]) => c === code).map(([, v]) => v).join('');

/** Strips MTEXT formatting codes (\P line breaks, \f fonts, braces) to plain text. */
function mtextPlain(raw: string): string {
  return raw.replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;\\]*;/g, '').replace(/\\[~ ]/g, ' ').replace(/[{}]/g, '').replace(/%%c/gi, 'Ø').replace(/%%d/gi, '°').trim();
}

export interface DxfPlan {
  pages: RawPage[];
  feetPerUnit: number;
  unitsLabel: string;
}

export function parseDxfPlan(text: string): DxfPlan {
  const pairs = dxfPairs(text.slice(0, 20_000_000));
  let insunits = 0;
  for (let i = 0; i < pairs.length - 1 && i < 20_000; i += 1) {
    if (pairs[i]![0] === 9 && pairs[i]![1] === '$INSUNITS') {
      insunits = Number(pairs[i + 1]![1]) || 0;
      break;
    }
  }
  const [feetPerUnit, unitsLabel] = DXF_UNITS_FT[insunits] ?? DXF_UNITS_FT[0]!;
  const k = feetPerUnit * DXF_FT_UNITS;

  // Sections: find BLOCKS and ENTITIES ranges.
  const sections = new Map<string, [number, number]>();
  for (let i = 0; i < pairs.length; i += 1) {
    if (pairs[i]![0] === 0 && pairs[i]![1] === 'SECTION' && pairs[i + 1]?.[0] === 2) {
      const name = pairs[i + 1]![1];
      let j = i + 2;
      while (j < pairs.length && !(pairs[j]![0] === 0 && pairs[j]![1] === 'ENDSEC')) j += 1;
      sections.set(name, [i + 2, j]);
      i = j;
    }
  }
  const blocks = new Map<string, DxfEntity[]>();
  const blockRange = sections.get('BLOCKS');
  if (blockRange) {
    let name: string | null = null;
    let body: DxfEntity[] = [];
    for (const e of groupEntities(pairs, blockRange[0], blockRange[1])) {
      if (e.type === 'BLOCK') {
        name = str(e, 2);
        body = [];
      } else if (e.type === 'ENDBLK') {
        if (name) blocks.set(name, body);
        name = null;
      } else if (name) body.push(e);
    }
  }

  const page: RawPage = { segments: [], arcs: [], texts: [] };
  const emit = (entities: DxfEntity[], m: Matrix, depth: number) => {
    const P = (x: number, y: number) => apply(m, x, y);
    const scaleOf = Math.hypot(m[0], m[1]);
    for (let idx = 0; idx < entities.length; idx += 1) {
      const e = entities[idx]!;
      if (page.segments.length > MAX_SEGMENTS) return;
      if (e.type === 'LINE') {
        const [x1, y1] = P(num(e, 10), num(e, 20));
        const [x2, y2] = P(num(e, 11), num(e, 21));
        page.segments.push({ x1, y1, x2, y2 });
      } else if (e.type === 'LWPOLYLINE') {
        const xs = e.codes.filter(([c]) => c === 10).map(([, v]) => Number(v));
        const ys = e.codes.filter(([c]) => c === 20).map(([, v]) => Number(v));
        const pts = xs.map((x, i) => P(x, ys[i] ?? 0));
        const closed = (num(e, 70) & 1) === 1;
        for (let i = 0; i + 1 < pts.length; i += 1) page.segments.push({ x1: pts[i]![0], y1: pts[i]![1], x2: pts[i + 1]![0], y2: pts[i + 1]![1] });
        if (closed && pts.length > 2) page.segments.push({ x1: pts.at(-1)![0], y1: pts.at(-1)![1], x2: pts[0]![0], y2: pts[0]![1] });
      } else if (e.type === 'POLYLINE') {
        const closed = (num(e, 70) & 1) === 1;
        const pts: [number, number][] = [];
        let j = idx + 1;
        while (j < entities.length && entities[j]!.type === 'VERTEX') {
          pts.push(P(num(entities[j]!, 10), num(entities[j]!, 20)));
          j += 1;
        }
        for (let i = 0; i + 1 < pts.length; i += 1) page.segments.push({ x1: pts[i]![0], y1: pts[i]![1], x2: pts[i + 1]![0], y2: pts[i + 1]![1] });
        if (closed && pts.length > 2) page.segments.push({ x1: pts.at(-1)![0], y1: pts.at(-1)![1], x2: pts[0]![0], y2: pts[0]![1] });
        idx = j;
      } else if (e.type === 'ARC') {
        const [cx, cy] = P(num(e, 10), num(e, 20));
        page.arcs.push({ cx, cy, r: num(e, 40) * scaleOf });
      } else if (e.type === 'TEXT' || e.type === 'MTEXT') {
        const raw = e.type === 'MTEXT' ? mtextPlain(str(e, 3) + str(e, 1)) : str(e, 1).replace(/%%c/gi, 'Ø');
        const [x, y] = P(num(e, 10), num(e, 20));
        if (raw && page.texts.length < 4000) page.texts.push({ str: raw.slice(0, 80), x, y });
      } else if (e.type === 'INSERT' && depth < MAX_BLOCK_DEPTH) {
        const body = blocks.get(str(e, 2));
        if (!body) continue;
        const sx = num(e, 41, 1);
        const sy = num(e, 42, sx);
        const rot = (num(e, 50) * Math.PI) / 180;
        const c = Math.cos(rot);
        const s = Math.sin(rot);
        const local: Matrix = [c * sx, s * sx, -s * sy, c * sy, num(e, 10), num(e, 20)];
        emit(body, multiply(m, local), depth + 1);
      }
    }
  };
  const entityRange = sections.get('ENTITIES');
  if (entityRange) emit(groupEntities(pairs, entityRange[0], entityRange[1]), [k, 0, 0, k, 0, 0], 0);
  return { pages: [page], feetPerUnit, unitsLabel };
}

/** Reads a DXF plan: the drawing units give the scale exactly. */
export function analyzeDxfPlan(text: string): PlanGeometryReading {
  const dxf = parseDxfPlan(text);
  const reading = analyzePlanGeometry(dxf.pages, { feetPerPoint: 1 / DXF_FT_UNITS, label: `DXF units: ${dxf.unitsLabel}` });
  reading.notes = [`Read the AutoCAD DXF drawing (units: ${dxf.unitsLabel}).`, ...reading.notes].slice(0, 12);
  return reading;
}
