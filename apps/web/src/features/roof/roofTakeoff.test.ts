import { describe, expect, it } from 'vitest';
import { roofTakeoff } from './roofTakeoff';

describe('roof workspace takeoff', () => {
  it('applies the engine slope factor and waste once', () => {
    const r = roofTakeoff(
      [
        { id: 'a', name: 'Front', lengthFt: 40, runFt: 15, pitch: 6 },
        { id: 'b', name: 'Back', lengthFt: 40, runFt: 15, pitch: 6 },
      ],
      10,
    );
    expect(r.planSqFt).toBe(1200);
    expect(r.slopedSqFt).toBeCloseTo(1200 * Math.sqrt(1.25), 0);
    expect(r.squaresWithWaste).toBeCloseTo((r.slopedSqFt / 100) * 1.1, 1);
    expect(r.bundles).toBe(Math.ceil(r.squaresWithWaste * 3));
  });

  it('treats a flat facet as slope factor 1 and ignores negative input', () => {
    const r = roofTakeoff([{ id: 'a', name: 'Flat', lengthFt: -5, runFt: 10, pitch: 0 }], 0);
    expect(r.planSqFt).toBe(0);
    expect(r.facets[0]!.slopeFactor).toBe(1);
  });
});
