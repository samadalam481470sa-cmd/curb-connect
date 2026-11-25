import { describe, expect, it } from 'vitest';
import { snapToTakeoffSegments } from './takeoffSnap';

const strokes = [
  { from: { x: 10, y: 20 }, to: { x: 110, y: 20 } },
  { from: { x: 25, y: 40 }, to: { x: 85, y: 70 } },
];

describe('Takeoff geometry snap', () => {
  it('prefers a nearby endpoint and projects onto the interior of a drawn line', () => {
    expect(snapToTakeoffSegments({ x: 14, y: 24 }, strokes, 8)).toEqual({
      point: { x: 10, y: 20 },
      kind: 'endpoint',
    });
    expect(snapToTakeoffSegments({ x: 60, y: 26 }, strokes, 8)).toEqual({
      point: { x: 60, y: 20 },
      kind: 'line',
    });
    expect(snapToTakeoffSegments({ x: 52, y: 58 }, strokes, 8)).toEqual({
      point: { x: 53.8, y: 54.4 },
      kind: 'line',
    });
  });

  it('honors screen tolerance without projecting past a line end', () => {
    expect(snapToTakeoffSegments({ x: 10, y: 28 }, strokes, 8)?.kind).toBe('endpoint');
    expect(snapToTakeoffSegments({ x: 10, y: 28.01 }, strokes, 8)).toBeNull();
    expect(snapToTakeoffSegments({ x: 7, y: 20 }, strokes, 2)).toBeNull();
    expect(snapToTakeoffSegments({ x: 40, y: 20 }, [], 8)).toBeNull();
    expect(snapToTakeoffSegments({ x: 40, y: 23 }, strokes, -8)).toBeNull();
  });

  it('uses an eligible line when the nearby endpoint conflicts with a direction constraint', () => {
    expect(snapToTakeoffSegments({ x: 14, y: 24 }, strokes, 8, (point) => point.x >= 14)).toEqual({
      point: { x: 14, y: 20 },
      kind: 'line',
    });
  });
});
