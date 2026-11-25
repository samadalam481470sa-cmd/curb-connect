// CLI: building footprints from a USGS 3DEP project's LAS class-6 points, for one box.
//   npx tsx scripts/usgs-class6-footprints.ts --project USGS_LPC_TX_MatagordaBay_B1_2018 \
//     --lon -96.2137 --lat 28.7247 --half 150 --out palacios.geojson
// Reads only public S3 objects (no keys). Writes GeoJSON in WGS84 with the USGS source noted.
import { writeFileSync } from 'node:fs';
import { reprojectPoint } from '@fieldline/geometry';
import {
  class6Footprints,
  footprintRingToLonLat,
  type ClassifiedPoint,
} from '../src/class6-footprints';

const args = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] ?? '']);
  return acc;
}, []));
const project = String(args.project ?? '');
const lon = Number(args.lon), lat = Number(args.lat), half = Number(args.half ?? 150);
const out = String(args.out ?? 'footprints.geojson');
if (!/^[A-Za-z0-9_.-]+$/.test(project)) throw new Error('--project must be a USGS project name.');
if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error('--lon and --lat are required.');
if (!(half > 0 && half <= 1000)) throw new Error('--half must be between 0 and 1000 metres.');

const BASE = `https://usgs-lidar-public.s3.us-west-2.amazonaws.com/${project}`;
// All CRS math goes through the shared @fieldline/geometry helper (proj4-backed), not
// hand-rolled spherical Mercator constants.

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return (await r.json()) as T;
}

/** The parts of the laz-perf WebAssembly module this script uses. */
interface LazPerfParams {
  _malloc(size: number): number;
  _free(pointer: number): void;
  HEAPU8: Uint8Array;
  LASZip: new () => {
    open(pointer: number, length: number): void;
    getPoint(destination: number): void;
    delete(): void;
  };
}

/** Decode one LAZ node and return its points (x, y, z, classification). */
async function decodeNode(lp: LazPerfParams, bytes: Uint8Array): Promise<ClassifiedPoint[]> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const recLen = dv.getUint16(105, true);
  const fmt = dv.getUint8(104) & 0x3f;
  const count = dv.getUint32(107, true);
  const scale = [131, 139].map((o) => dv.getFloat64(o, true));
  const offset = [155, 163].map((o) => dv.getFloat64(o, true));
  const ptr = lp._malloc(bytes.byteLength);
  lp.HEAPU8.set(bytes, ptr);
  const zip = new lp.LASZip();
  zip.open(ptr, bytes.byteLength);
  const dest = lp._malloc(recLen);
  const pts: ClassifiedPoint[] = [];
  for (let i = 0; i < count; i++) {
    zip.getPoint(dest);
    const b = new DataView(lp.HEAPU8.buffer, dest, recLen);
    const c = fmt >= 6 ? b.getUint8(16) : b.getUint8(15) & 0x1f;
    pts.push({ x: b.getInt32(0, true) * scale[0]! + offset[0]!, y: b.getInt32(4, true) * scale[1]! + offset[1]!, c });
  }
  zip.delete();
  lp._free(dest);
  lp._free(ptr);
  return pts;
}

async function main() {
  const meta = await getJson<{ bounds: number[] }>(`${BASE}/ept.json`);
  const [x0, y0, z0, x1, y1, z1] = meta.bounds;
  const side = Math.max(x1! - x0!, y1! - y0!, z1! - z0!);
  const center = reprojectPoint({ crs: 'EPSG:4326', lon, lat }, 'EPSG:3857');
  if (center.crs !== 'EPSG:3857') throw new Error('reprojection lost its CRS');
  const [cx, cy] = [center.x, center.y];
  const box = { minx: cx - half, maxx: cx + half, miny: cy - half, maxy: cy + half };
  const cellBox = (d: number, x: number, y: number) => {
    const s = side / 2 ** d;
    return { minx: x0! + x * s, maxx: x0! + (x + 1) * s, miny: y0! + y * s, maxy: y0! + (y + 1) * s };
  };
  const overlaps = (a: { minx: number; maxx: number; miny: number; maxy: number }) =>
    !(a.maxx < box.minx || a.minx > box.maxx || a.maxy < box.miny || a.miny > box.maxy);

  // Walk the octree hierarchy pages that touch the box and collect non-empty nodes.
  const pages = new Map<string, Record<string, number>>();
  const page = async (key: string) => {
    if (!pages.has(key)) {
      pages.set(key, await getJson<Record<string, number>>(`${BASE}/ept-hierarchy/${key}.json`));
    }
    return pages.get(key)!;
  };
  const nodes: string[] = [];
  const stack: { d: number; x: number; y: number; z: number; pageKey: string }[] = [{ d: 0, x: 0, y: 0, z: 0, pageKey: '0-0-0-0' }];
  const maxDepth = 12;
  while (stack.length) {
    const { d, x, y, z, pageKey } = stack.pop()!;
    if (!overlaps(cellBox(d, x, y))) continue;
    const count = (await page(pageKey))[`${d}-${x}-${y}-${z}`];
    if (!count) continue;
    if (count > 0) nodes.push(`${d}-${x}-${y}-${z}`);
    if (count === -1) { stack.push({ d, x, y, z, pageKey: `${d}-${x}-${y}-${z}` }); continue; }
    if (d < maxDepth) for (let i = 0; i < 8; i++) {
      stack.push({ d: d + 1, x: x * 2 + (i & 1), y: y * 2 + ((i >> 1) & 1), z: z * 2 + ((i >> 2) & 1), pageKey });
    }
  }

  type LazFactory = (() => Promise<LazPerfParams>) | { create(): Promise<LazPerfParams> };
  const laz = (await import('laz-perf')) as unknown as { default?: LazFactory };
  const factory = (laz.default ?? laz) as LazFactory;
  const lp = await (typeof factory === 'function' ? factory() : factory.create());
  const classified: ClassifiedPoint[] = [];
  let decoded = 0;
  for (const key of nodes) {
    const bytes = new Uint8Array(await (await fetch(`${BASE}/ept-data/${key}.laz`)).arrayBuffer());
    for (const p of await decodeNode(lp, bytes)) {
      decoded++;
      if (p.c === 6) classified.push(p);
    }
  }

  const { footprints, classifiedPoints } = class6Footprints(classified, box);
  const features = footprints.map((f) => ({
    type: 'Feature' as const,
    properties: { id: f.id, areaM2: f.areaM2, source: 'USGS 3DEP LAS class 6', project },
    geometry: { type: 'Polygon' as const, coordinates: [footprintRingToLonLat(f.ring).map((p) => [p.lon, p.lat])] },
  }));
  writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }, null, 1));
  console.log(JSON.stringify({ project, nodes: nodes.length, pointsDecoded: decoded, classifiedPoints, footprints: footprints.length, out }));
}

main().catch((e) => {
  console.error('failed:', (e as Error).message);
  process.exitCode = 1;
});
