import { describe, expect, it } from 'vitest';
import {
  DECISION_CLASSES,
  decisionShares,
  normalizeZoneRect,
  zoneAcres,
  type DecisionZone,
} from './decisionClasses';

const parcel = { widthFt: 435.6, depthFt: 100 }; // exactly 1 acre

describe('decision classes', () => {
  it('defines the four classes with colours', () => {
    expect(DECISION_CLASSES.map((c) => c.id)).toEqual([
      'cultivated',
      'conservation',
      'regeneration',
      'buildable_pocket',
    ]);
    for (const c of DECISION_CLASSES) expect(c.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('normalizes a drag rectangle in any corner order and clamps it to the parcel', () => {
    expect(normalizeZoneRect({ x: 300, z: 80 }, { x: 100, z: 20 }, parcel)).toEqual({
      x0: 100,
      x1: 300,
      z0: 20,
      z1: 80,
    });
    expect(normalizeZoneRect({ x: -50, z: -50 }, { x: 900, z: 900 }, parcel)).toEqual({
      x0: 0,
      x1: 435.6,
      z0: 0,
      z1: 100,
    });
  });

  it('rejects slivers and non-finite drags', () => {
    expect(normalizeZoneRect({ x: 10, z: 10 }, { x: 15, z: 60 }, parcel)).toBeNull();
    expect(normalizeZoneRect({ x: Number.NaN, z: 0 }, { x: 50, z: 50 }, parcel)).toBeNull();
  });

  it('computes acres and per-class shares', () => {
    expect(zoneAcres({ x0: 0, x1: 435.6, z0: 0, z1: 100 })).toBeCloseTo(1, 6);
    const zones: DecisionZone[] = [
      { id: 'a', classId: 'cultivated', rect: { x0: 0, x1: 217.8, z0: 0, z1: 100 } },
      { id: 'b', classId: 'conservation', rect: { x0: 217.8, x1: 435.6, z0: 0, z1: 50 } },
    ];
    const shares = decisionShares(zones, parcel);
    const cultivated = shares.find((s) => s.classId === 'cultivated')!;
    const conservation = shares.find((s) => s.classId === 'conservation')!;
    const regeneration = shares.find((s) => s.classId === 'regeneration')!;
    expect(cultivated.acres).toBeCloseTo(0.5, 6);
    expect(cultivated.sharePct).toBeCloseTo(50, 6);
    expect(conservation.sharePct).toBeCloseTo(25, 6);
    expect(regeneration.zones).toBe(0);
    expect(regeneration.sharePct).toBe(0);
  });
});
