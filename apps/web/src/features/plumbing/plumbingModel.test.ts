import { describe, expect, it } from 'vitest';
import {
  SAMPLE_BUILDING,
  isInsideRoom,
  modelWarnings,
  pipeLength,
  projectPoint,
  validateBuildingModel,
} from './plumbingModel';

describe('user-provided building geometry', () => {
  it('validates sample model and computes measured pipe lengths in metres', () => {
    const model = validateBuildingModel(SAMPLE_BUILDING);
    expect(model.rooms).toHaveLength(2);
    expect(model.pipes).toHaveLength(3);
    expect(pipeLength(model.pipes[0]!)).toBeGreaterThan(5);
  });

  it('computes 3D diagonal length including vertical travel', () => {
    const pipe = { ...SAMPLE_BUILDING.pipes[0]!, points: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 12 }] };
    expect(pipeLength(pipe)).toBe(13);
  });

  it('rejects invalid or uncontrolled model inputs', () => {
    expect(() => validateBuildingModel({ ...SAMPLE_BUILDING, units: 'ft' })).toThrow();
    expect(() => validateBuildingModel({
      ...SAMPLE_BUILDING,
      rooms: [{ ...SAMPLE_BUILDING.rooms[0], width: -10 }],
    })).toThrow();
    expect(() => validateBuildingModel({
      ...SAMPLE_BUILDING,
      pipes: [{ ...SAMPLE_BUILDING.pipes[0], points: [{ x: Infinity, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }] }],
    })).toThrow();
    expect(() => validateBuildingModel({
      ...SAMPLE_BUILDING,
      rooms: [SAMPLE_BUILDING.rooms[0], SAMPLE_BUILDING.rooms[0]],
    })).toThrow();
  });

  it('warns on out-of-envelope routing but does not claim clash detection', () => {
    expect(isInsideRoom({ x: 1, y: 1, z: 1 }, SAMPLE_BUILDING.rooms[0]!)).toBe(true);
    const changed = {
      ...SAMPLE_BUILDING,
      pipes: [{
        ...SAMPLE_BUILDING.pipes[0]!,
        points: [{ x: 0, y: 0, z: 0 }, { x: 900, y: 900, z: 0 }],
      }],
    };
    expect(modelWarnings(changed).join(' ')).toContain('outside supplied room');
  });

  it('projects 3D coordinates reproducibly and rotates view', () => {
    expect(projectPoint({ x: 0, y: 0, z: 0 }, 37, 35)).toEqual({ x: 0, y: 0 });
    expect(projectPoint({ x: 5, y: 1, z: 2 }, 25, 40))
      .not.toEqual(projectPoint({ x: 5, y: 1, z: 2 }, 75, 40));
  });
});
