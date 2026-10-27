import { describe, expect, it } from 'vitest';
import { lHipCommands } from './fixtures';
import {
  analyzeEditorState,
  appliedCommands,
  applyCommand,
  canRedo,
  canUndo,
  createHistory,
  EMPTY_EDITOR_STATE,
  type EditorCommand,
  execute,
  fromSI,
  GeometryError,
  redo,
  replay,
  undo,
} from './index';

const totals = (cmds: readonly EditorCommand[]) => {
  const a = analyzeEditorState(replay(cmds));
  return {
    area: a.propertyTotal,
    edges: a.edgeTotals,
    facets: a.facets.map((f) => [f.id, f.slopedArea]),
  };
};

describe('editor command log (RF-023 G: redraw, undo, reload, identical totals)', () => {
  it('replays the six-facet fixture to the golden totals', () => {
    const a = analyzeEditorState(replay(lHipCommands()));
    expect(a.valid).toBe(true);
    expect(Math.abs(fromSI(a.propertyTotal.netPlanArea, 'ft2') - 1200)).toBeLessThan(1e-9);
    expect(a.edgeTotals.hip.count).toBe(5);
  });

  it('undo mistakes, redo, serialize, reload: bit-identical totals', () => {
    let h = createHistory();
    for (const c of lHipCommands()) h = execute(h, c);
    const golden = totals(appliedCommands(h));
    // Mistakes: drag a vertex, delete a facet, relabel an edge.
    h = execute(h, { type: 'move_vertex', id: 'r0', x: 3.5, y: 2.9 });
    h = execute(h, { type: 'delete_facet', id: 'f2-east' });
    h = execute(h, { type: 'relabel_edge', vertexIds: ['sw', 'se'], edgeType: 'rake' });
    expect(totals(appliedCommands(h))).not.toEqual(golden);
    h = undo(undo(undo(h)));
    expect(canRedo(h)).toBe(true);
    expect(analyzeEditorState(h.state).edgeTotals).toEqual(golden.edges);
    h = redo(h);
    expect(h.state.vertices.get('r0')).toEqual({ x: 3.5, y: 2.9 });
    h = undo(h);
    // Reload from persisted JSON.
    const saved = JSON.parse(JSON.stringify(appliedCommands(h))) as EditorCommand[];
    expect(totals(saved)).toEqual(golden);
    expect(totals(createHistory(saved).commands)).toEqual(golden);
    // New command discards redo tail.
    h = execute(h, { type: 'set_pitch', facetId: 'f1-south', pitch: { rise: 12, run: 12 } });
    expect(canRedo(h)).toBe(false);
    expect(undo(createHistory()).cursor).toBe(0);
    expect(redo(h)).toBe(h);
    expect(canUndo(createHistory())).toBe(false);
  });

  it('split and merge round-trip the area', () => {
    const base: EditorCommand[] = [
      { type: 'add_vertex', id: 'a', x: 0, y: 0 },
      { type: 'add_vertex', id: 'b', x: 10, y: 0 },
      { type: 'add_vertex', id: 'c', x: 10, y: 10 },
      { type: 'add_vertex', id: 'd', x: 0, y: 10 },
      { type: 'add_facet', id: 'F', vertexIds: ['a', 'd', 'c', 'b'], pitch: { rise: 0, run: 12 } },
    ];
    const s = replay([
      ...base,
      { type: 'split_facet', id: 'F', fromVertexId: 'a', toVertexId: 'c', newIds: ['F1', 'F2'] },
    ]);
    const split = analyzeEditorState(s);
    expect(split.facets.map((f) => f.planArea)).toEqual([50, 50]);
    expect(split.edges.find((e) => e.id === 'a|c')!.facetIds).toHaveLength(2);
    const merged = applyCommand(s, { type: 'merge_facets', ids: ['F1', 'F2'], newId: 'M' });
    const m = analyzeEditorState(merged);
    expect(m.facets.map((f) => [f.id, f.planArea])).toEqual([['M', 100]]);
    expect(m.edges).toHaveLength(4);
    expect(merged.facets.get('M')!.vertexIds).toHaveLength(4);
  });

  it('exclude region and delete vertex', () => {
    const s = replay([
      ...lHipCommands(),
      {
        type: 'exclude_region',
        facetId: 'f1-south',
        regionId: 'chimney',
        points: [
          { x: 3, y: 0.5 },
          { x: 4, y: 0.5 },
          { x: 4, y: 1.5 },
          { x: 3, y: 1.5 },
        ],
      },
      { type: 'add_vertex', id: 'stray', x: 99, y: 99 },
      { type: 'delete_vertex', id: 'stray' },
    ]);
    const a = analyzeEditorState(s);
    expect(a.facets.find((f) => f.id === 'f1-south')!.excludedArea).toBeCloseTo(1, 12);
    expect(s.vertices.has('stray')).toBe(false);
    const cleared = applyCommand(
      applyCommand(s, { type: 'relabel_edge', vertexIds: ['sw', 'se'], edgeType: 'rake' }),
      {
        type: 'relabel_edge',
        vertexIds: ['se', 'sw'],
        edgeType: null,
      },
    );
    expect(cleared.edgeLabels.size).toBe(0);
  });

  it('rejects invalid commands without mutating history', () => {
    const s = replay(lHipCommands());
    const bad: EditorCommand[] = [
      { type: 'add_vertex', id: 'sw', x: 0, y: 0 },
      { type: 'add_vertex', id: 'n', x: Number.NaN, y: 0 },
      { type: 'move_vertex', id: 'nope', x: 0, y: 0 },
      { type: 'delete_vertex', id: 'sw' },
      { type: 'delete_vertex', id: 'nope' },
      { type: 'add_facet', id: 'f1-south', vertexIds: ['sw', 'se', 'r0'] },
      { type: 'add_facet', id: 'new', vertexIds: ['sw', 'se'] },
      { type: 'add_facet', id: 'new', vertexIds: ['sw', 'se', 'sw'] },
      { type: 'add_facet', id: 'new', vertexIds: ['sw', 'se', 'ghost'] },
      { type: 'add_facet', id: 'new', vertexIds: ['sw', 'se', 'r0'], pitch: { rise: 1, run: 0 } },
      { type: 'delete_facet', id: 'ghost' },
      {
        type: 'split_facet',
        id: 'f1-south',
        fromVertexId: 'sw',
        toVertexId: 'se',
        newIds: ['x', 'y'],
      },
      {
        type: 'split_facet',
        id: 'f1-south',
        fromVertexId: 'sw',
        toVertexId: 'ghost',
        newIds: ['x', 'y'],
      },
      {
        type: 'split_facet',
        id: 'f1-south',
        fromVertexId: 'sw',
        toVertexId: 'r1',
        newIds: ['x', 'x'],
      },
      { type: 'merge_facets', ids: ['f1-south', 'f5-north'], newId: 'm' },
      { type: 'merge_facets', ids: ['f1-south', 'f1-south'], newId: 'm' },
      { type: 'merge_facets', ids: ['f1-south', 'f2-east'], newId: 'f3-north-east-arm' },
      { type: 'relabel_edge', vertexIds: ['sw', 'ghost'], edgeType: 'eave' },
      { type: 'relabel_edge', vertexIds: ['sw', 'se'], edgeType: 'gutter' as never },
      { type: 'set_pitch', facetId: 'ghost', pitch: null },
      { type: 'set_pitch', facetId: 'f1-south', pitch: { rise: -1, run: 12 } },
      {
        type: 'exclude_region',
        facetId: 'f1-south',
        regionId: 'r',
        points: [{ x: Number.NaN, y: 0 }],
      },
      { type: 'unknown' } as never,
    ];
    for (const c of bad) expect(() => applyCommand(s, c), JSON.stringify(c)).toThrow(GeometryError);
    const once = applyCommand(s, {
      type: 'exclude_region',
      facetId: 'f1-south',
      regionId: 'r',
      points: [],
    });
    expect(() =>
      applyCommand(once, {
        type: 'exclude_region',
        facetId: 'f1-south',
        regionId: 'r',
        points: [],
      }),
    ).toThrow(/exists/);
    let h = createHistory(lHipCommands());
    expect(() => (h = execute(h, bad[0]!))).toThrow();
    expect(h.cursor).toBe(lHipCommands().length);
    expect(EMPTY_EDITOR_STATE.facets.size).toBe(0);
  });

  it('set_pitch keeps downslope unless replaced; pitch null leaves area unresolved', () => {
    const s = applyCommand(replay(lHipCommands()), {
      type: 'set_pitch',
      facetId: 'f2-east',
      pitch: null,
    });
    expect(s.facets.get('f2-east')!.downslope).toEqual({ x: 1, y: 0 });
    expect(analyzeEditorState(s).propertyTotal.slopedArea).toBeNull();
  });
});
