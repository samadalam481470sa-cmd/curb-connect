// Deterministic roof editor command log (RF-023, RR-032).
//
// The editor state is a pure function of the ordered command list: state = replay(commands).
// Undo/redo move a cursor over that list, and the current state is always recomputed by replay,
// so "redraw, undo, reload, replay" yields bit-identical geometry and totals. Commands carry
// caller-generated ids, so no randomness or clock is involved.
import { GeometryError, isFiniteNumber } from './numeric';
import type { Pitch } from './pitch';
import { validatePitch } from './pitch';
import { signedArea, type Point } from './polygon';
import {
  analyzeRoof,
  edgeKey,
  type EdgeType,
  type FacetInput,
  isEdgeType,
  type RoofAnalysis,
  type TopologyOptions,
} from './topology';

export type EditorCommand =
  | { readonly type: 'add_vertex'; readonly id: string; readonly x: number; readonly y: number }
  | { readonly type: 'move_vertex'; readonly id: string; readonly x: number; readonly y: number }
  | { readonly type: 'delete_vertex'; readonly id: string }
  | {
      readonly type: 'add_facet';
      readonly id: string;
      readonly vertexIds: readonly string[];
      readonly structureId?: string;
      readonly pitch?: Pitch | null;
      readonly downslope?: Point | null;
    }
  | { readonly type: 'delete_facet'; readonly id: string }
  | {
      readonly type: 'split_facet';
      readonly id: string;
      /** Two non-adjacent vertices of the facet; the split line runs between them. */
      readonly fromVertexId: string;
      readonly toVertexId: string;
      readonly newIds: readonly [string, string];
    }
  | {
      readonly type: 'merge_facets';
      readonly ids: readonly [string, string];
      readonly newId: string;
    }
  | {
      readonly type: 'relabel_edge';
      readonly vertexIds: readonly [string, string];
      readonly edgeType: EdgeType | null;
    }
  | {
      readonly type: 'set_pitch';
      readonly facetId: string;
      readonly pitch: Pitch | null;
      readonly downslope?: Point | null;
    }
  | {
      readonly type: 'exclude_region';
      readonly facetId: string;
      readonly regionId: string;
      readonly points: readonly Point[];
    };

export interface EditorFacet {
  readonly id: string;
  readonly structureId: string;
  readonly vertexIds: readonly string[];
  readonly pitch: Pitch | null;
  readonly downslope: Point | null;
  readonly exclusions: readonly { readonly id: string; readonly points: readonly Point[] }[];
}

export interface EditorState {
  readonly vertices: ReadonlyMap<string, Point>;
  readonly facets: ReadonlyMap<string, EditorFacet>;
  readonly edgeLabels: ReadonlyMap<string, EdgeType>;
}

export const EMPTY_EDITOR_STATE: EditorState = Object.freeze({
  vertices: new Map(),
  facets: new Map(),
  edgeLabels: new Map(),
});

function fail(message: string): never {
  throw new GeometryError('invalid_command', message);
}

function facetOf(state: EditorState, id: string): EditorFacet {
  return state.facets.get(id) ?? fail(`facet ${id} does not exist`);
}

function ringPoints(state: EditorState, ids: readonly string[]): Point[] {
  return ids.map((id) => state.vertices.get(id) ?? fail(`vertex ${id} does not exist`));
}

/** Facet vertex ids in counter-clockwise order (by current coordinates). */
function ccwIds(state: EditorState, ids: readonly string[]): string[] {
  return signedArea(ringPoints(state, ids)) < 0 ? [...ids].reverse() : [...ids];
}

/** Apply one command, returning a new state. Throws GeometryError('invalid_command') on misuse. */
export function applyCommand(state: EditorState, cmd: EditorCommand): EditorState {
  const vertices = new Map(state.vertices);
  const facets = new Map(state.facets);
  const edgeLabels = new Map(state.edgeLabels);
  switch (cmd.type) {
    case 'add_vertex':
    case 'move_vertex': {
      if (!isFiniteNumber(cmd.x) || !isFiniteNumber(cmd.y))
        fail('vertex coordinates must be finite');
      const exists = vertices.has(cmd.id);
      if (cmd.type === 'add_vertex' && exists) fail(`vertex ${cmd.id} already exists`);
      if (cmd.type === 'move_vertex' && !exists) fail(`vertex ${cmd.id} does not exist`);
      vertices.set(cmd.id, { x: cmd.x, y: cmd.y });
      break;
    }
    case 'delete_vertex': {
      if (!vertices.has(cmd.id)) fail(`vertex ${cmd.id} does not exist`);
      for (const f of facets.values())
        if (f.vertexIds.includes(cmd.id)) fail(`vertex ${cmd.id} is used by facet ${f.id}`);
      vertices.delete(cmd.id);
      break;
    }
    case 'add_facet': {
      if (facets.has(cmd.id)) fail(`facet ${cmd.id} already exists`);
      if (cmd.vertexIds.length < 3) fail('a facet needs at least 3 vertices');
      if (new Set(cmd.vertexIds).size !== cmd.vertexIds.length)
        fail('facet vertices must be distinct');
      if (cmd.pitch) validatePitch(cmd.pitch);
      facets.set(cmd.id, {
        id: cmd.id,
        structureId: cmd.structureId ?? 'main',
        vertexIds: ccwIds(state, cmd.vertexIds),
        pitch: cmd.pitch ?? null,
        downslope: cmd.downslope ?? null,
        exclusions: [],
      });
      break;
    }
    case 'delete_facet': {
      facetOf(state, cmd.id);
      facets.delete(cmd.id);
      break;
    }
    case 'split_facet': {
      const f = facetOf(state, cmd.id);
      const ids = ccwIds(state, f.vertexIds);
      const i = ids.indexOf(cmd.fromVertexId);
      const j = ids.indexOf(cmd.toVertexId);
      if (i < 0 || j < 0) fail('split vertices must belong to the facet');
      const n = ids.length;
      if (i === j || (i + 1) % n === j || (j + 1) % n === i)
        fail('split vertices must not be adjacent');
      const [a, b] = cmd.newIds;
      if (a === b || facets.has(a) || facets.has(b)) fail('split needs two new unused facet ids');
      const walk = (from: number, to: number): string[] => {
        const out: string[] = [];
        for (let k = from; ; k = (k + 1) % n) {
          out.push(ids[k] as string);
          if (k === to) break;
        }
        return out;
      };
      facets.delete(cmd.id);
      // Exclusions are dropped by a split: their containment must be re-asserted per facet.
      facets.set(a, { ...f, id: a, vertexIds: walk(i, j), exclusions: [] });
      facets.set(b, { ...f, id: b, vertexIds: walk(j, i), exclusions: [] });
      break;
    }
    case 'merge_facets': {
      const [idA, idB] = cmd.ids;
      const fa = facetOf(state, idA);
      const fb = facetOf(state, idB);
      if (idA === idB) fail('cannot merge a facet with itself');
      if (facets.has(cmd.newId) && cmd.newId !== idA && cmd.newId !== idB)
        fail(`facet ${cmd.newId} already exists`);
      const ra = ccwIds(state, fa.vertexIds);
      const rb = ccwIds(state, fb.vertexIds);
      const na = ra.length;
      const nb = rb.length;
      const shared: number[] = [];
      for (let k = 0; k < na; k++) {
        const u = ra[k] as string;
        const v = ra[(k + 1) % na] as string;
        const m = rb.indexOf(v);
        if (m >= 0 && rb[(m + 1) % nb] === u) shared.push(k);
      }
      if (shared.length !== 1) fail('facets must share exactly one edge to merge');
      const k = shared[0] as number;
      const u = ra[k] as string;
      const v = ra[(k + 1) % na] as string;
      // A walked from v round to u (all of A), then B's vertices strictly between u and v.
      const merged: string[] = [];
      for (let s = 0; s < na; s++) merged.push(ra[(k + 1 + s) % na] as string);
      const mb = rb.indexOf(v); // B has v -> u at mb
      for (let s = 2; s < nb; s++) merged.push(rb[(mb + s) % nb] as string);
      facets.delete(idA);
      facets.delete(idB);
      facets.set(cmd.newId, {
        ...fa,
        id: cmd.newId,
        vertexIds: merged,
        exclusions: [...fa.exclusions, ...fb.exclusions],
      });
      edgeLabels.delete(edgeKey(u, v));
      break;
    }
    case 'relabel_edge': {
      const [a, b] = cmd.vertexIds;
      if (!vertices.has(a) || !vertices.has(b)) fail('relabel_edge needs existing vertices');
      const key = edgeKey(a, b);
      if (cmd.edgeType === null) edgeLabels.delete(key);
      else if (!isEdgeType(cmd.edgeType)) fail(`unknown edge type ${String(cmd.edgeType)}`);
      else edgeLabels.set(key, cmd.edgeType);
      break;
    }
    case 'set_pitch': {
      const f = facetOf(state, cmd.facetId);
      if (cmd.pitch) validatePitch(cmd.pitch);
      facets.set(f.id, {
        ...f,
        pitch: cmd.pitch,
        downslope: cmd.downslope === undefined ? f.downslope : cmd.downslope,
      });
      break;
    }
    case 'exclude_region': {
      const f = facetOf(state, cmd.facetId);
      if (f.exclusions.some((e) => e.id === cmd.regionId))
        fail(`region ${cmd.regionId} already exists`);
      if (cmd.points.some((p) => !isFiniteNumber(p.x) || !isFiniteNumber(p.y)))
        fail('region coordinates must be finite');
      facets.set(f.id, {
        ...f,
        exclusions: [
          ...f.exclusions,
          { id: cmd.regionId, points: cmd.points.map((p) => ({ x: p.x, y: p.y })) },
        ],
      });
      break;
    }
    default: {
      const never: never = cmd;
      fail(`unknown command ${JSON.stringify(never)}`);
    }
  }
  return { vertices, facets, edgeLabels };
}

export function replay(
  commands: readonly EditorCommand[],
  from: EditorState = EMPTY_EDITOR_STATE,
): EditorState {
  return commands.reduce(applyCommand, from);
}

/** Convert editor state into topology input (facets in id order for determinism). */
export function toRoofInput(
  state: EditorState,
  options?: TopologyOptions,
): Parameters<typeof analyzeRoof>[0] {
  const facets: FacetInput[] = [...state.facets.values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((f) => ({
      id: f.id,
      structureId: f.structureId,
      vertices: f.vertexIds.map((id) => ({
        id,
        ...(state.vertices.get(id) ?? fail(`vertex ${id} missing`)),
      })),
      pitch: f.pitch,
      downslope: f.downslope,
      exclusions: f.exclusions.map((e) => e.points),
    }));
  return {
    facets,
    edgeLabels: Object.fromEntries(state.edgeLabels),
    ...(options ? { options } : {}),
  };
}

/** Undoable command history. Immutable: every operation returns a new history. */
export interface EditorHistory {
  /** Every command ever applied on this branch; commands at index >= cursor are redoable. */
  readonly commands: readonly EditorCommand[];
  readonly cursor: number;
  readonly state: EditorState;
}

export function createHistory(commands: readonly EditorCommand[] = []): EditorHistory {
  return { commands: [...commands], cursor: commands.length, state: replay(commands) };
}

/** Apply a new command; discards the redo tail. Invalid commands throw and leave history untouched. */
export function execute(history: EditorHistory, cmd: EditorCommand): EditorHistory {
  const state = applyCommand(history.state, cmd);
  return {
    commands: [...history.commands.slice(0, history.cursor), cmd],
    cursor: history.cursor + 1,
    state,
  };
}

export function canUndo(history: EditorHistory): boolean {
  return history.cursor > 0;
}

export function canRedo(history: EditorHistory): boolean {
  return history.cursor < history.commands.length;
}

export function undo(history: EditorHistory): EditorHistory {
  if (!canUndo(history)) return history;
  const cursor = history.cursor - 1;
  return { commands: history.commands, cursor, state: replay(history.commands.slice(0, cursor)) };
}

export function redo(history: EditorHistory): EditorHistory {
  if (!canRedo(history)) return history;
  const cmd = history.commands[history.cursor] as EditorCommand;
  return {
    commands: history.commands,
    cursor: history.cursor + 1,
    state: applyCommand(history.state, cmd),
  };
}

/** The persisted form: only the applied commands (the redo tail is not saved). */
export function appliedCommands(history: EditorHistory): EditorCommand[] {
  return history.commands.slice(0, history.cursor);
}

export function analyzeEditorState(state: EditorState, options?: TopologyOptions): RoofAnalysis {
  return analyzeRoof(toRoofInput(state, options));
}
