import { describe, expect, it } from 'vitest';
import { computeTakeoffLength, snapTakeoffDirection } from './enterpriseTakeoffLength';

const sheet = { widthPoints: 100, heightPoints: 100 };

describe('Takeoff polylines', () => {
  it('adds each segment before applying the calibrated factor', () => {
    expect(
      computeTakeoffLength(
        [
          { x: 5, y: 5 },
          { x: 8, y: 9 },
          { x: 16, y: 9 },
        ],
        2,
        sheet,
      ),
    ).toEqual({ drawingLength: 13, length: 26 });
  });

  it('snaps directions to 45-degree increments within the drawing boundary', () => {
    const start = { x: 20, y: 30 };
    const diagonal = snapTakeoffDirection(start, { x: 55, y: 60 }, sheet);
    expect(diagonal.x - start.x).toBeCloseTo(diagonal.y - start.y);
    const horizontal = snapTakeoffDirection({ x: 95, y: 60 }, { x: 100, y: 62 }, sheet);
    expect(horizontal).toEqual({ x: 100, y: 60 });
  });
});
