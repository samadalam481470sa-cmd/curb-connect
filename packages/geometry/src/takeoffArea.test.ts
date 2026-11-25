import { describe, expect, it } from 'vitest';
import { computeTakeoffArea } from './takeoffArea';

const sheet = { widthPoints: 600, heightPoints: 600 };
const box = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

describe('Takeoff areas and deductions', () => {
  it('returns a 114 sq ft net area and separate boundary lengths', () => {
    expect(computeTakeoffArea(box(10, 20, 100, 120), [box(30, 40, 20, 30)], 0.1, sheet)).toEqual({
      exteriorArea: 120,
      deductedArea: 6,
      netArea: 114,
      exteriorPerimeter: 44,
      deductionPerimeter: 10,
    });
  });

  it('rejects self-crossing outlines, outside and touching deductions, and nested deductions', () => {
    const exterior = box(10, 20, 100, 120);
    const [a, b, c, d] = exterior;
    if (!a || !b || !c || !d) throw new Error('Invalid rectangle fixture.');
    expect(() => computeTakeoffArea([a, c, b, d], [], 0.1, sheet)).toThrow(/simple, closed/);
    expect(() => computeTakeoffArea(exterior, [box(90, 65, 40, 30)], 0.1, sheet)).toThrow(
      /strictly inside/,
    );
    expect(() => computeTakeoffArea(exterior, [box(10, 65, 40, 30)], 0.1, sheet)).toThrow(
      /strictly inside/,
    );
    expect(() =>
      computeTakeoffArea(exterior, [box(20, 35, 70, 70), box(30, 40, 20, 30)], 0.1, sheet),
    ).toThrow(/separate/);
  });

  it('rejects a deduction whose edge crosses a concave outline even when its vertices are inside', () => {
    const exterior = [
      { x: 10, y: 10 },
      { x: 100, y: 10 },
      { x: 100, y: 100 },
      { x: 70, y: 100 },
      { x: 70, y: 40 },
      { x: 40, y: 40 },
      { x: 40, y: 100 },
      { x: 10, y: 100 },
    ];
    expect(() =>
      computeTakeoffArea(
        exterior,
        [
          [
            { x: 20, y: 80 },
            { x: 90, y: 80 },
            { x: 55, y: 20 },
          ],
        ],
        0.1,
        sheet,
      ),
    ).toThrow(/strictly inside/);
  });
});
