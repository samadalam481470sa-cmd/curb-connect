'use client';

// 3D terrain view for the GIS Workbench: USGS 3DEP ground heights from the existing
// /v1/site/terrain service drawn as a three.js terrain mesh, with the company's traced roof
// outlines extruded as buildings standing on it. The terrain grid is parcel-scale (7×7 samples
// over 5,000 × 5,000 ft, smoothed between samples) — labelled with its source and "not a
// survey", and building height is visualization only, never a measured height.
import { SiteTerrainResponseSchema, type SiteTerrainResponse } from '@fieldline/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { orgKey, useApi, useSession } from '../../lib/session';
import type { GisFeature } from './layers';

const FT_PER_DEG_LAT = 364_000;
const SIZE_FT = 5000;
const SAMPLES = 7;
const SEGMENTS = 56;
const BUILDING_HEIGHT_FT = 15;

export interface Terrain3DProps {
  centerLat: number;
  centerLon: number;
  /** Traced-roof polygons to extrude (the roofs layer features). */
  roofs: readonly GisFeature[];
}

/** Bilinear sample of the (possibly partial) elevation grid at u,v in 0..1. */
function sampleGrid(grid: ReadonlyArray<ReadonlyArray<number | null>>, u: number, v: number): number {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  if (rows === 0 || cols === 0) return 0;
  const x = Math.min(cols - 1.001, Math.max(0, u * (cols - 1)));
  const y = Math.min(rows - 1.001, Math.max(0, v * (rows - 1)));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const at = (r: number, c: number): number => {
    const value = grid[r]?.[c];
    return typeof value === 'number' ? value : Number.NaN;
  };
  const corners = [at(y0, x0), at(y0, x0 + 1), at(y0 + 1, x0), at(y0 + 1, x0 + 1)];
  const valid = corners.filter((n) => Number.isFinite(n));
  if (valid.length === 0) return 0;
  const fallback = valid.reduce((s, n) => s + n, 0) / valid.length;
  const [a, b, c, d] = corners.map((n) => (Number.isFinite(n) ? n : fallback));
  return a! * (1 - fx) * (1 - fy) + b! * fx * (1 - fy) + c! * (1 - fx) * fy + d! * fx * fy;
}

function buildTerrainMesh(grid: SiteTerrainResponse['grid'], exaggeration: number): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(SIZE_FT, SIZE_FT, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position');
  if (!positions) throw new Error('terrain geometry has no position attribute');
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const u = (x + SIZE_FT / 2) / SIZE_FT;
    // Grid row 0 is the south (street) edge; plane +Z is south after the rotation.
    const v = (z + SIZE_FT / 2) / SIZE_FT;
    const height = sampleGrid(grid, u, v) * exaggeration;
    positions.setY(i, height);
    min = Math.min(min, height);
    max = Math.max(max, height);
  }
  geometry.computeVertexNormals();
  // Hypsometric tint: low = green, high = tan. Colours are a reading aid, not data.
  const colors = new Float32Array(positions.count * 3);
  const low = new THREE.Color('#3f7a4e');
  const mid = new THREE.Color('#8aa564');
  const high = new THREE.Color('#c2a97a');
  const tmp = new THREE.Color();
  const span = Math.max(1, max - min);
  for (let i = 0; i < positions.count; i++) {
    const t = (positions.getY(i) - min) / span;
    if (t < 0.5) tmp.copy(low).lerp(mid, t * 2);
    else tmp.copy(mid).lerp(high, (t - 0.5) * 2);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function buildBuildings(
  roofs: readonly GisFeature[],
  centerLat: number,
  centerLon: number,
  grid: SiteTerrainResponse['grid'],
  exaggeration: number,
): THREE.Group {
  const group = new THREE.Group();
  const ftPerDegLon = FT_PER_DEG_LAT * Math.cos((centerLat * Math.PI) / 180);
  const material = new THREE.MeshStandardMaterial({ color: '#22d3ee', roughness: 0.7 });
  for (const roof of roofs) {
    if (roof.geometry.type !== 'Polygon') continue;
    const ring = roof.geometry.coordinates[0];
    if (!ring || ring.length < 3) continue;
    const shape = new THREE.Shape();
    let cx = 0;
    let cz = 0;
    ring.forEach(([lon, lat], i) => {
      const x = (lon! - centerLon) * ftPerDegLon;
      const z = (centerLat - lat!) * FT_PER_DEG_LAT;
      cx += x;
      cz += z;
      if (i === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    });
    cx /= ring.length;
    cz /= ring.length;
    if (Math.abs(cx) > SIZE_FT / 2 || Math.abs(cz) > SIZE_FT / 2) continue;
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: BUILDING_HEIGHT_FT, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2);
    const u = (cx + SIZE_FT / 2) / SIZE_FT;
    const v = (cz + SIZE_FT / 2) / SIZE_FT;
    const ground = sampleGrid(grid, u, v) * exaggeration;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = ground;
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

export function Terrain3D({ centerLat, centerLon, roofs }: Terrain3DProps) {
  const { api } = useApi();
  const { orgId } = useSession();
  const host = useRef<HTMLDivElement | null>(null);
  const [exaggeration, setExaggeration] = useState(2);
  // WebGL support is checked once, synchronously — a browser without it gets the plain message
  // below instead of a blank canvas.
  const [webglOk] = useState(() => {
    try {
      const canvas = document.createElement('canvas');
      return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
    } catch {
      return false;
    }
  });

  const terrain = useQuery({
    queryKey: orgKey(orgId, 'gis-terrain', centerLat.toFixed(4), centerLon.toFixed(4)),
    queryFn: () =>
      api.post(
        '/v1/site/terrain',
        { lat: centerLat, lon: centerLon, widthFt: SIZE_FT, depthFt: SIZE_FT, samples: SAMPLES },
        { schema: SiteTerrainResponseSchema },
      ),
    staleTime: 5 * 60_000,
  });

  const data = terrain.data;
  const gridReady = data && (data.status === 'found' || data.status === 'partial');

  useEffect(() => {
    const el = host.current;
    if (!el || !gridReady || !data || !webglOk) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute(
      'aria-label',
      '3D terrain with traced roof outlines standing on it. Drag to orbit, scroll or pinch to zoom.',
    );
    renderer.domElement.setAttribute('role', 'img');

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0b1526');
    const camera = new THREE.PerspectiveCamera(40, el.clientWidth / Math.max(1, el.clientHeight), 1, 40_000);
    camera.position.set(SIZE_FT * 0.7, SIZE_FT * 0.6, SIZE_FT * 0.9);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = 200;
    controls.maxDistance = SIZE_FT * 4;
    scene.add(new THREE.HemisphereLight('#dfe8ff', '#1a1d24', 1.2));
    const sun = new THREE.DirectionalLight('#ffffff', 2);
    sun.position.set(SIZE_FT * 0.5, SIZE_FT, SIZE_FT * 0.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun);

    const terrainMesh = buildTerrainMesh(data.grid, exaggeration);
    scene.add(terrainMesh);
    const buildings = buildBuildings(roofs, centerLat, centerLon, data.grid, exaggeration);
    scene.add(buildings);

    let frame = 0;
    const loop = () => {
      frame = window.requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();
    const resize = () => {
      const w = el.clientWidth;
      const h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (obj.material as THREE.Material).dispose();
        }
      });
    };
  }, [gridReady, data, exaggeration, roofs, centerLat, centerLon, webglOk]);

  if (!webglOk) {
    return (
      <div className="gis-terrain-failed" role="alert">
        <p>This browser could not start 3D graphics (WebGL). The 2D map still works.</p>
      </div>
    );
  }
  if (terrain.isPending) return <p className="web-muted">Loading USGS 3DEP terrain…</p>;
  if (terrain.isError) {
    return (
      <p className="web-muted" role="alert">
        Terrain could not be loaded. {terrain.error instanceof Error ? terrain.error.message : ''}
      </p>
    );
  }
  if (data?.status === 'upstream_unavailable') {
    return (
      <p className="web-muted" role="status">
        USGS 3DEP terrain is unavailable right now. {data.message}
      </p>
    );
  }

  return (
    <div className="gis-terrain">
      <div ref={host} className="gis-terrain-canvas" />
      <div className="gis-terrain-controls">
        <label>
          Vertical exaggeration
          <input
            type="range"
            min={1}
            max={5}
            step={0.5}
            value={exaggeration}
            onChange={(e) => setExaggeration(Number(e.target.value))}
          />
          <span>{exaggeration}×</span>
        </label>
        <p className="web-muted web-small">
          Terrain: {data?.source ?? 'USGS 3DEP'} elevation over {SIZE_FT.toLocaleString('en-US')} ×{' '}
          {SIZE_FT.toLocaleString('en-US')} ft — not a survey. Buildings are your traced roof outlines;
          the {BUILDING_HEIGHT_FT} ft height shown is visualization only, not measured.
          {data?.status === 'partial' ? ' Some elevation samples were missing and are smoothed over.' : ''}
          {data?.flood
            ? ` FEMA flood zone at centre: ${data.flood.zone}${data.flood.specialHazard ? ' (Special Flood Hazard Area)' : ''}.`
            : ''}
        </p>
      </div>
    </div>
  );
}
