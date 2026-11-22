// House Studio site layers: the builder's own lot (lot lines + setback box) and, for "In real life",
// the mapped buildings, streets and trees around it. Scene units are feet. The house front faces
// +z (the street); the map's north is drawn toward -z. The real neighborhood is placed around the
// house center; the house is not yet rotated to match the street, which the UI says plainly.
import * as THREE from 'three';
import type { SiteContextResponse, StudioLot } from '@fieldline/contracts';
import type { StudioScene } from './studioScene';
import type { Takeoff } from './takeoff';

const FT_PER_M = 3.28084;

function lineLoop(points: [number, number][], y: number, material: THREE.LineBasicMaterial | THREE.LineDashedMaterial) {
  const pos: number[] = [];
  points.forEach(([x, z], i) => {
    const [nx, nz] = points[(i + 1) % points.length]!;
    pos.push(x, y, z, nx, y, nz);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const seg = new THREE.LineSegments(geo, material);
  if (material instanceof THREE.LineDashedMaterial) seg.computeLineDistances();
  return seg;
}

/** Lot lines (solid) and the buildable area inside the setbacks (dashed), centred on the house. */
export function buildUserLot(lot: StudioLot, studio: StudioScene, takeoff: Takeoff): THREE.Group {
  const group = new THREE.Group();
  group.name = 'user-lot';
  const cx = studio.center.x;
  const front = takeoff.layout.footprint.widthFt + lot.frontSetbackFt; // street line (z)
  const x0 = cx - lot.widthFt / 2;
  const x1 = cx + lot.widthFt / 2;
  const z0 = front - lot.depthFt;
  const lotMat = new THREE.LineBasicMaterial({ color: '#f5c451' });
  const setbackMat = new THREE.LineDashedMaterial({ color: '#f5c451', dashSize: 2, gapSize: 1.5, transparent: true, opacity: 0.8 });
  group.add(lineLoop([[x0, z0], [x1, z0], [x1, front], [x0, front]], -0.3, lotMat));
  group.add(lineLoop([
    [x0 + lot.sideSetbackFt, z0 + lot.rearSetbackFt],
    [x1 - lot.sideSetbackFt, z0 + lot.rearSetbackFt],
    [x1 - lot.sideSetbackFt, front - lot.frontSetbackFt],
    [x0 + lot.sideSetbackFt, front - lot.frontSetbackFt],
  ], -0.29, setbackMat));
  return group;
}

function containsOrigin(ring: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > 0 !== b.y > 0 && 0 < ((b.x - a.x) * (0 - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Mapped neighbours (extruded footprints), streets (flat ribbons) and trees (instanced). */
export function buildSurroundings(ctx: SiteContextResponse, studio: StudioScene, takeoff: Takeoff): THREE.Group {
  const group = new THREE.Group();
  group.name = 'surroundings';
  const cx = studio.center.x;
  const cz = takeoff.layout.footprint.widthFt / 2;
  const toScene = (p: { x: number; y: number }) => [cx + p.x * FT_PER_M, cz - p.y * FT_PER_M] as const;

  const wallMat = new THREE.MeshStandardMaterial({ color: '#d8d2c6', roughness: 0.9 });
  for (const b of ctx.buildings) {
    // The building already standing at the address is where the new house goes; leave it out.
    if (containsOrigin(b.ring)) continue;
    const shape = new THREE.Shape(b.ring.map((p) => {
      const [x, z] = toScene(p);
      return new THREE.Vector2(x, -z);
    }));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(8, b.heightM * FT_PER_M), bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, wallMat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  const roadMat = new THREE.MeshStandardMaterial({ color: '#4a4d52', roughness: 1 });
  const segments: { x: number; z: number; len: number; angle: number; width: number }[] = [];
  for (const r of ctx.roads) {
    for (let i = 1; i < r.points.length; i += 1) {
      const [ax, az] = toScene(r.points[i - 1]!);
      const [bx, bz] = toScene(r.points[i]!);
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.5) continue;
      segments.push({ x: (ax + bx) / 2, z: (az + bz) / 2, len, angle: Math.atan2(bz - az, bx - ax), width: r.widthM * FT_PER_M });
    }
  }
  if (segments.length) {
    const roads = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.2, 1), roadMat, segments.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    segments.forEach((sgm, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -sgm.angle);
      m.compose(new THREE.Vector3(sgm.x, -0.38, sgm.z), q, new THREE.Vector3(sgm.len + sgm.width * 0.3, 1, sgm.width));
      roads.setMatrixAt(i, m);
    });
    roads.receiveShadow = true;
    group.add(roads);
  }

  if (ctx.trees.length) {
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.7, 8, 6), new THREE.MeshStandardMaterial({ color: '#6b4a2f' }), ctx.trees.length);
    const crown = new THREE.InstancedMesh(new THREE.SphereGeometry(6, 10, 8), new THREE.MeshStandardMaterial({ color: '#4f8f4b', roughness: 0.95 }), ctx.trees.length);
    const m = new THREE.Matrix4();
    ctx.trees.forEach((t, i) => {
      const [x, z] = toScene(t);
      m.makeTranslation(x, 4, z);
      trunk.setMatrixAt(i, m);
      m.makeTranslation(x, 12, z);
      crown.setMatrixAt(i, m);
    });
    trunk.castShadow = true;
    crown.castShadow = true;
    group.add(trunk, crown);
  }
  return group;
}

/** Frees every geometry and material under a group and empties it. */
export function disposeGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
  group.clear();
}
