'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { HouseLayout } from './layout';

type Vec3 = readonly [number, number, number];
interface Triangle { vertices: [Vec3, Vec3, Vec3]; rgb: [number, number, number] }

function quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, rgb: [number, number, number]): Triangle[] {
  return [{ vertices: [a, b, c], rgb }, { vertices: [a, c, d], rgb }];
}

/** A conceptual roof/wall/room mesh, not structural framing or permit-ready BIM. */
export function makeHouseMesh(
  layout: HouseLayout,
  heightFt: number,
  roofPitch: number,
  showRoof = true,
): Triangle[] {
  const L = layout.footprint.lengthFt;
  const W = layout.footprint.widthFt;
  const h = Math.max(8, Math.min(24, heightFt)) * layout.floors.length;
  const ridge = Math.max(0, Math.min(14, roofPitch)) * W / 24;
  const pale: [number, number, number] = [0.72, 0.85, 0.92];
  const darker: [number, number, number] = [0.43, 0.63, 0.78];
  const roof: [number, number, number] = [0.18, 0.32, 0.48];
  const rooms: [number, number, number][] = [
    [0.22, 0.78, 0.88], [0.42, 0.61, 0.95], [0.76, 0.55, 0.93],
    [0.27, 0.78, 0.65], [0.93, 0.72, 0.39], [0.96, 0.51, 0.52],
  ];
  const mesh: Triangle[] = [];

  // Floors and room zones remain in their own Z planes in x-ray mode.
  layout.floors.forEach((floor, index) => {
    const z = index * heightFt + 0.03;
    floor.rooms.forEach((room, roomIndex) => {
      const rgb = rooms[roomIndex % rooms.length]!;
      mesh.push(...quad(
        [room.x, room.y, z], [room.x + room.w, room.y, z],
        [room.x + room.w, room.y + room.h, z], [room.x, room.y + room.h, z],
        rgb,
      ));
    });
  });

  const c = [0, 0, 0] as const, x = [L, 0, 0] as const;
  const xy = [L, W, 0] as const, y = [0, W, 0] as const;
  const zc = [0, 0, h] as const, zx = [L, 0, h] as const;
  const zxy = [L, W, h] as const, zy = [0, W, h] as const;

  if (showRoof) {
    mesh.push(...quad(c, x, zx, zc, pale));
    mesh.push(...quad(x, xy, zxy, zx, darker));
    mesh.push(...quad(xy, y, zy, zxy, pale));
    mesh.push(...quad(y, c, zc, zy, darker));
    const a: Vec3 = [0, W / 2, h + ridge];
    const b: Vec3 = [L, W / 2, h + ridge];
    mesh.push(...quad(zc, zx, b, a, roof));
    mesh.push(...quad(a, b, zxy, zy, [0.24, 0.4, 0.57]));
  }
  return mesh;
}

function project(
  v: Vec3, lengthFt: number, widthFt: number,
  heightFt: number, yaw: number, elevation: number, zoom: number,
): Vec3 {
  const x = v[0] - lengthFt / 2;
  const y = v[1] - widthFt / 2;
  const z = v[2] - heightFt / 2;
  const a = yaw * Math.PI / 180, b = elevation * Math.PI / 180;
  const rx = x * Math.cos(a) - y * Math.sin(a);
  const ry = x * Math.sin(a) + y * Math.cos(a);
  const screenY = ry * Math.sin(b) - z * Math.cos(b);
  const depth = ry * Math.cos(b) + z * Math.sin(b);
  const scale = zoom / Math.max(lengthFt, widthFt, heightFt * 2);
  return [rx * scale, -screenY * scale, depth * scale];
}

export function houseMeshObj(mesh: readonly Triangle[]): string {
  const lines = ['# Field Pro conceptual house massing; units feet; NOT engineering drawings'];
  let vertex = 1;
  for (const tri of mesh) {
    tri.vertices.forEach((v) => lines.push(`v ${v[0]} ${v[1]} ${v[2]}`));
    lines.push(`f ${vertex} ${vertex + 1} ${vertex + 2}`);
    vertex += 3;
  }
  return lines.join('\n') + '\n';
}

const VERT = `#version 300 es
in vec3 aPosition;
in vec3 aColor;
out vec3 vColor;
void main() {
  gl_Position = vec4(aPosition.xy, aPosition.z, 1.0);
  vColor = aColor;
}`;
const FRAG = `#version 300 es
precision mediump float;
in vec3 vColor;
out vec4 outColor;
void main() { outColor = vec4(vColor, 1.0); }
`;

function shader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const compiled = gl.createShader(type);
  if (!compiled) return null;
  gl.shaderSource(compiled, source);
  gl.compileShader(compiled);
  if (!gl.getShaderParameter(compiled, gl.COMPILE_STATUS)) {
    gl.deleteShader(compiled);
    return null;
  }
  return compiled;
}

export function House3DView({
  layout,
  wallHeightFt,
  roofPitch,
}: {
  layout: HouseLayout;
  wallHeightFt: number;
  roofPitch: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [yaw, setYaw] = useState(35);
  const [elevation, setElevation] = useState(38);
  const [zoom, setZoom] = useState(1.35);
  const [showRoof, setShowRoof] = useState(true);
  const [supported, setSupported] = useState(true);
  const mesh = useMemo(() => makeHouseMesh(layout, wallHeightFt, roofPitch, showRoof),
    [layout, wallHeightFt, roofPitch, showRoof]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const gl = element.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) { setSupported(false); return; }
    const vert = shader(gl, gl.VERTEX_SHADER, VERT);
    const frag = shader(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vert || !frag) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    const buffer = gl.createBuffer();
    if (!buffer) return;
    const data: number[] = [];
    const H = layout.floors.length * wallHeightFt + (roofPitch * layout.footprint.widthFt / 24);
    for (const tri of mesh) {
      for (const v of tri.vertices) {
        const p = project(v, layout.footprint.lengthFt, layout.footprint.widthFt, H,
          yaw, elevation, zoom);
        data.push(...p, ...tri.rgb);
      }
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(element.clientWidth * dpr);
    const height = Math.round(element.clientHeight * dpr);
    if (width === 0 || height === 0) return;
    element.width = width;
    element.height = height;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0.045, 0.085, 0.15, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'aPosition');
    const color = gl.getAttribLocation(program, 'aColor');
    gl.enableVertexAttribArray(position);
    gl.enableVertexAttribArray(color);
    gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(color, 3, gl.FLOAT, false, 24, 12);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 6);
    return () => {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vert);
      gl.deleteShader(frag);
    };
  }, [mesh, layout, wallHeightFt, roofPitch, yaw, elevation, zoom]);

  const exportModel = () => {
    const data = new Blob([houseMeshObj(mesh)], { type: 'text/plain' });
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'field-pro-concept-house.obj';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-label="Interactive conceptual house massing model">
      <p className="web-muted web-small">
        Interactive WebGL2 conceptual 3D: walls, roof, and color-coded room zones.
        Hide the roof to inspect floors. Not structural CAD, construction drawings, or permit-ready BIM.
      </p>
      {supported ? (
        <canvas ref={canvas} aria-label="3D house model; use the rotation controls below"
          style={{ width: '100%', height: 360, borderRadius: 12, display: 'block', background: '#0b1626' }} />
      ) : (
        <p role="status">WebGL2 is unavailable on this device. Use the 2D floor plan instead.</p>
      )}
      <div className="cc-form-grid" style={{ marginTop: 12 }}>
        <label className="web-small">Rotate {yaw}°
          <input style={{ width: '100%' }} type="range" min={0} max={360} value={yaw}
            onChange={(event) => setYaw(Number(event.target.value))} />
        </label>
        <label className="web-small">Elevation {elevation}°
          <input style={{ width: '100%' }} type="range" min={10} max={85} value={elevation}
            onChange={(event) => setElevation(Number(event.target.value))} />
        </label>
        <label className="web-small">Zoom {zoom.toFixed(2)}×
          <input style={{ width: '100%' }} type="range" min={0.6} max={2} step={0.05}
            value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
        </label>
        <label className="web-small" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={showRoof}
            onChange={(event) => setShowRoof(event.target.checked)} />
          Show walls and roof
        </label>
      </div>
      <button type="button" className="cc-btn cc-btn--sm" onClick={exportModel}>
        Export conceptual OBJ 3D model
      </button>
    </section>
  );
}
