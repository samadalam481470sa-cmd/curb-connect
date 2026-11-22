import { describe, expect, it } from 'vitest';
import {
  aggregateBuilderTakeoff,
  DEFAULT_TAKEOFF_ASSUMPTIONS,
  specFromPermitSqFt,
} from './builderTakeoff';

describe('builder takeoff', () => {
  it('derives a footprint from stated sq ft with labeled assumptions', () => {
    const { spec, notes } = specFromPermitSqFt(2400, 2, DEFAULT_TAKEOFF_ASSUMPTIONS);
    expect(spec.stories).toBe(2);
    // 2400 sq ft over 2 floors = 1200 sq ft footprint, roughly 39x31 at 5:4.
    expect(spec.lengthFt * spec.widthFt).toBeGreaterThan(1000);
    expect(spec.lengthFt * spec.widthFt).toBeLessThan(1400);
    expect(notes.join(' ')).toMatch(/assumption/i);
    const oneStory = specFromPermitSqFt(2400, null, DEFAULT_TAKEOFF_ASSUMPTIONS);
    expect(oneStory.spec.stories).toBe(1);
    expect(oneStory.notes.join(' ')).toMatch(/did not state stories/);
  });

  it('aggregates quantities across sq-ft-known permits and skips the rest', () => {
    const out = aggregateBuilderTakeoff(
      [
        { sqFt: 2400, stories: 2 },
        { sqFt: 1800, stories: null },
        { sqFt: null, stories: null },
      ],
      DEFAULT_TAKEOFF_ASSUMPTIONS,
    );
    expect(out.permitsUsed).toBe(2);
    expect(out.permitsSkipped).toBe(1);
    expect(out.totalSqFt).toBe(4200);
    expect(out.totalRoofSquares).toBeGreaterThan(0);
    expect(out.lines.length).toBeGreaterThan(5);
    expect(out.lines.every((l) => l.quantity > 0)).toBe(true);
  });

  it('reports insufficient data when no permit states square footage', () => {
    const out = aggregateBuilderTakeoff([{ sqFt: null, stories: null }], DEFAULT_TAKEOFF_ASSUMPTIONS);
    expect(out.permitsUsed).toBe(0);
    expect(out.lines).toHaveLength(0);
    expect(out.totalSqFt).toBe(0);
  });
});
