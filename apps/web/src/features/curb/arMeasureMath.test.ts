import { describe,it,expect } from 'vitest';
import { pathLengthFeet,pathLengthMetres } from './arMeasureMath';
describe('tracked curb polyline',()=>{
 it('measures separate true 3D segments without inventing scale',()=>{
  const points=[{x:0,y:0,z:0},{x:3,y:0,z:0},{x:3,y:4,z:0}];
  expect(pathLengthMetres(points)).toBe(7);
  expect(pathLengthFeet(points)).toBeCloseTo(22.9659,3);
 });
 it('rejects nonfinite tracking points and large jumps',()=>{
  expect(()=>pathLengthMetres([{x:0,y:0,z:0},{x:NaN,y:0,z:0}])).toThrow();
  expect(()=>pathLengthMetres([{x:0,y:0,z:0},{x:101,y:0,z:0}])).toThrow();
 });
 it('returns no length until at least two anchors exist',()=>{
  expect(pathLengthFeet([])).toBe(0);
  expect(pathLengthFeet([{x:0,y:0,z:0}])).toBe(0);
 });
});
