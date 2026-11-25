// 3D site plan for Land feasibility. Scene units are feet. The parcel is centred on the origin;
// the existing street edge (parcel z = 0) faces the viewer at +Z. Ground height is drawn above
// the lowest point of the parcel, optionally exaggerated so gentle slopes are visible.
import * as THREE from 'three';
import {
  elevationAt,
  passes,
  slopeAt,
  type FeasibilityInputs,
  type FeasibilityResult,
  type Rect,
} from './siteFeasibility';
import type { SubdivisionPlan } from './subdivision';
import type { LotStage } from './phases';
import { decisionClass, type DecisionZone } from './decisionClasses';

export interface LandSceneOptions {
  trees: boolean;
  heatmap: boolean;
  labels: boolean;
  underground: boolean;
  exaggeration: number;
  /** Quick subdivision grid to overlay on the 3D site plan (off by default). */
  subdivision?: SubdivisionPlan | null;
  /**
   * Per-lot phase colour for the subdivision overlay, keyed by lot number.
   * When absent the overlay keeps its existing white outlines.
   */
  subdivisionPhaseColors?: Record<number, string> | null;
  /**
   * Per-lot stage at the playback month, keyed by lot number. Lots whose stage is
   * 'not_started' are dimmed. When absent nothing is dimmed.
   */
  phaseStage?: Record<number, LotStage> | null;
  /**
   * Contractor-painted land decision-class zones to drape over the terrain. Drawn only
   * when given (the builder toggles the layer); they are the builder's judgment, never
   * measured land-cover data.
   */
  decisionZones?: DecisionZone[] | null;
}

export interface LandSceneInfo {
  group: THREE.Group;
  /** Largest parcel side, feet: used to frame the camera. */
  span: number;
  /** Scene height of the street edge middle, for the street-level camera. */
  streetY: number;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** Slope colour: green flat, yellow moderate, orange steep, red over the building limit. */
export function slopeColor(pct: number, maxPct: number): THREE.Color {
  if (pct >= maxPct) return new THREE.Color('#e5484d');
  if (pct >= maxPct * 0.6) return new THREE.Color('#f08c2e');
  if (pct >= maxPct * 0.25) return new THREE.Color('#f5c451');
  return new THREE.Color('#3fb27f');
}

function label(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(7, 13, 24, 0.82)';
    ctx.fillRect(0, 0, 256, 96);
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, 250, 90);
    ctx.fillStyle = '#e6edf7';
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 50);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }),
  );
  sprite.renderOrder = 10;
  return sprite;
}

export function buildLandScene(
  inputs: FeasibilityInputs,
  result: FeasibilityResult,
  opts: LandSceneOptions,
): LandSceneInfo {
  const group = new THREE.Group();
  group.name = 'land-feasibility';
  const { widthFt: W, depthFt: D } = inputs.parcel;
  const span = Math.max(W, D);
  const flat = inputs.terrain.grid.flat();
  const minE = flat.length ? Math.min(...flat) : 0;
  const k = Math.max(0.1, opts.exaggeration);
  const toX = (x: number) => x - W / 2;
  const toZ = (z: number) => D / 2 - z;
  const groundY = (x: number, z: number) =>
    (elevationAt(inputs.terrain, inputs.parcel, x, z) - minE) * k;

  // ---- terrain
  const segs = 48;
  const geo = new THREE.PlaneGeometry(W, D, segs, segs);
  geo.rotateX(-Math.PI / 2); // plane now in x/z, local z runs +D/2 (front) .. -D/2 (back)
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const earth = new THREE.Color(opts.trees ? '#2f4a35' : '#6b5a43');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + W / 2;
    const z = D / 2 - pos.getZ(i);
    pos.setY(i, groundY(x, z));
    const c = opts.heatmap
      ? slopeColor(slopeAt(inputs.terrain, inputs.parcel, x, z), inputs.rules.maxBuildSlopePct)
      : earth;
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      side: THREE.DoubleSide,
      transparent: opts.underground,
      opacity: opts.underground ? 0.35 : 1,
      depthWrite: !opts.underground,
    }),
  );
  terrain.receiveShadow = true;
  terrain.name = 'terrain';
  group.add(terrain);

  // Outline on the ground: sample along each edge so the line follows the slope.
  const drape = (r: Rect, color: string, lift = 0.6, opacity = 1) => {
    const pts: THREE.Vector3[] = [];
    const corners: [number, number][] = [
      [r.x0, r.z0],
      [r.x1, r.z0],
      [r.x1, r.z1],
      [r.x0, r.z1],
      [r.x0, r.z0],
    ];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i]!;
      const [bx, bz] = corners[i + 1]!;
      for (let s = 0; s <= 12; s++) {
        const x = ax + ((bx - ax) * s) / 12;
        const z = az + ((bz - az) * s) / 12;
        pts.push(new THREE.Vector3(toX(x), groundY(x, z) + lift, toZ(z)));
      }
    }
    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }),
    );
  };
  group.add(drape({ x0: 0, x1: W, z0: 0, z1: D }, '#f5c451', 1));

  // ---- existing street in front of the parcel, and the new street if the layout has one
  // In the underground view the street, pads and houses turn see-through so the pipes show.
  const seeThrough = opts.underground
    ? { transparent: true, opacity: 0.35, depthWrite: false }
    : {};
  const roadMat = new THREE.MeshStandardMaterial({ color: '#4a4d52', roughness: 1, ...seeThrough });
  const frontY = groundY(W / 2, 0);
  const street = new THREE.Mesh(new THREE.BoxGeometry(W + 80, 0.6, 36), roadMat);
  street.position.set(0, frontY - 0.2, D / 2 + 20);
  group.add(street);
  const road = result.layout.road;
  if (road) {
    const rw = road.x1 - road.x0;
    const rgeo = new THREE.PlaneGeometry(rw, D, 2, segs);
    rgeo.rotateX(-Math.PI / 2);
    const rp = rgeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < rp.count; i++) {
      const x = rp.getX(i) + (road.x0 + road.x1) / 2;
      const z = D / 2 - rp.getZ(i);
      rp.setX(i, toX(x));
      rp.setY(i, groundY(x, z) + 0.4);
    }
    rgeo.computeVertexNormals();
    group.add(new THREE.Mesh(rgeo, roadMat));
  }

  // ---- lots, pads and houses
  const houseMat = new THREE.MeshStandardMaterial({
    color: '#e8e2d6',
    roughness: 0.8,
    ...seeThrough,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: '#3b4350',
    roughness: 0.7,
    ...seeThrough,
  });
  for (const lot of result.layout.lots) {
    const ok = passes(lot);
    const color = ok ? (lot.issues.length ? '#f5c451' : '#3fb27f') : '#e5484d';
    group.add(drape(lot.rect, color));
    group.add(drape(lot.buildable, '#8fc2ff', 0.5));
    if (lot.home && ok) {
      const padY = (lot.padElevationFt - minE) * k;
      const w = lot.home.x1 - lot.home.x0;
      const d = lot.home.z1 - lot.home.z0;
      const cx = toX((lot.home.x0 + lot.home.x1) / 2);
      const cz = toZ((lot.home.z0 + lot.home.z1) / 2);
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(w + 20, 1, d + 20),
        new THREE.MeshStandardMaterial({ color: '#a08d6e', roughness: 1, ...seeThrough }),
      );
      pad.position.set(cx, padY - 0.5, cz);
      pad.receiveShadow = true;
      group.add(pad);
      const body = new THREE.Mesh(new THREE.BoxGeometry(w, 18, d), houseMat);
      body.position.set(cx, padY + 9, cz);
      body.castShadow = true;
      group.add(body);
      // A 4-sided cone turned 45 degrees has a unit-square base; the parent stretches it to the house.
      const cone = new THREE.Mesh(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4), roofMat);
      cone.rotation.y = Math.PI / 4;
      cone.castShadow = true;
      const roof = new THREE.Group();
      roof.add(cone);
      roof.scale.set(w, 9, d);
      roof.position.set(cx, padY + 22.5, cz);
      group.add(roof);
    }
    if (opts.labels) {
      const mid = { x: (lot.rect.x0 + lot.rect.x1) / 2, z: (lot.rect.z0 + lot.rect.z1) / 2 };
      const tag = label(ok ? `Lot ${lot.number}` : `Lot ${lot.number} fails`, color);
      tag.position.set(toX(mid.x), groundY(mid.x, mid.z) + 34, toZ(mid.z));
      const s = Math.max(16, span / 18);
      tag.scale.set(s, s * 0.375, 1);
      group.add(tag);
    }
  }

  // ---- subdivision grid overlay (planning layout, drawn only when the builder asks)
  if (opts.subdivision) {
    const sub = opts.subdivision;
    if (sub.road) {
      const rw = sub.road.x1 - sub.road.x0;
      const rgeo = new THREE.PlaneGeometry(rw, D, 2, 8);
      rgeo.rotateX(-Math.PI / 2);
      const rp = rgeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < rp.count; i++) {
        const x = rp.getX(i) + (sub.road.x0 + sub.road.x1) / 2;
        const z = D / 2 - rp.getZ(i);
        rp.setX(i, toX(x));
        rp.setY(i, groundY(x, z) + 0.8);
      }
      rgeo.computeVertexNormals();
      group.add(
        new THREE.Mesh(
          rgeo,
          new THREE.MeshStandardMaterial({ color: '#8a8f98', roughness: 1 }),
        ),
      );
    }
    for (const lot of sub.lots) {
      // Phase colour when phases are defined, otherwise the existing white outline.
      const phaseColor = opts.subdivisionPhaseColors?.[lot.number] ?? '#e6edf7';
      const notStarted = opts.phaseStage?.[lot.number] === 'not_started';
      group.add(drape(lot.rect, phaseColor, 1.2, notStarted ? 0.25 : 1));
      if (opts.labels) {
        const mid = { x: (lot.rect.x0 + lot.rect.x1) / 2, z: (lot.rect.z0 + lot.rect.z1) / 2 };
        const tag = label(`Sub lot ${lot.number}`, phaseColor);
        if (notStarted) (tag.material as THREE.SpriteMaterial).opacity = 0.35;
        tag.position.set(toX(mid.x), groundY(mid.x, mid.z) + 52, toZ(mid.z));
        const s = Math.max(16, span / 18);
        tag.scale.set(s, s * 0.375, 1);
        group.add(tag);
      }
    }
  }

  // ---- land decision-class zones (contractor-painted; draped over the terrain)
  if (opts.decisionZones && opts.decisionZones.length > 0) {
    for (const zone of opts.decisionZones) {
      const cls = decisionClass(zone.classId);
      const r = zone.rect;
      const zw = Math.max(1, r.x1 - r.x0);
      const zd = Math.max(1, r.z1 - r.z0);
      const zgeo = new THREE.PlaneGeometry(zw, zd, 8, 8);
      zgeo.rotateX(-Math.PI / 2);
      const zp = zgeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < zp.count; i++) {
        const x = zp.getX(i) + (r.x0 + r.x1) / 2;
        const z = (r.z0 + r.z1) / 2 - zp.getZ(i);
        zp.setX(i, toX(x));
        zp.setY(i, groundY(x, z) + 1.5);
        zp.setZ(i, toZ(z));
      }
      zgeo.computeVertexNormals();
      const fill = new THREE.Mesh(
        zgeo,
        new THREE.MeshStandardMaterial({
          color: cls.color,
          transparent: true,
          opacity: 0.45,
          roughness: 1,
          depthWrite: false,
        }),
      );
      fill.name = `decision-zone-${zone.id}`;
      group.add(fill);
      group.add(drape(r, cls.color, 2));
      if (opts.labels) {
        const mid = { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
        const tag = label(cls.label, cls.color);
        tag.position.set(toX(mid.x), groundY(mid.x, mid.z) + 40, toZ(mid.z));
        const s = Math.max(16, span / 18);
        tag.scale.set(s, s * 0.375, 1);
        group.add(tag);
      }
    }
  }

  // ---- trees (deterministic), kept off the street, pads and new road
  if (opts.trees && inputs.treeCoverPct > 0) {
    const rand = rng(Math.round(W * 7 + D * 13));
    const target = Math.min(900, Math.round((W * D * (inputs.treeCoverPct / 100)) / 900));
    const homes = result.layout.lots.filter((l) => l.home && passes(l)).map((l) => l.home!);
    const blocked = (x: number, z: number) =>
      (road && x > road.x0 - 6 && x < road.x1 + 6) ||
      homes.some((h) => x > h.x0 - 14 && x < h.x1 + 14 && z > h.z0 - 14 && z < h.z1 + 14);
    const spots: [number, number][] = [];
    for (let i = 0; i < target * 3 && spots.length < target; i++) {
      const x = rand() * W;
      const z = rand() * D;
      if (!blocked(x, z)) spots.push([x, z]);
    }
    const crown = new THREE.InstancedMesh(
      new THREE.ConeGeometry(9, 26, 7),
      new THREE.MeshStandardMaterial({ color: '#2e6b3f', roughness: 0.9 }),
      spots.length,
    );
    const trunk = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(1, 1.3, 8, 6),
      new THREE.MeshStandardMaterial({ color: '#5a4330' }),
      spots.length,
    );
    const m = new THREE.Matrix4();
    spots.forEach(([x, z], i) => {
      const y = groundY(x, z);
      const s = 0.75 + rand() * 0.6;
      m.compose(
        new THREE.Vector3(toX(x), y + 4 * s, toZ(z)),
        new THREE.Quaternion(),
        new THREE.Vector3(s, s, s),
      );
      trunk.setMatrixAt(i, m);
      m.compose(
        new THREE.Vector3(toX(x), y + (8 + 13) * s, toZ(z)),
        new THREE.Quaternion(),
        new THREE.Vector3(s, s, s),
      );
      crown.setMatrixAt(i, m);
    });
    crown.castShadow = true;
    group.add(trunk, crown);
  }

  // ---- underground: water (blue) and sewer (green) mains with a service to each usable lot.
  // Drawn schematically: the city's real main locations need its utility GIS layer.
  if (opts.underground) {
    const pipe = (pts: [number, number][], depth: number, color: string, r: number) => {
      const path = new THREE.CurvePath<THREE.Vector3>();
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i]!;
        const [bx, bz] = pts[i + 1]!;
        path.add(
          new THREE.LineCurve3(
            new THREE.Vector3(toX(ax), groundY(ax, az) - depth, toZ(az)),
            new THREE.Vector3(toX(bx), groundY(bx, bz) - depth, toZ(bz)),
          ),
        );
      }
      return new THREE.Mesh(
        new THREE.TubeGeometry(path, 24 * (pts.length - 1), r, 8, false),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 }),
      );
    };
    const mainLine = (offset: number): [number, number][] =>
      road
        ? [
            [(road.x0 + road.x1) / 2 + offset, -18],
            [(road.x0 + road.x1) / 2 + offset, D - 5],
          ]
        : [
            [0, -18 + offset],
            [W, -18 + offset],
          ];
    group.add(pipe(mainLine(-6), 5, '#3d8bfd', 0.9));
    group.add(pipe(mainLine(6), 8, '#3fb27f', 1.1));
    for (const lot of result.layout.lots) {
      if (!lot.home || !passes(lot)) continue;
      const hx = (lot.home.x0 + lot.home.x1) / 2;
      const hz = (lot.home.z0 + lot.home.z1) / 2;
      const tap: [number, number] = road ? [(road.x0 + road.x1) / 2 - 6, hz] : [hx, -24];
      const sew: [number, number] = road ? [(road.x0 + road.x1) / 2 + 6, hz + 4] : [hx + 4, -12];
      group.add(pipe([tap, [hx, hz]], 5, '#3d8bfd', 0.45));
      group.add(pipe([sew, [hx + 4, hz + 4]], 8, '#3fb27f', 0.55));
    }
  }

  return { group, span, streetY: frontY };
}

export function disposeLandScene(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    const list = Array.isArray(mat) ? mat : mat ? [mat] : [];
    for (const m of list) {
      (m as THREE.SpriteMaterial).map?.dispose();
      m.dispose();
    }
  });
  group.clear();
}
