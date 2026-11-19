import { describe, expect, it } from 'vitest';
import { openingPerimeterFt, rectangleRingAround, totalCutLengthFt } from './openings';
import type { MapOpening } from './types';

describe('rectangleRingAround / openingPerimeterFt', () => {
  it('builds a 4-vertex ring and perimeter ≈ 2*(w+l)', () => {
    const ring = rectangleRingAround([-75, 40], 10, 5);
    expect(ring).toHaveLength(4);
    const opening: MapOpening = {
      id: 'o1',
      number: 1,
      center: [-75, 40],
      widthFt: 10,
      lengthFt: 5,
      equipment: 'hvac',
      ring,
    };
    const peri = openingPerimeterFt(opening);
    expect(peri).toBeGreaterThan(28);
    expect(peri).toBeLessThan(32);
  });

  it('sums cut length across openings', () => {
    const openings: MapOpening[] = [
      {
        id: 'a',
        number: 1,
        center: [-75, 40],
        widthFt: 4,
        lengthFt: 4,
        equipment: 'hvac',
      },
      {
        id: 'b',
        number: 2,
        center: [-75.001, 40],
        widthFt: 3,
        lengthFt: 6,
        equipment: 'hatch',
      },
    ];
    // 2*(4+4) + 2*(3+6) = 16 + 18 = 34
    expect(totalCutLengthFt(openings)).toBeCloseTo(34, 5);
  });
});
