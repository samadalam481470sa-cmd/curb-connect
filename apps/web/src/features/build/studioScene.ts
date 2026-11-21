// House Studio 3D construction model (three.js).
//
// Builds the house from the schematic layout as the trades would install it: site pad, footings,
// under-slab plumbing, rebar and vapor barrier, slab, wall studs and plates, trusses, sheathing,
// roofing, windows and doors, siding, MEP rough-in, insulation, drywall, finishes, driveway and
// landscaping. Every piece carries its build phase and cost system, so the timeline, the system
// eye toggles, the cutaway and the exploded view all work on the same model. Units are feet;
// x runs along the house length, z along its width, y is up. z = W is the street side.
import * as THREE from 'three';
import type { Room } from './layout';
import type { PhaseId, SystemId } from './studioCost';
import { SYSTEMS, driveArea, patioArea } from './studioCost';
import type { BuildSpec, Takeoff } from './takeoff';

type V3 = [number, number, number];

export interface StudioPart {
  object: THREE.Object3D;
  phase: PhaseId;
  system: SystemId;
  /** Cut away by the cutaway slider (shell, roof, ceilings). */
  clip: boolean;
  /** Vertical offset in the exploded view, feet. */
  explode: number;
}

export interface StudioLevel {
  label: string;
  y: number;
}

export interface StudioScene {
  root: THREE.Group;
  parts: StudioPart[];
  /** Site, blueprint lines and grid bubbles (always visible). */
  blueprint: THREE.Group;
  grid: THREE.GridHelper;
  center: THREE.Vector3;
  size: number;
  levels: StudioLevel[];
  clipPlane: THREE.Plane;
  /** Extent along x for the cutaway, in root coordinates. */
  xRange: [number, number];
  dispose: () => void;
}

const EXPLODE: Record<PhaseId, number> = {
  1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 5, 7: 12, 8: 17, 9: 5, 10: 7, 11: 9, 12: 6, 13: 7, 14: 2, 15: 0, 16: 0,
};
const CLIP_SYSTEMS = new Set<SystemId>([
  'framing', 'trusses', 'sheathing', 'roofing', 'openings', 'siding', 'insulation', 'drywall',
]);

const systemColor = (id: SystemId) => SYSTEMS.find((s) => s.id === id)!.color;

interface BoxSpec {
  m: THREE.Matrix4;
}

/** Collects boxes and cylinders per (phase, system, material) and emits instanced meshes. */
class Builder {
  readonly parts: StudioPart[] = [];
  readonly geometries: THREE.BufferGeometry[] = [];
  readonly materials: THREE.Material[] = [];
  private readonly boxes = new Map<string, { phase: PhaseId; system: SystemId; mat: THREE.Material; clip: boolean; items: BoxSpec[]; geo: 'box' | 'cyl' }>();
  private readonly matCache = new Map<string, THREE.Material>();
  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);

  constructor(readonly clipPlane: THREE.Plane) {
    this.geometries.push(this.unitBox, this.unitCyl);
  }

  mat(color: string, opts: { opacity?: number; rough?: number; metal?: number; clip?: boolean; side?: THREE.Side } = {}) {
    const key = `${color}|${opts.opacity ?? 1}|${opts.rough ?? 0.8}|${opts.metal ?? 0}|${opts.clip ? 1 : 0}|${opts.side ?? 0}`;
    let m = this.matCache.get(key);
    if (!m) {
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: opts.rough ?? 0.8,
        metalness: opts.metal ?? 0,
        transparent: (opts.opacity ?? 1) < 1,
        opacity: opts.opacity ?? 1,
        side: opts.side ?? THREE.FrontSide,
        depthWrite: (opts.opacity ?? 1) >= 0.6,
      });
      if (opts.clip) material.clippingPlanes = [this.clipPlane];
      m = material;
      this.matCache.set(key, m);
      this.materials.push(m);
    }
    return m;
  }

  private bucket(phase: PhaseId, system: SystemId, mat: THREE.Material, geo: 'box' | 'cyl') {
    const clip = CLIP_SYSTEMS.has(system);
    const key = `${phase}|${system}|${mat.uuid}|${geo}`;
    let b = this.boxes.get(key);
    if (!b) {
      b = { phase, system, mat, clip, items: [], geo };
      this.boxes.set(key, b);
    }
    return b;
  }

  /** Axis-aligned box from min corner and size. */
  box(phase: PhaseId, system: SystemId, mat: THREE.Material, min: V3, size: V3) {
    if (size.some((s) => s <= 0)) return;
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(min[0] + size[0] / 2, min[1] + size[1] / 2, min[2] + size[2] / 2),
      new THREE.Quaternion(),
      new THREE.Vector3(...size),
    );
    this.bucket(phase, system, mat, 'box').items.push({ m });
  }

  /** Box of cross-section w × h running from a to b. */
  beam(phase: PhaseId, system: SystemId, mat: THREE.Material, a: V3, b: V3, w: number, h = w) {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    const len = dir.length();
    if (len < 1e-3) return;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const m = new THREE.Matrix4().compose(va.add(vb).multiplyScalar(0.5), q, new THREE.Vector3(w, len, h));
    this.bucket(phase, system, mat, 'box').items.push({ m });
  }

  pipe(phase: PhaseId, system: SystemId, mat: THREE.Material, a: V3, b: V3, d: number) {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    const len = dir.length();
    if (len < 1e-3) return;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    const m = new THREE.Matrix4().compose(va.add(vb).multiplyScalar(0.5), q, new THREE.Vector3(d, len, d));
    this.bucket(phase, system, mat, 'cyl').items.push({ m });
  }

  /** A free-form mesh (roof planes, gables). */
  mesh(phase: PhaseId, system: SystemId, geometry: THREE.BufferGeometry, mat: THREE.Material) {
    this.geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.parts.push({ object: mesh, phase, system, clip: CLIP_SYSTEMS.has(system), explode: EXPLODE[phase] });
    return mesh;
  }

  finish(root: THREE.Group) {
    for (const b of this.boxes.values()) {
      const geo = b.geo === 'box' ? this.unitBox : this.unitCyl;
      const inst = new THREE.InstancedMesh(geo, b.mat, b.items.length);
      b.items.forEach((it, i) => inst.setMatrixAt(i, it.m));
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = true;
      inst.receiveShadow = true;
      inst.computeBoundingSphere();
      this.parts.push({ object: inst, phase: b.phase, system: b.system, clip: b.clip, explode: EXPLODE[b.phase] });
    }
    for (const p of this.parts) {
      const holder = new THREE.Group();
      holder.add(p.object);
      holder.userData = { phase: p.phase, system: p.system };
      p.object = holder;
      root.add(holder);
    }
  }
}

interface Opening {
  /** Distance along the wall from its start, feet. */
  at: number;
  width: number;
  sill: number;
  height: number;
  kind: 'window' | 'door' | 'garage';
}

interface Wall {
  a: [number, number];
  b: [number, number];
  /** Outward normal in plan (x, z). */
  n: [number, number];
  y0: number;
  h: number;
  openings: Opening[];
  exterior: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Partition segments: room edges that are not on the outer footprint, merged and deduped. */
export function partitionSegments(rooms: readonly Room[], L: number, W: number): [number, number, number, number][] {
  const horiz = new Map<number, [number, number][]>();
  const vert = new Map<number, [number, number][]>();
  const add = (map: Map<number, [number, number][]>, k: number, a: number, b: number) => {
    const key = r2(k);
    const list = map.get(key) ?? [];
    list.push([Math.min(a, b), Math.max(a, b)]);
    map.set(key, list);
  };
  for (const r of rooms) {
    for (const z of [r.y, r.y + r.h]) if (z > 0.01 && z < W - 0.01) add(horiz, z, r.x, r.x + r.w);
    for (const x of [r.x, r.x + r.w]) if (x > 0.01 && x < L - 0.01) add(vert, x, r.y, r.y + r.h);
  }
  const merge = (list: [number, number][]) => {
    const sorted = [...list].sort((p, q) => p[0] - q[0]);
    const out: [number, number][] = [];
    for (const s of sorted) {
      const last = out.at(-1);
      if (last && s[0] <= last[1] + 0.01) last[1] = Math.max(last[1], s[1]);
      else out.push([s[0], s[1]]);
    }
    return out;
  };
  const segs: [number, number, number, number][] = [];
  for (const [z, list] of horiz) for (const [a, b] of merge(list)) segs.push([a, z, b, z]);
  for (const [x, list] of vert) for (const [a, b] of merge(list)) segs.push([x, a, x, b]);
  return segs;
}

export function buildStudioScene(spec: BuildSpec, takeoff: Takeoff): StudioScene {
  const { layout, summary } = takeoff;
  const L = layout.footprint.lengthFt;
  const W = layout.footprint.widthFt;
  const H = spec.wallHeightFt;
  const stories = layout.floors.length;
  const top = H * stories + (stories - 1);
  const o = Math.max(0, Math.min(3, spec.overhangFt));
  const rise = (W / 2) * (spec.roofPitch / 12);
  const ridge = top + rise;
  const g = layout.garage;
  const gh = Math.min(H, 9);

  // Keeps x >= cut: the cutaway removes the end nearest the default camera.
  const clipPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 1e6);
  const b = new Builder(clipPlane);
  const root = new THREE.Group();

  const M = {
    earth: b.mat('#3b3a35', { rough: 1 }),
    pad: b.mat('#7d7464', { rough: 1 }),
    stake: b.mat('#f08a24'),
    concrete: b.mat('#cfcac0', { rough: 0.95 }),
    beam: b.mat('#b9b2a6', { rough: 0.95 }),
    vapor: b.mat('#1d2630', { opacity: 0.75, side: THREE.DoubleSide }),
    rebar: b.mat('#b5532e', { metal: 0.4, rough: 0.6 }),
    dwv: b.mat('#2f9e6d'),
    water: b.mat('#3f8fd8'),
    hot: b.mat('#d8513f'),
    stud: b.mat('#d6a86b', { clip: true }),
    plate: b.mat('#c4955a', { clip: true }),
    steel: b.mat('#b0332b', { metal: 0.6, rough: 0.4, clip: true }),
    truss: b.mat('#c98d4c', { clip: true }),
    osb: b.mat('#c9a56a', { clip: true, opacity: 0.95 }),
    shingle: b.mat('#4a4f57', { rough: 0.95, clip: true, side: THREE.DoubleSide }),
    ridge: b.mat('#33373e', { clip: true }),
    glass: b.mat('#86c5f0', { opacity: 0.45, rough: 0.1, metal: 0.1, clip: true }),
    frame: b.mat('#f4f4f2', { clip: true }),
    door: b.mat('#5b3a26', { clip: true }),
    garageDoor: b.mat('#ecebe7', { clip: true }),
    siding: b.mat('#e9e5dc', { clip: true }),
    trim: b.mat('#2d3138', { clip: true }),
    duct: b.mat('#a9b4c2', { metal: 0.6, rough: 0.35, clip: true }),
    conduit: b.mat('#e2b93b', { clip: true }),
    panel: b.mat('#6b7280', { clip: true }),
    batt: b.mat('#f0a3b5', { clip: true, opacity: 0.92 }),
    drywall: b.mat('#f4f4f1', { clip: true }),
    ceiling: b.mat('#fafaf7', { clip: true, opacity: 0.96, side: THREE.DoubleSide }),
    wood: b.mat('#b08458'),
    tile: b.mat('#cfd6dc'),
    carpet: b.mat('#8d8a86'),
    cabinet: b.mat('#8a6a4f'),
    counter: b.mat('#e6e2da', { rough: 0.3 }),
    fixture: b.mat('#ffffff', { rough: 0.2 }),
    drive: b.mat('#bdb8ae', { rough: 0.95 }),
    grass: b.mat('#4f8f4b', { rough: 1 }),
    trunk: b.mat('#6b4a2f'),
    canopy: b.mat('#5aa05a', { rough: 0.9 }),
    shrub: b.mat('#4c8a46', { rough: 0.9 }),
  };

  // ---------- 1 Site prep: pad, stakes and string lines.
  const lotX0 = -16;
  const lotX1 = L + (g?.w ?? 0) + 16;
  const lotZ0 = -14;
  const lotZ1 = W + 30;
  b.box(1, 'sitework', M.pad, [-4, -0.35, -4], [L + (g?.w ?? 0) + 8, 0.3, W + 8]);
  for (const [x, z] of [[-2, -2], [L + (g?.w ?? 0) + 2, -2], [-2, W + 2], [L + (g?.w ?? 0) + 2, W + 2]] as const) {
    b.box(1, 'permits', M.stake, [x - 0.15, -0.05, z - 0.15], [0.3, 2.2, 0.3]);
  }

  // ---------- 2 Footings: perimeter grade beam under house and garage.
  const beamW = 1;
  const beamD = 20 / 12;
  const ringBeam = (x0: number, z0: number, x1: number, z1: number, skipSide?: 'x0') => {
    b.box(2, 'footings', M.beam, [x0, -beamD, z0], [x1 - x0, beamD, beamW]);
    b.box(2, 'footings', M.beam, [x0, -beamD, z1 - beamW], [x1 - x0, beamD, beamW]);
    if (skipSide !== 'x0') b.box(2, 'footings', M.beam, [x0, -beamD, z0], [beamW, beamD, z1 - z0]);
    b.box(2, 'footings', M.beam, [x1 - beamW, -beamD, z0], [beamW, beamD, z1 - z0]);
  };
  ringBeam(0, 0, L, W);
  if (g) ringBeam(g.x, g.y, g.x + g.w, g.y + g.h, 'x0');

  // ---------- 3 Underground: drain/waste to the street side, water line in.
  const ground = layout.floors[0]!;
  const wet = ground.rooms.filter((r) => r.kind === 'bath' || r.kind === 'kitchen' || r.kind === 'laundry');
  const mainX = L * 0.5;
  b.pipe(3, 'underground', M.dwv, [mainX, -0.9, W * 0.35], [mainX, -0.9, W + 6], 0.33);
  for (const r of wet) {
    const cx = r.x + r.w / 2;
    const cz = r.y + r.h / 2;
    b.pipe(3, 'underground', M.dwv, [cx, -0.7, cz], [mainX, -0.9, cz], 0.25);
    b.pipe(3, 'underground', M.dwv, [cx, -0.7, cz], [cx, 0.2, cz], 0.25);
  }
  b.pipe(3, 'underground', M.water, [L * 0.2, -0.6, W + 6], [L * 0.2, -0.6, W * 0.5], 0.12);
  b.pipe(3, 'underground', M.water, [L * 0.2, -0.6, W * 0.5], [mainX, -0.6, W * 0.5], 0.12);

  // ---------- 4 Rebar + vapor barrier, 5 slab.
  const slabs: [number, number, number, number][] = [[0, 0, L, W]];
  if (g) slabs.push([g.x, g.y, g.x + g.w, g.y + g.h]);
  const slabT = 4 / 12;
  for (const [x0, z0, x1, z1] of slabs) {
    b.box(4, 'slab', M.vapor, [x0, -0.04, z0], [x1 - x0, 0.03, z1 - z0]);
    for (let x = x0 + 0.75; x < x1; x += 1.5) b.beam(4, 'slab', M.rebar, [x, 0.12, z0 + 0.3], [x, 0.12, z1 - 0.3], 0.06);
    for (let z = z0 + 0.75; z < z1; z += 1.5) b.beam(4, 'slab', M.rebar, [x0 + 0.3, 0.15, z], [x1 - 0.3, 0.15, z], 0.06);
    b.box(5, 'slab', M.concrete, [x0, 0, z0], [x1 - x0, slabT, z1 - z0]);
  }
  const ff = slabT;

  // ---------- Walls with openings (shared by framing, sheathing, siding, insulation, drywall).
  const walls: Wall[] = [];
  const windowTotal = Math.max(4, summary.windows);
  const perimeterPerFloor = 2 * (L + W);
  for (let f = 0; f < stories; f += 1) {
    const y0 = ff + f * (H + 1);
    const segs: Array<{ a: [number, number]; b: [number, number]; n: [number, number] }> = [
      { a: [0, W], b: [L, W], n: [0, 1] }, // street side
      { a: [L, 0], b: [0, 0], n: [0, -1] },
      { a: [0, 0], b: [0, W], n: [-1, 0] },
      { a: [L, W], b: [L, 0], n: [1, 0] },
    ];
    for (const s of segs) {
      const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
      const openings: Opening[] = [];
      const isFront = s.n[1] === 1;
      const isBack = s.n[1] === -1;
      const garageBlocksEnd = g && s.n[0] === 1 && f === 0;
      if (f === 0 && isFront) openings.push({ at: len * 0.42, width: 3, sill: 0, height: 6.8, kind: 'door' });
      if (f === 0 && isBack) openings.push({ at: len * 0.55, width: 6, sill: 0, height: 6.8, kind: 'door' });
      if (!garageBlocksEnd) {
        const n = Math.max(1, Math.round((windowTotal / stories) * (len / perimeterPerFloor)));
        for (let i = 0; i < n; i += 1) {
          const at = ((i + 0.5) / n) * len - 1.5;
          if (openings.some((op) => Math.abs(op.at + op.width / 2 - (at + 1.5)) < op.width / 2 + 3)) continue;
          openings.push({ at, width: 3, sill: 3, height: 4, kind: 'window' });
        }
      }
      walls.push({ a: s.a, b: s.b, n: s.n, y0, h: H, openings: openings.sort((p, q) => p.at - q.at), exterior: true });
    }
    for (const [x0, z0, x1, z1] of partitionSegments(layout.floors[f]!.rooms, L, W)) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const openings: Opening[] = len > 5 ? [{ at: Math.min(1.5, len - 3), width: 2.67, sill: 0, height: 6.8, kind: 'door' }] : [];
      walls.push({ a: [x0, z0], b: [x1, z1], n: [z1 - z0 ? 1 : 0, x1 - x0 ? 1 : 0], y0, h: H, openings, exterior: false });
    }
    // Floor system for the upper floor.
    if (f > 0) {
      for (let x = 0.75; x < L; x += 1.33) b.box(6, 'framing', M.plate, [x - 0.06, y0 - 1, 0], [0.12, 0.95, W]);
      b.box(6, 'framing', M.osb, [0, y0 - 0.06, 0], [L, 0.06, W]);
    }
  }
  if (g) {
    const y0 = ff;
    const gx0 = g.x;
    const gx1 = g.x + g.w;
    const gz0 = g.y;
    const gz1 = g.y + g.h;
    const doorW = g.w > 15 ? 16 : 9;
    walls.push(
      { a: [gx0, gz1], b: [gx1, gz1], n: [0, 1], y0, h: gh, openings: [{ at: (g.w - doorW) / 2, width: doorW, sill: 0, height: 7, kind: 'garage' }], exterior: true },
      { a: [gx1, gz0], b: [gx0, gz0], n: [0, -1], y0, h: gh, openings: [], exterior: true },
      { a: [gx1, gz1], b: [gx1, gz0], n: [1, 0], y0, h: gh, openings: [{ at: g.h * 0.5, width: 3, sill: 3, height: 4, kind: 'window' }], exterior: true },
    );
  }

  const along = (w: Wall, t: number, y: number, out = 0): V3 => {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const ux = (w.b[0] - w.a[0]) / len;
    const uz = (w.b[1] - w.a[1]) / len;
    return [w.a[0] + ux * t + w.n[0] * out, y, w.a[1] + uz * t + w.n[1] * out];
  };
  /** Wall face pieces around openings: [t0, t1, y0, y1] in wall coordinates. */
  const pieces = (w: Wall) => {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const out: [number, number, number, number][] = [];
    let t = 0;
    for (const op of w.openings) {
      if (op.at > t) out.push([t, op.at, 0, w.h]);
      if (op.sill > 0) out.push([op.at, op.at + op.width, 0, op.sill]);
      out.push([op.at, op.at + op.width, op.sill + op.height, w.h]);
      t = op.at + op.width;
    }
    if (t < len) out.push([t, len, 0, w.h]);
    return out;
  };
  /** A thin panel on one face of a wall. */
  const facePanel = (phase: PhaseId, system: SystemId, mat: THREE.Material, w: Wall, piece: [number, number, number, number], offset: number, thick: number) => {
    const [t0, t1, ya, yb] = piece;
    if (t1 - t0 < 0.05 || yb - ya < 0.05) return;
    const p0 = along(w, t0, w.y0 + ya, offset);
    const p1 = along(w, t1, w.y0 + ya, offset);
    const minX = Math.min(p0[0], p1[0]);
    const minZ = Math.min(p0[2], p1[2]);
    const dx = Math.abs(p1[0] - p0[0]);
    const dz = Math.abs(p1[2] - p0[2]);
    b.box(phase, system, mat, [dx < 0.01 ? minX - thick / 2 : minX, w.y0 + ya, dz < 0.01 ? minZ - thick / 2 : minZ], [dx < 0.01 ? thick : dx, yb - ya, dz < 0.01 ? thick : dz]);
  };

  const studT = 0.29; // 3.5 in
  const studW = 0.125; // 1.5 in
  const spacing = spec.studSpacingIn / 12;
  for (const w of walls) {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    // 6 Framing: plates and studs, skipping openings, with headers.
    const inOpening = (t: number) => w.openings.find((op) => t > op.at - 0.05 && t < op.at + op.width + 0.05);
    b.beam(6, 'framing', M.plate, along(w, 0, w.y0 + 0.06, -studT / 2), along(w, len, w.y0 + 0.06, -studT / 2), studT, studW);
    b.beam(6, 'framing', M.plate, along(w, 0, w.y0 + w.h - 0.12, -studT / 2), along(w, len, w.y0 + w.h - 0.12, -studT / 2), studT, studW * 2);
    for (let t = 0.06; t <= len; t += spacing) {
      const op = inOpening(t);
      const base = along(w, Math.min(t, len - 0.06), w.y0 + 0.12, -studT / 2);
      if (!op) {
        b.beam(6, 'framing', M.stud, base, along(w, Math.min(t, len - 0.06), w.y0 + w.h - 0.24, -studT / 2), studW, studT);
      } else {
        if (op.sill > 0) b.beam(6, 'framing', M.stud, base, along(w, t, w.y0 + op.sill, -studT / 2), studW, studT);
        b.beam(6, 'framing', M.stud, along(w, t, w.y0 + op.sill + op.height + 0.5, -studT / 2), along(w, t, w.y0 + w.h - 0.24, -studT / 2), studW, studT);
      }
    }
    for (const op of w.openings) {
      const headerMat = op.kind === 'garage' ? M.steel : M.plate;
      const system: SystemId = 'framing';
      b.beam(6, system, headerMat, along(w, op.at - 0.2, w.y0 + op.sill + op.height + 0.25, -studT / 2), along(w, op.at + op.width + 0.2, w.y0 + op.sill + op.height + 0.25, -studT / 2), studT, 0.5);
      for (const t of [op.at - 0.06, op.at + op.width + 0.06]) {
        b.beam(6, 'framing', M.stud, along(w, t, w.y0 + 0.12, -studT / 2), along(w, t, w.y0 + w.h - 0.24, -studT / 2), studW, studT);
      }
    }
    if (!w.exterior) {
      // 13 Drywall both faces of partitions.
      for (const piece of pieces(w)) {
        facePanel(13, 'drywall', M.drywall, w, piece, 0.05, 0.04);
        facePanel(13, 'drywall', M.drywall, w, piece, -studT - 0.05, 0.04);
      }
      continue;
    }
    for (const piece of pieces(w)) {
      // 7 Sheathing, 10 siding outside; 12 insulation inside the cavity; 13 drywall inside face.
      facePanel(7, 'sheathing', M.osb, w, piece, 0.03, 0.04);
      facePanel(10, 'siding', M.siding, w, piece, 0.11, 0.06);
      facePanel(12, 'insulation', M.batt, w, piece, -studT / 2, studT * 0.8);
      facePanel(13, 'drywall', M.drywall, w, piece, -studT - 0.04, 0.04);
    }
    // Corner trim and a band at the top of the wall.
    b.beam(10, 'siding', M.trim, along(w, 0, w.y0 + w.h - 0.3, 0.16), along(w, len, w.y0 + w.h - 0.3, 0.16), 0.08, 0.6);
    // 9 Windows and doors.
    for (const op of w.openings) {
      const c0 = along(w, op.at, w.y0 + op.sill, 0.08);
      const c1 = along(w, op.at + op.width, w.y0 + op.sill, 0.08);
      const minX = Math.min(c0[0], c1[0]);
      const minZ = Math.min(c0[2], c1[2]);
      const dx = Math.abs(c1[0] - c0[0]);
      const dz = Math.abs(c1[2] - c0[2]);
      const thick = 0.12;
      const box = (mat: THREE.Material, inset: number, depth: number, yOff = 0, hOverride?: number) =>
        b.box(9, 'openings', mat,
          [dx < 0.01 ? minX - depth / 2 : minX + inset, w.y0 + op.sill + inset + yOff, dz < 0.01 ? minZ - depth / 2 : minZ + inset],
          [dx < 0.01 ? depth : dx - inset * 2, (hOverride ?? op.height) - inset * 2, dz < 0.01 ? depth : dz - inset * 2]);
      if (op.kind === 'window') {
        box(M.frame, 0, thick + 0.04);
        box(M.glass, 0.18, thick + 0.08);
      } else if (op.kind === 'door') {
        box(M.door, 0, thick + 0.06);
      } else {
        box(M.garageDoor, 0, thick + 0.06);
      }
    }
  }

  // ---------- 7 Trusses (gable along x, ridge at z = W/2) and roof deck.
  const trussMat = M.truss;
  const gableY = top + ff;
  for (let x = 0; x <= L + 0.01; x += 2) {
    const xx = Math.min(x, L);
    const eaveIn: V3 = [xx, gableY, -o];
    const eaveOut: V3 = [xx, gableY, W + o];
    const peak: V3 = [xx, gableY + rise + (o * spec.roofPitch) / 12, W / 2];
    const lift = (o * spec.roofPitch) / 12;
    eaveIn[1] -= lift;
    eaveOut[1] -= lift;
    peak[1] -= lift;
    b.beam(7, 'trusses', trussMat, [xx, gableY, 0], [xx, gableY, W], 0.125, 0.29);
    b.beam(7, 'trusses', trussMat, eaveIn, peak, 0.125, 0.29);
    b.beam(7, 'trusses', trussMat, peak, eaveOut, 0.125, 0.29);
    b.beam(7, 'trusses', trussMat, [xx, gableY, W / 2], peak, 0.125, 0.25);
    b.beam(7, 'trusses', trussMat, [xx, gableY, W / 4], [xx, gableY + rise / 2, W / 2 - 0.01], 0.125, 0.2);
    b.beam(7, 'trusses', trussMat, [xx, gableY, (3 * W) / 4], [xx, gableY + rise / 2, W / 2 + 0.01], 0.125, 0.2);
  }
  const roofPlane = (phase: PhaseId, system: SystemId, mat: THREE.Material, lift: number) => {
    const y0 = gableY - (o * spec.roofPitch) / 12 + lift;
    const yr = gableY + rise + lift;
    for (const [zEave, zRidge] of [[-o, W / 2], [W + o, W / 2]] as const) {
      const geo = new THREE.BufferGeometry();
      const v = [
        -o, y0, zEave, L + o, y0, zEave, L + o, yr, zRidge,
        -o, y0, zEave, L + o, yr, zRidge, -o, yr, zRidge,
      ];
      geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      geo.computeVertexNormals();
      b.mesh(phase, system, geo, mat);
    }
  };
  roofPlane(7, 'sheathing', M.osb, 0.35);
  roofPlane(8, 'roofing', M.shingle, 0.45);
  b.beam(8, 'roofing', M.ridge, [-o, gableY + rise + 0.5, W / 2], [L + o, gableY + rise + 0.5, W / 2], 0.6, 0.25);
  // Gable ends (siding) on both short walls.
  for (const x of [0, L]) {
    const geo = new THREE.BufferGeometry();
    const out = x === 0 ? -0.12 : 0.12;
    geo.setAttribute('position', new THREE.Float32BufferAttribute([x + out, gableY, 0, x + out, gableY, W, x + out, gableY + rise, W / 2], 3));
    geo.computeVertexNormals();
    b.mesh(10, 'siding', geo, b.mat('#e9e5dc', { clip: true, side: THREE.DoubleSide }));
  }
  if (g) {
    // Garage: low-slope roof with joists.
    for (let z = g.y; z <= g.y + g.h + 0.01; z += 2) b.beam(7, 'trusses', trussMat, [g.x, ff + gh, z], [g.x + g.w, ff + gh, z], 0.125, 0.6);
    b.box(7, 'sheathing', M.osb, [g.x, ff + gh + 0.3, g.y - o], [g.w + o, 0.05, g.h + 2 * o]);
    b.box(8, 'roofing', M.shingle, [g.x, ff + gh + 0.36, g.y - o], [g.w + o, 0.12, g.h + 2 * o]);
  }

  // ---------- 11 MEP rough-in.
  for (let f = 0; f < stories; f += 1) {
    const y = ff + f * (H + 1) + H - 0.9;
    const trunkZ = W / 2;
    b.box(11, 'hvac', M.duct, [L * 0.12, y, trunkZ - 0.6], [L * 0.76, 0.8, 1.2]);
    for (const r of layout.floors[f]!.rooms) {
      if (r.kind === 'hall' || r.kind === 'stair') continue;
      const cx = r.x + r.w / 2;
      const cz = r.y + r.h / 2;
      b.pipe(11, 'hvac', M.duct, [cx, y + 0.4, trunkZ], [cx, y + 0.4, cz], 0.55);
      if (r.kind === 'bath' || r.kind === 'kitchen' || r.kind === 'laundry') {
        b.pipe(11, 'plumbing', M.water, [cx - 0.4, ff + f * (H + 1), cz], [cx - 0.4, y, cz], 0.12);
        b.pipe(11, 'plumbing', M.hot, [cx + 0.4, ff + f * (H + 1), cz], [cx + 0.4, y, cz], 0.12);
        b.pipe(11, 'plumbing', M.dwv, [cx, ff + f * (H + 1), cz + 0.6], [cx, y + 1.5, cz + 0.6], 0.25);
      }
    }
    // Electrical: conduit run along the top of the exterior walls and boxes.
    for (const w of walls.filter((x) => x.exterior && Math.abs(x.y0 - (ff + f * (H + 1))) < 0.01)) {
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      b.beam(11, 'electrical', M.conduit, along(w, 0.3, w.y0 + w.h - 1.2, -0.2), along(w, len - 0.3, w.y0 + w.h - 1.2, -0.2), 0.08);
      for (let t = 4; t < len - 2; t += 8) b.box(11, 'electrical', M.conduit, along(w, t, w.y0 + 1.3, -0.25).map((v, i) => (i === 1 ? v : v - 0.12)) as V3, [0.25, 0.35, 0.25]);
    }
  }
  b.box(11, 'electrical', M.panel, [g ? g.x + 0.3 : L - 1.3, ff + 4, g ? g.y + 1 : W - 0.6], [0.3, 2.4, 1.6]);
  // Ceilings (drywall, cut away with the shell).
  for (let f = 0; f < stories; f += 1) b.box(13, 'drywall', M.ceiling, [0, ff + f * (H + 1) + H - 0.05, 0], [L, 0.05, W]);

  // ---------- 14 Interior finishes.
  for (let f = 0; f < stories; f += 1) {
    const y = ff + f * (H + 1);
    for (const r of layout.floors[f]!.rooms) {
      const wet = r.kind === 'bath' || r.kind === 'kitchen' || r.kind === 'laundry';
      const mat = wet ? M.tile : r.kind === 'bedroom' || r.kind === 'primary' ? M.carpet : M.wood;
      b.box(14, 'flooring', mat, [r.x + 0.15, y, r.y + 0.15], [r.w - 0.3, 0.06, r.h - 0.3]);
      if (r.kind === 'kitchen') {
        const run = Math.min(r.w - 1, 14);
        b.box(14, 'cabinets', M.cabinet, [r.x + 0.5, y, r.y + 0.4], [run, 3, 2]);
        b.box(14, 'cabinets', M.counter, [r.x + 0.45, y + 3, r.y + 0.35], [run + 0.1, 0.12, 2.1]);
        b.box(14, 'cabinets', M.cabinet, [r.x + 0.5, y + 4.6, r.y + 0.4], [run, 2.4, 1.1]);
        if (r.h > 12) {
          b.box(14, 'cabinets', M.cabinet, [r.x + r.w / 2 - 3, y, r.y + r.h / 2], [6, 3, 3]);
          b.box(14, 'cabinets', M.counter, [r.x + r.w / 2 - 3.1, y + 3, r.y + r.h / 2 - 0.1], [6.2, 0.12, 3.2]);
        }
      }
      if (r.kind === 'bath') {
        b.box(14, 'fixtures', M.fixture, [r.x + 0.3, y, r.y + 0.3], [Math.min(5, r.w - 0.6), 1.8, 2.5]);
        b.box(14, 'fixtures', M.fixture, [r.x + r.w - 2.4, y, r.y + r.h - 1.9], [2, 2.8, 1.6]);
      }
    }
  }

  // ---------- 15 Driveway + patio, 16 landscape.
  if (g) b.box(15, 'outdoor', M.drive, [g.x + 1, 0, g.y + g.h], [g.w - 2, 0.15, Math.max(10, driveArea(takeoff) / Math.max(1, g.w - 2))]);
  else b.box(15, 'outdoor', M.drive, [L * 0.42 - 2, 0, W], [5, 0.15, 24]);
  const patioW = Math.min(L * 0.4, 20);
  b.box(15, 'outdoor', M.drive, [L * 0.55 - patioW / 2, 0, -12], [patioW, 0.15, patioArea(takeoff) / patioW]);
  b.box(16, 'landscape', M.grass, [lotX0, -0.05, W + 1], [(g ? g.x : L * 0.42 - 2) - lotX0 - 1, 0.08, lotZ1 - W - 1]);
  for (let i = 0; i < 6; i += 1) {
    const x = (L * (i + 0.5)) / 6;
    if (!g && Math.abs(x - L * 0.42) < 3) continue;
    b.pipe(16, 'landscape', M.shrub, [x, 0, W + 1.6], [x, 1.4, W + 1.6], 1.4);
  }
  const trees: [number, number][] = [[-8, W + 14], [L * 0.3, W + 20], [L + (g?.w ?? 0) + 8, W * 0.3], [-9, -6]];
  for (const [x, z] of trees) {
    b.pipe(16, 'landscape', M.trunk, [x, 0, z], [x, 6, z], 0.6);
    const geo = new THREE.IcosahedronGeometry(4, 1);
    geo.translate(x, 8.5, z);
    b.mesh(16, 'landscape', geo, M.canopy);
  }

  b.finish(root);

  // ---------- Blueprint: dark site, lot lines, column grid with bubbles, dimension strings.
  const blueprint = new THREE.Group();
  const groundGeo = new THREE.PlaneGeometry(lotX1 - lotX0 + 120, lotZ1 - lotZ0 + 120);
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate((lotX0 + lotX1) / 2, -0.4, (lotZ0 + lotZ1) / 2);
  const groundMat = new THREE.MeshStandardMaterial({ color: '#0c1626', roughness: 1 });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.receiveShadow = true;
  blueprint.add(groundMesh);
  const lineMat = new THREE.LineBasicMaterial({ color: '#8fb4e8', transparent: true, opacity: 0.55 });
  const dashMat = new THREE.LineDashedMaterial({ color: '#8fb4e8', transparent: true, opacity: 0.35, dashSize: 1.5, gapSize: 1 });
  const y = -0.35;
  const lines = (pts: number[], mat: THREE.LineBasicMaterial | THREE.LineDashedMaterial) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const seg = new THREE.LineSegments(geo, mat);
    if (mat instanceof THREE.LineDashedMaterial) seg.computeLineDistances();
    blueprint.add(seg);
  };
  lines([lotX0, y, lotZ0, lotX1, y, lotZ0, lotX1, y, lotZ0, lotX1, y, lotZ1, lotX1, y, lotZ1, lotX0, y, lotZ1, lotX0, y, lotZ1, lotX0, y, lotZ0], lineMat);
  // Column grid: lettered along x at wall lines, numbered along z.
  const xs = Array.from(new Set([0, ...ground.rooms.flatMap((r) => [r.x, r.x + r.w]), L].map((v) => r2(v)))).sort((p, q) => p - q);
  const gridX = xs.filter((v, i) => i === 0 || i === xs.length - 1 || (v - xs[i - 1]! > 6)).slice(0, 8);
  const zs = Array.from(new Set([0, ...ground.rooms.flatMap((r) => [r.y, r.y + r.h]), W].map((v) => r2(v)))).sort((p, q) => p - q);
  const gridZ = zs.filter((v, i) => i === 0 || i === zs.length - 1 || (v - zs[i - 1]! > 6)).slice(0, 6);
  const bubbles: { text: string; pos: V3 }[] = [];
  gridX.forEach((x, i) => {
    lines([x, y, -10, x, y, W + 10], dashMat);
    bubbles.push({ text: String.fromCharCode(65 + i), pos: [x, y, -12] }, { text: String.fromCharCode(65 + i), pos: [x, y, W + 12] });
  });
  gridZ.forEach((z, i) => {
    lines([-10, y, z, L + (g?.w ?? 0) + 10, y, z], dashMat);
    bubbles.push({ text: String(i + 1), pos: [-12, y, z] }, { text: String(i + 1), pos: [L + (g?.w ?? 0) + 12, y, z] });
  });
  for (const bb of bubbles) blueprint.add(bubble(bb.text, bb.pos));
  // Dimension string along the street side and the left side.
  const dz = W + 7;
  lines([0, y, dz, L, y, dz, 0, y, dz - 1, 0, y, dz + 1, L, y, dz - 1, L, y, dz + 1], lineMat);
  blueprint.add(textSprite(feetInches(L), [L / 2, y + 0.05, dz + 1.6], 1.6));
  const dx = -7;
  lines([dx, y, 0, dx, y, W, dx - 1, y, 0, dx + 1, y, 0, dx - 1, y, W, dx + 1, y, W], lineMat);
  blueprint.add(textSprite(feetInches(W), [dx - 1.8, y + 0.05, W / 2], 1.6));

  const grid = new THREE.GridHelper(400, 80, '#2a4a7a', '#1a2c48');
  grid.position.set((lotX0 + lotX1) / 2, -0.38, (lotZ0 + lotZ1) / 2);

  const centerX = (0 + L + (g?.w ?? 0)) / 2;
  const center = new THREE.Vector3(centerX, ridge / 3, W / 2);
  const size = Math.max(L + (g?.w ?? 0), W, ridge) + 20;
  const levels: StudioLevel[] = [
    { label: `T.O. Ridge ${feetInches(gableY + rise - ff)}`, y: gableY + rise + 0.4 },
    { label: `T.O. Plate ${feetInches(top)}`, y: gableY },
    ...(stories > 1 ? [{ label: `Level 2 ${feetInches(H + 1)}`, y: ff + H + 1 }] : []),
    { label: 'F.F. 0\'-0"', y: ff },
  ];

  return {
    root,
    parts: b.parts,
    blueprint,
    grid,
    center,
    size,
    levels,
    clipPlane,
    xRange: [-o, L + (g?.w ?? 0)],
    dispose: () => {
      for (const geo of b.geometries) geo.dispose();
      for (const m of b.materials) m.dispose();
      blueprint.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) {
          (mat as THREE.SpriteMaterial).map?.dispose();
          mat.dispose();
        }
      });
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
    },
  };
}

export function feetInches(ft: number): string {
  const total = Math.round(ft * 12);
  return `${Math.floor(total / 12)}'-${total % 12}"`;
}

function canvasTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function bubble(text: string, pos: V3) {
  const tex = canvasTexture((ctx, w, h) => {
    ctx.strokeStyle = '#a9c6f0';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#d6e4f7';
    ctx.font = 'bold 56px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 3);
  }, 128, 128);
  const geo = new THREE.PlaneGeometry(3.4, 3.4);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  mesh.position.set(...pos);
  return mesh;
}

function textSprite(text: string, pos: V3, height: number) {
  const tex = canvasTexture((ctx, w, h) => {
    ctx.fillStyle = '#a9c6f0';
    ctx.font = '600 64px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2);
  }, 512, 128);
  const geo = new THREE.PlaneGeometry(height * 4, height);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  mesh.position.set(...pos);
  return mesh;
}

export { systemColor };
