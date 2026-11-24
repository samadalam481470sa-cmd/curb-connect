import { describe, expect, it } from 'vitest';
import { cornerTerrain, flatTerrain } from './siteFeasibility';
import { gradingNote, slopeBands } from './slopeGrading';

describe('slopeBands', () => {
  it('puts flat ground entirely in the gentle band', () => {
    const g = slopeBands(flatTerrain(500), { widthFt: 400, depthFt: 320 }, 25);
    expect(g.sampled).toBeGreaterThan(0);
    expect(g.bands.find((b) => b.id === 'gentle')!.sharePct).toBeCloseTo(100, 0);
    expect(g.bands.find((b) => b.id === 'over_limit')!.sharePct).toBe(0);
    expect(g.reliefFt).toBe(0);
    expect(g.bands.reduce((s, b) => s + b.sharePct, 0)).toBeCloseTo(100, 6);
  });

  it('puts a steep uniform slope entirely over the building limit', () => {
    // 100 ft of fall over a 100 ft parcel, both directions: slope ~100% everywhere.
    const g = slopeBands(
      cornerTerrain(0, 100, 100, 200, 'test'),
      { widthFt: 100, depthFt: 100 },
      25,
    );
    expect(g.bands.find((b) => b.id === 'over_limit')!.sharePct).toBeCloseTo(100, 0);
    expect(g.reliefFt).toBeCloseTo(200, 0);
    expect(g.note).toMatch(/over the 25% building limit/);
  });

  it('splits a moderate slope between gentle and moderate bands', () => {
    // 10 ft of fall over 100 ft back: ~10% slope -> moderate band.
    const g = slopeBands(
      cornerTerrain(100, 100, 110, 110, 'test'),
      { widthFt: 100, depthFt: 100 },
      25,
    );
    expect(g.bands.find((b) => b.id === 'moderate')!.sharePct).toBeGreaterThan(90);
    expect(g.bands.find((b) => b.id === 'over_limit')!.sharePct).toBe(0);
  });

  it('always labels the grading note an estimate, not engineering', () => {
    expect(gradingNote([], 25)).toMatch(/estimate/);
    expect(gradingNote([], 25)).toMatch(/civil engineer must confirm/);
    const g = slopeBands(flatTerrain(500), { widthFt: 400, depthFt: 320 }, 25);
    expect(g.note).toMatch(/Mostly gentle ground/);
    expect(g.note).toMatch(/USGS 3DEP LiDAR/);
  });
});
