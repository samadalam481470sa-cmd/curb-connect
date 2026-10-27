import { describe, expect, it } from 'vitest';
import { L_HIP_FACETS, L_HIP_VERTICES as V } from './fixtures';
import {
  analyzeRoof,
  edgeKey,
  fromSI,
  type FacetInput,
  GeometryError,
  type RoofVertex,
} from './index';

const ft = (m: number): number => fromSI(m, 'ft');
const ft2 = (m2: number): number => fromSI(m2, 'ft2');
const near = (a: number, b: number, eps = 1e-9): void => expect(Math.abs(a - b)).toBeLessThan(eps);
const SF = Math.sqrt(1.25);

describe('six-facet L hip roof golden fixture (RF-025, RF-028 G)', () => {
  const r = analyzeRoof({ facets: L_HIP_FACETS });

  it('is valid with no issues', () => {
    expect(r.issues).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.nodes).toHaveLength(9);
  });

  it('exact facet plan and sloped areas', () => {
    const expected: Record<string, number> = {
      'f1-south': 300,
      'f2-east': 100,
      'f3-north-east-arm': 200,
      'f4-east-north-arm': 200,
      'f5-north': 100,
      'f6-west': 300,
    };
    for (const f of r.facets) {
      near(ft2(f.planArea), expected[f.id]!);
      near(ft2(f.slopedArea!), expected[f.id]! * SF);
    }
    near(ft2(r.propertyTotal.netPlanArea), 1200);
    near(ft2(r.propertyTotal.slopedArea!), 1200 * SF);
  });

  it('stores each physical edge once with adjacent facets', () => {
    // 6 eaves + 2 ridges + 5 hips + 1 valley = 14 edges.
    expect(r.edges).toHaveLength(14);
    const ridge = r.edges.find((e) => e.id === edgeKey('r0', 'r1'))!;
    expect(ridge.facetIds).toEqual(['f1-south', 'f3-north-east-arm']);
    expect(new Set(r.edges.map((e) => e.id)).size).toBe(14);
  });

  it('classifies and totals every edge type without double counting', () => {
    const t = r.edgeTotals;
    expect(t.eave.count).toBe(6);
    near(ft(t.eave.planLength), 160);
    near(ft(t.eave.trueLength!), 160);
    expect(t.ridge.count).toBe(2);
    near(ft(t.ridge.planLength), 40);
    near(ft(t.ridge.trueLength!), 40);
    expect(t.hip.count).toBe(5);
    near(ft(t.hip.planLength), 50 * Math.SQRT2);
    near(ft(t.hip.trueLength!), 75);
    expect(t.valley.count).toBe(1);
    near(ft(t.valley.trueLength!), 15);
    expect(
      t.rake.count +
        t.flashing.count +
        t.unclassified.count +
        t.perimeter.count +
        t.step_flashing.count,
    ).toBe(0);
    const valley = r.edges.find((e) => e.type === 'valley')!;
    expect(valley.id).toBe(edgeKey('inner', 'r0'));
  });

  it('is independent of input winding and facet order', () => {
    const reversed = analyzeRoof({
      facets: [...L_HIP_FACETS]
        .reverse()
        .map((f) => ({ ...f, vertices: [...f.vertices].reverse() })),
    });
    expect(reversed.edgeTotals).toEqual(r.edgeTotals);
    near(reversed.propertyTotal.slopedArea!, r.propertyTotal.slopedArea!);
  });
});

const box = (
  id: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  pfx = id,
): RoofVertex[] => [
  { id: `${pfx}a`, x: x0, y: y0 },
  { id: `${pfx}b`, x: x1, y: y0 },
  { id: `${pfx}c`, x: x1, y: y1 },
  { id: `${pfx}d`, x: x0, y: y1 },
];

describe('gable, shed and flat cases', () => {
  // Gable: two 10x5 m facets meeting at ridge y=5, pitch 12/12.
  const shared = { s0: { id: 's0', x: 0, y: 5 }, s1: { id: 's1', x: 10, y: 5 } };
  const south: FacetInput = {
    id: 'S',
    vertices: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 0 }, shared.s1, shared.s0],
    pitch: { rise: 12, run: 12 },
    downslope: { x: 0, y: -2 },
  };
  const north: FacetInput = {
    id: 'N',
    vertices: [shared.s0, shared.s1, { id: 'c', x: 10, y: 10 }, { id: 'd', x: 0, y: 10 }],
    pitch: { rise: 12, run: 12 },
    downslope: { x: 0, y: 1 },
  };
  it('gable: eaves, rakes with slope factor, ridge', () => {
    const r = analyzeRoof({ facets: [south, north] });
    expect(r.valid).toBe(true);
    expect(r.edgeTotals.eave.count).toBe(2);
    expect(r.edgeTotals.rake.count).toBe(4);
    near(r.edgeTotals.rake.trueLength!, 4 * 5 * Math.SQRT2);
    expect(r.edgeTotals.ridge.count).toBe(1);
    near(r.propertyTotal.slopedArea!, 100 * Math.SQRT2);
  });
  it('mixed pitch: per-facet slope factors, not a predominant pitch (RF-027 B)', () => {
    const r = analyzeRoof({ facets: [south, { ...north, pitch: { rise: 6, run: 12 } }] });
    near(r.facets[0]!.slopedArea!, 50 * Math.SQRT2);
    near(r.facets[1]!.slopedArea!, 50 * SF);
    near(r.propertyTotal.slopedArea!, 50 * Math.SQRT2 + 50 * SF);
    expect(r.edgeTotals.ridge.count).toBe(1);
  });
  it('shed against a wall: high edge is flashing', () => {
    const r = analyzeRoof({
      facets: [
        {
          id: 'shed',
          vertices: box('shed', 0, 0, 4, 3),
          pitch: { rise: 3, run: 12 },
          downslope: { x: 0, y: -1 },
        },
      ],
    });
    expect(r.edgeTotals.eave.count).toBe(1);
    expect(r.edgeTotals.flashing.count).toBe(1);
    expect(r.edgeTotals.rake.count).toBe(2);
  });
  it('flat roof: perimeter only, 0/12 sloped = plan', () => {
    const r = analyzeRoof({
      facets: [{ id: 'flat', vertices: box('f', 0, 0, 10, 10), pitch: { rise: 0, run: 12 } }],
    });
    expect(r.edgeTotals.perimeter.count).toBe(4);
    near(r.edgeTotals.perimeter.trueLength!, 40);
    expect(r.propertyTotal.slopedArea).toBe(100);
  });
  it('step between two planes and oblique boundary', () => {
    // Two facets both falling south, sharing a north-south edge: one rises into the other side? Use opposite cross-slopes.
    const left: FacetInput = {
      id: 'L',
      vertices: box('L', 0, 0, 5, 5),
      pitch: { rise: 6, run: 12 },
      downslope: { x: 1, y: 0 },
    };
    const right: FacetInput = {
      id: 'R',
      vertices: [
        { id: 'Lb', x: 5, y: 0 },
        { id: 'r1', x: 10, y: 0 },
        { id: 'r2', x: 10, y: 5 },
        { id: 'Lc', x: 5, y: 5 },
      ],
      pitch: { rise: 6, run: 12 },
      downslope: { x: 1, y: 0 },
    };
    const r = analyzeRoof({ facets: [left, right] });
    expect(r.edges.find((e) => e.id === edgeKey('Lb', 'Lc'))!.type).toBe('flashing');
    const tri: FacetInput = {
      id: 'T',
      vertices: [
        { id: 't1', x: 0, y: 0 },
        { id: 't2', x: 4, y: 0 },
        { id: 't3', x: 0, y: 4 },
      ],
      pitch: { rise: 6, run: 12 },
      downslope: { x: 0, y: -1 },
    };
    const rt = analyzeRoof({ facets: [tri] });
    expect(rt.edges.find((e) => e.id === edgeKey('t2', 't3'))!.derivedReason).toBe(
      'oblique_boundary',
    );
  });
});

describe('labels and conflicts (RF-028 S)', () => {
  it('relabel overrides derived type and moves totals', () => {
    const r = analyzeRoof({
      facets: L_HIP_FACETS,
      edgeLabels: { [edgeKey('sw', 'se')]: 'flashing' },
    });
    expect(r.edgeTotals.eave.count).toBe(5);
    expect(r.edgeTotals.flashing.count).toBe(1);
    expect(r.valid).toBe(true);
  });
  it('ridge between non-sloping facets is a conflict', () => {
    const a: FacetInput = { id: 'A', vertices: box('A', 0, 0, 5, 5), pitch: { rise: 0, run: 12 } };
    const b: FacetInput = {
      id: 'B',
      vertices: [
        { id: 'Ab', x: 5, y: 0 },
        { id: 'b1', x: 10, y: 0 },
        { id: 'b2', x: 10, y: 5 },
        { id: 'Ac', x: 5, y: 5 },
      ],
      pitch: { rise: 0, run: 12 },
    };
    const r = analyzeRoof({ facets: [a, b], edgeLabels: { 'Ab|Ac': 'ridge' } });
    expect(r.valid).toBe(false);
    expect(r.issues.find((i) => i.code === 'label_conflict')!.message).toMatch(/non-sloping/);
    expect(r.edges.find((e) => e.id === 'Ab|Ac')!.derivedReason).toBe('seam_between_flat_facets');
  });
  it('geometry contradiction, boundary misuse and unknown labels', () => {
    const r = analyzeRoof({
      facets: L_HIP_FACETS,
      edgeLabels: {
        [edgeKey('r0', 'r1')]: 'valley',
        [edgeKey('sw', 'se')]: 'ridge',
        [edgeKey('inner', 'r0')]: 'eave',
        'zz|yy': 'hip',
      },
    });
    const conflicts = r.issues.filter((i) => i.code === 'label_conflict').map((i) => i.message);
    expect(conflicts).toHaveLength(3);
    expect(conflicts.join()).toMatch(/geometry says ridge/);
    expect(conflicts.join()).toMatch(/must join two facets/);
    expect(conflicts.join()).toMatch(/cannot be an interior edge/);
    expect(r.issues.some((i) => i.code === 'unknown_edge_label')).toBe(true);
  });
});

describe('snapping, structures and validation', () => {
  it('snaps near vertices with different ids into shared edges', () => {
    const a: FacetInput = { id: 'A', vertices: box('A', 0, 0, 5, 5), pitch: { rise: 0, run: 12 } };
    const b: FacetInput = {
      id: 'B',
      vertices: [
        { id: 'q1', x: 5.004, y: 0 },
        { id: 'q2', x: 10, y: 0 },
        { id: 'q3', x: 10, y: 5 },
        { id: 'q4', x: 5, y: 5.003 },
      ],
      pitch: { rise: 0, run: 12 },
    };
    const r = analyzeRoof({ facets: [a, b] });
    expect(r.nodes.find((n) => n.id === 'Ab')!.vertexIds).toEqual(['Ab', 'q1']);
    expect(r.edges.filter((e) => e.facetIds.length === 2)).toHaveLength(1);
    const noSnap = analyzeRoof({ facets: [a, b], options: { snapTolerance: 0.001 } });
    expect(noSnap.edges.filter((e) => e.facetIds.length === 2)).toHaveLength(0);
    expect(() => analyzeRoof({ facets: [a], options: { snapTolerance: -1 } })).toThrow(
      GeometryError,
    );
  });
  it('subtotals structures and excludes from property total', () => {
    const house: FacetInput = {
      id: 'H',
      structureId: 'house',
      vertices: box('H', 0, 0, 10, 10),
      pitch: { rise: 0, run: 12 },
    };
    const shed: FacetInput = {
      id: 'S',
      structureId: 'shed',
      vertices: box('S', 20, 0, 23, 2),
      pitch: null,
    };
    const r = analyzeRoof({ facets: [house, shed], excludedStructureIds: ['shed'] });
    expect(r.structureTotals.house!.netPlanArea).toBe(100);
    expect(r.structureTotals.shed!.slopedArea).toBeNull();
    expect(r.propertyTotal.slopedArea).toBe(100);
    expect(r.issues.map((i) => i.code)).toEqual(['unknown_pitch']);
    const all = analyzeRoof({ facets: [house, shed] });
    expect(all.propertyTotal.slopedArea).toBeNull();
    expect(all.edgeTotals.unclassified.trueLength).toBeNull();
  });
  it('exclusions subtract from area; invalid exclusions are errors', () => {
    const f: FacetInput = {
      id: 'F',
      vertices: box('F', 0, 0, 10, 10),
      pitch: { rise: 12, run: 12 },
      downslope: { x: 0, y: -1 },
      exclusions: [box('x', 2, 2, 4, 4), box('y', 9, 9, 12, 12)],
    };
    const r = analyzeRoof({ facets: [f] });
    expect(r.facets[0]!.excludedArea).toBe(4);
    near(r.facets[0]!.slopedArea!, 96 * Math.SQRT2);
    expect(r.issues.map((i) => i.code)).toEqual(['invalid_exclusion']);
  });
  it('flags duplicate, overlapping, invalid, t-junction, non-manifold and missing direction', () => {
    const a: FacetInput = {
      id: 'A',
      vertices: box('A', 0, 0, 10, 10),
      pitch: { rise: 0, run: 12 },
    };
    expect(analyzeRoof({ facets: [a, { ...a, id: 'A2' }] }).issues.map((i) => i.code)).toContain(
      'duplicate_facet',
    );
    expect(analyzeRoof({ facets: [a, a] }).issues.map((i) => i.code)).toContain(
      'duplicate_facet_id',
    );
    const over: FacetInput = {
      id: 'O',
      vertices: box('O', 5, 5, 15, 15),
      pitch: { rise: 0, run: 12 },
    };
    expect(analyzeRoof({ facets: [a, over] }).issues.map((i) => i.code)).toContain(
      'overlapping_facets',
    );
    const bow: FacetInput = {
      id: 'X',
      vertices: [
        { id: 'x1', x: 0, y: 0 },
        { id: 'x2', x: 1, y: 1 },
        { id: 'x3', x: 1, y: 0 },
        { id: 'x4', x: 0, y: 1 },
      ],
      pitch: null,
    };
    const bad = analyzeRoof({ facets: [bow] });
    expect(bad.valid).toBe(false);
    expect(bad.facets[0]!.planArea).toBe(0);
    const t: FacetInput = {
      id: 'T',
      vertices: [
        { id: 'Ab', x: 10, y: 0 },
        { id: 't1', x: 20, y: 0 },
        { id: 't2', x: 20, y: 5 },
        { id: 'mid', x: 10, y: 5 },
      ],
      pitch: { rise: 0, run: 12 },
    };
    expect(analyzeRoof({ facets: [a, t] }).issues.map((i) => i.code)).toContain('t_junction');
    const third: FacetInput = {
      id: 'Z',
      vertices: [
        { id: 'Ab', x: 10, y: 0 },
        { id: 'Ac', x: 10, y: 10 },
        { id: 'z', x: 5, y: -20 },
      ],
      pitch: { rise: 0, run: 12 },
    };
    const b: FacetInput = {
      id: 'B',
      vertices: [
        { id: 'Ab', x: 10, y: 0 },
        { id: 'b1', x: 20, y: 0 },
        { id: 'b2', x: 20, y: 10 },
        { id: 'Ac', x: 10, y: 10 },
      ],
      pitch: { rise: 0, run: 12 },
    };
    expect(analyzeRoof({ facets: [a, b, third] }).issues.map((i) => i.code)).toContain(
      'non_manifold_edge',
    );
    const nodir = analyzeRoof({ facets: [{ ...a, pitch: { rise: 6, run: 12 } }] });
    expect(nodir.issues.map((i) => i.code)).toEqual(['missing_downslope']);
    expect(nodir.edgeTotals.unclassified.count).toBe(4);
    expect(nodir.edgeTotals.unclassified.trueLength).toBeNull();
  });
  it('collapsed vertices and plane disagreement warnings', () => {
    const f: FacetInput = {
      id: 'C',
      vertices: [
        { id: 'c1', x: 0, y: 0 },
        { id: 'c1b', x: 0.001, y: 0 },
        { id: 'c2', x: 5, y: 0 },
        { id: 'c3', x: 5, y: 5 },
      ],
      pitch: { rise: 0, run: 12 },
    };
    expect(analyzeRoof({ facets: [f] }).issues.map((i) => i.code)).toEqual(['collapsed_vertex']);
    const a: FacetInput = {
      id: 'A',
      vertices: box('A', 0, 0, 5, 5),
      pitch: { rise: 6, run: 12 },
      downslope: { x: 0, y: -1 },
    };
    const b: FacetInput = {
      id: 'B',
      vertices: [
        { id: 'Ab', x: 5, y: 0 },
        { id: 'b1', x: 10, y: 0 },
        { id: 'b2', x: 10, y: 5 },
        { id: 'Ac', x: 5, y: 5 },
      ],
      pitch: { rise: 12, run: 12 },
      downslope: { x: 0, y: -1 },
    };
    expect(analyzeRoof({ facets: [a, b] }).issues.map((i) => i.code)).toContain(
      'edge_length_mismatch',
    );
  });
});

it('keeps vertex lookups consistent for the fixture', () => {
  expect(V.r0.id).toBe('r0');
});
