'use client';

// WebGL viewer for the House Studio model (three.js). Shows the house up to the current build
// phase, hides systems switched off in the side panel, cuts the shell away along the length, can
// explode the layers apart and orbit, and exports what is visible as GLB or OBJ for CAD tools.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PhaseId, SystemId } from './studioCost';
import { buildStudioScene, type StudioScene } from './studioScene';
import type { BuildSpec, Takeoff } from './takeoff';

export type StudioView = 'iso' | 'front' | 'side';

export interface StudioViewerHandle {
  exportGlb: () => Promise<Blob>;
  exportObj: () => Promise<Blob>;
  snapshotPng: () => string | null;
}

interface Props {
  spec: BuildSpec;
  takeoff: Takeoff;
  step: PhaseId;
  hidden: ReadonlySet<SystemId>;
  view: StudioView;
  /** 0 = no cut, 1 = most of the length cut away. */
  cutaway: number;
  explode: boolean;
  orbit: boolean;
  blueprint: boolean;
  grid: boolean;
}

export const StudioViewer = forwardRef<StudioViewerHandle, Props>(function StudioViewer(props, ref) {
  const host = useRef<HTMLDivElement | null>(null);
  const labelsRef = useRef<HTMLDivElement | null>(null);
  const state = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    sun: THREE.DirectionalLight;
    studio: StudioScene | null;
    tween: { from: THREE.Vector3; to: THREE.Vector3; target: THREE.Vector3; t: number } | null;
  } | null>(null);
  const live = useRef(props);
  live.current = props;
  const [failed, setFailed] = useState<string | null>(null);

  // Renderer, camera, lights and the render loop: once.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      setFailed('This browser could not start 3D graphics (WebGL). The plan view still works.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', '3D construction model. Drag to orbit, scroll or pinch to zoom.');
    renderer.domElement.setAttribute('role', 'img');

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#070d18');
    scene.fog = new THREE.Fog('#070d18', 260, 520);
    const camera = new THREE.PerspectiveCamera(35, el.clientWidth / Math.max(1, el.clientHeight), 0.5, 2000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = 15;
    controls.maxDistance = 500;
    controls.autoRotateSpeed = 1.1;
    scene.add(new THREE.HemisphereLight('#dfe8ff', '#1a1d24', 1.1));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    scene.add(sun);
    scene.add(sun.target);
    state.current = { renderer, scene, camera, controls, sun, studio: null, tween: null };

    const resize = () => {
      const w = el.clientWidth;
      const h = Math.max(1, el.clientHeight);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let frame = 0;
    const v = new THREE.Vector3();
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const s = state.current;
      if (!s) return;
      const p = live.current;
      const st = s.studio;
      if (st) {
        // Visibility, exploded offsets and the drop-in of a newly reached phase.
        for (const part of st.parts) {
          const visible = part.phase <= p.step && !p.hidden.has(part.system);
          const obj = part.object;
          const target = p.explode ? part.explode * 1.6 : 0;
          if (visible && !obj.visible) obj.position.y = target + (part.phase === p.step ? 6 : 0);
          obj.visible = visible;
          obj.position.y += (target - obj.position.y) * 0.14;
        }
        const [x0, x1] = st.xRange;
        st.clipPlane.constant = p.cutaway <= 0.001 ? 1e6 : -(x0 + p.cutaway * (x1 - x0) * 0.8);
        st.blueprint.visible = p.blueprint;
        st.grid.visible = p.grid;
        s.controls.autoRotate = p.orbit;
      }
      if (s.tween) {
        s.tween.t = Math.min(1, s.tween.t + 0.05);
        const e = 1 - (1 - s.tween.t) ** 3;
        s.camera.position.lerpVectors(s.tween.from, s.tween.to, e);
        s.controls.target.copy(s.tween.target);
        if (s.tween.t >= 1) s.tween = null;
      }
      s.controls.update();
      s.renderer.render(s.scene, s.camera);
      // Level tags next to the building.
      const labels = labelsRef.current;
      if (labels && st) {
        const rect = s.renderer.domElement.getBoundingClientRect();
        st.levels.forEach((lvl, i) => {
          const node = labels.children[i] as HTMLElement | undefined;
          if (!node) return;
          v.set(st.xRange[0] - 2, lvl.y, -1).project(s.camera);
          const behind = v.z > 1;
          node.style.display = behind || p.step < 6 || !node.dataset.used ? 'none' : 'block';
          // Keep the tag inside the viewer: it sits left of the wall line, but never past the edge.
          const x = Math.max(8, ((v.x + 1) / 2) * rect.width - node.offsetWidth);
          node.style.transform = `translate(${x}px, ${((1 - v.y) / 2) * rect.height}px) translate(0, -50%)`;
        });
      }
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      state.current?.studio?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      state.current = null;
    };
  }, []);

  // Rebuild the model when the house changes.
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    const old = s.studio;
    if (old) {
      s.scene.remove(old.root, old.blueprint, old.grid);
      old.dispose();
    }
    const studio = buildStudioScene(props.spec, props.takeoff);
    s.scene.add(studio.root, studio.blueprint, studio.grid);
    s.studio = studio;
    const d = studio.size;
    s.sun.position.set(studio.center.x - d * 0.6, d * 1.1, studio.center.z + d * 0.9);
    s.sun.target.position.copy(studio.center);
    const cam = s.sun.shadow.camera;
    cam.left = -d;
    cam.right = d;
    cam.top = d;
    cam.bottom = -d;
    cam.near = 1;
    cam.far = d * 4;
    cam.updateProjectionMatrix();
    if (!old) placeCamera(s, studio, live.current.view, false);
    const nodes = labelsRef.current?.children ?? [];
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i] as HTMLElement;
      node.textContent = studio.levels[i]?.label ?? '';
      node.dataset.used = studio.levels[i] ? '1' : '';
    }
  }, [props.spec, props.takeoff]);

  // Camera presets.
  useEffect(() => {
    const s = state.current;
    if (s?.studio) placeCamera(s, s.studio, props.view, true);
  }, [props.view]);

  useImperativeHandle(ref, () => ({
    async exportGlb() {
      const s = state.current;
      if (!s?.studio) throw new Error('The model is not ready yet.');
      const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
      const visible = visibleCopy(s.studio);
      const result = await new GLTFExporter().parseAsync(visible, { binary: true, onlyVisible: true });
      return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
    },
    async exportObj() {
      const s = state.current;
      if (!s?.studio) throw new Error('The model is not ready yet.');
      const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');
      const text = new OBJExporter().parse(visibleCopy(s.studio));
      return new Blob([text], { type: 'text/plain' });
    },
    snapshotPng() {
      const s = state.current;
      return s ? s.renderer.domElement.toDataURL('image/png') : null;
    },
  }));

  return (
    <div className="hs-viewer" ref={host}>
      {failed && <p className="hs-viewer-error">{failed}</p>}
      <div className="hs-levels" ref={labelsRef} aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <span key={i} className="hs-level" />
        ))}
      </div>
    </div>
  );
});

function placeCamera(
  s: { camera: THREE.PerspectiveCamera; controls: OrbitControls; tween: { from: THREE.Vector3; to: THREE.Vector3; target: THREE.Vector3; t: number } | null },
  studio: StudioScene,
  view: StudioView,
  animate: boolean,
) {
  const c = studio.center;
  // Narrow (phone) viewers see less width, so the camera backs off to keep the whole lot in frame.
  const fit = Math.max(1, 1.1 / Math.max(0.35, s.camera.aspect));
  const d = studio.size * 1.55 * fit;
  const to =
    view === 'front'
      ? new THREE.Vector3(c.x, c.y + d * 0.18, c.z + d)
      : view === 'side'
        ? new THREE.Vector3(c.x + d, c.y + d * 0.18, c.z)
        : new THREE.Vector3(c.x - d * 0.62, c.y + d * 0.62, c.z + d * 0.72);
  if (!animate) {
    s.camera.position.copy(to);
    s.controls.target.copy(c);
    s.controls.update();
    return;
  }
  s.tween = { from: s.camera.position.clone(), to, target: c.clone(), t: 0 };
}

/** A plain copy of what is on screen now (instanced meshes expanded), for exporters. */
function visibleCopy(studio: StudioScene): THREE.Group {
  const out = new THREE.Group();
  out.name = 'FieldPro_House';
  const m = new THREE.Matrix4();
  for (const part of studio.parts) {
    if (!part.object.visible) continue;
    part.object.updateMatrixWorld(true);
    part.object.traverse((obj) => {
      if ((obj as THREE.InstancedMesh).isInstancedMesh) {
        const inst = obj as THREE.InstancedMesh;
        for (let i = 0; i < inst.count; i += 1) {
          inst.getMatrixAt(i, m);
          const mesh = new THREE.Mesh(inst.geometry, inst.material);
          mesh.applyMatrix4(m.clone().premultiply(inst.matrixWorld));
          mesh.name = `${part.system}_${i}`;
          out.add(mesh);
        }
      } else if ((obj as THREE.Mesh).isMesh) {
        const mesh = (obj as THREE.Mesh).clone();
        mesh.applyMatrix4(obj.matrixWorld);
        mesh.name = part.system;
        out.add(mesh);
      }
    });
  }
  return out;
}
