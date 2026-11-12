import { describe,it,expect } from 'vitest';
import { generateLayout } from './layout';
import { DEFAULT_SPEC } from './takeoff';
import { generateHouseMesh,renderTriangles } from './house3d';
describe('house preview geometry',()=>{
 it('uses exactly the entered rise/run, stories and garage footprint',()=>{
  const spec={...DEFAULT_SPEC,lengthFt:40,widthFt:30,stories:2 as const,roofPitch:6};
  const mesh=generateHouseMesh(spec,generateLayout(spec));
  expect(mesh.wallTopFt).toBe(spec.wallHeightFt*2);
  expect(mesh.ridgeHeightFt).toBe(spec.wallHeightFt*2+7.5);
  expect(mesh.extentFt[0]).toBeGreaterThan(40);
  expect(mesh.triangles.every(t=>[...t.a,...t.b,...t.c].every(Number.isFinite))).toBe(true);
 });
 it('shows rooms in cutaway, never pretends structural framing is generated',()=>{
  const mesh=generateHouseMesh(DEFAULT_SPEC,generateLayout(DEFAULT_SPEC));
  expect(renderTriangles(mesh,'exterior').every(t=>t.layer!=='rooms')).toBe(true);
  expect(renderTriangles(mesh,'cutaway').some(t=>t.layer==='rooms')).toBe(true);
  expect(mesh.schematic).toBe(true);
 });
});
