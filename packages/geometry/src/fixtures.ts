// Golden fixtures shared by tests and documentation. Coordinates in FEET are converted to
// meters (canonical) by `ft()`; expected values in the tests are exact in feet.
import type { EditorCommand } from './editor';
import type { FacetInput, RoofVertex } from './topology';
import { toSI } from './units';

const ft = (v: number): number => toSI(v, 'ft');
const v = (id: string, x: number, y: number): RoofVertex => ({ id, x: ft(x), y: ft(y) });

/**
 * Six-facet L-shaped hip roof, 20 ft wide arms, footprint (0,0)-(40,0)-(40,20)-(20,20)-(20,40)-(0,40),
 * all facets 6/12. Equal-pitch straight skeleton: ridges (10,10)-(30,10) and (10,10)-(10,30), five
 * hips and one valley (each 10*sqrt(2) ft in plan, exactly 15 ft true length at 6/12).
 * Plan areas (ft2): south 300, east 100, north-of-east-arm 200, east-of-north-arm 200, north 100, west 300.
 */
export const L_HIP_VERTICES = {
  sw: v('sw', 0, 0),
  se: v('se', 40, 0),
  ne1: v('ne1', 40, 20),
  inner: v('inner', 20, 20),
  ne2: v('ne2', 20, 40),
  nw: v('nw', 0, 40),
  r0: v('r0', 10, 10),
  r1: v('r1', 30, 10),
  r2: v('r2', 10, 30),
} as const;

const V = L_HIP_VERTICES;
const p612 = { rise: 6, run: 12 };

export const L_HIP_FACETS: readonly FacetInput[] = [
  { id: 'f1-south', vertices: [V.sw, V.se, V.r1, V.r0], pitch: p612, downslope: { x: 0, y: -1 } },
  { id: 'f2-east', vertices: [V.se, V.ne1, V.r1], pitch: p612, downslope: { x: 1, y: 0 } },
  {
    id: 'f3-north-east-arm',
    vertices: [V.ne1, V.inner, V.r0, V.r1],
    pitch: p612,
    downslope: { x: 0, y: 1 },
  },
  {
    id: 'f4-east-north-arm',
    vertices: [V.inner, V.ne2, V.r2, V.r0],
    pitch: p612,
    downslope: { x: 1, y: 0 },
  },
  { id: 'f5-north', vertices: [V.ne2, V.nw, V.r2], pitch: p612, downslope: { x: 0, y: 1 } },
  { id: 'f6-west', vertices: [V.nw, V.sw, V.r0, V.r2], pitch: p612, downslope: { x: -1, y: 0 } },
];

/** The same roof expressed as editor commands (vertices first, then facets). */
export function lHipCommands(): EditorCommand[] {
  const cmds: EditorCommand[] = Object.values(V).map((p) => ({
    type: 'add_vertex',
    id: p.id,
    x: p.x,
    y: p.y,
  }));
  for (const f of L_HIP_FACETS) {
    cmds.push({
      type: 'add_facet',
      id: f.id,
      vertexIds: f.vertices.map((x) => x.id),
      pitch: f.pitch,
      downslope: f.downslope ?? null,
    });
  }
  return cmds;
}
