import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PHASES } from './studioCost';
import { buildStudioScene, partitionSegments } from './studioScene';
import { floorPlanDxf } from './BlueprintPlan';
import { DEFAULT_SPEC, computeTakeoff } from './takeoff';

function check(spec = DEFAULT_SPEC) {
  const takeoff = computeTakeoff(spec);
  const scene = buildStudioScene(spec, takeoff);
  const phases = new Set(scene.parts.map((p) => p.phase));
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  let bad = 0;
  for (const part of scene.parts) {
    part.object.traverse((obj) => {
      const inst = obj as THREE.InstancedMesh;
      if (inst.isInstancedMesh) {
        for (let i = 0; i < inst.count; i += 1) {
          inst.getMatrixAt(i, m);
          v.setFromMatrixPosition(m);
          if (![v.x, v.y, v.z].every(Number.isFinite)) bad += 1;
        }
      }
    });
  }
  scene.dispose();
  return { scene, phases, bad, takeoff };
}

describe('House Studio 3D model', () => {
  it('has parts for every build phase with valid positions', () => {
    const { phases, bad, scene } = check();
    for (const p of PHASES) expect(phases.has(p.id), `phase ${p.name}`).toBe(true);
    expect(bad).toBe(0);
    expect(scene.levels.map((l) => l.label)).toContain('F.F. 0\'-0"');
  });

  it('builds a two-story house without a garage', () => {
    const { bad, scene } = check({ ...DEFAULT_SPEC, stories: 2, garage: 'none', bedrooms: 4, bathrooms: 3 });
    expect(bad).toBe(0);
    expect(scene.levels.some((l) => l.label.startsWith('Level 2'))).toBe(true);
  });

  it('finds interior partitions and writes a DXF plan', () => {
    const takeoff = computeTakeoff(DEFAULT_SPEC);
    const segs = partitionSegments(takeoff.layout.floors[0]!.rooms, takeoff.layout.footprint.lengthFt, takeoff.layout.footprint.widthFt);
    expect(segs.length).toBeGreaterThan(2);
    const dxf = floorPlanDxf(takeoff.layout, 0);
    expect(dxf.startsWith('0\nSECTION')).toBe(true);
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    expect(dxf).toContain('A-WALL');
  });
});
