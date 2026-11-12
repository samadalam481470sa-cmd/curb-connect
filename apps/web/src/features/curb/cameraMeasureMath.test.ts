import { describe, expect, it } from 'vitest';
import { calibratePhotoPlane, measureCurbInPhoto } from './cameraMeasureMath';
const rect = [
  {x:.2,y:.2}, {x:.8,y:.2}, {x:.8,y:.8}, {x:.2,y:.8},
];
describe('camera measurement plane', () => {
  it('measures a known rectangle width to the entered physical inches', () => {
    const m = measureCurbInPhoto(rect,12,24,[rect[0]!,rect[1]!]);
    expect(m.lengthFt).toBeCloseTo(1,6);
    expect(m.planar).toBe(true);
  });
  it('sums multiple straight curb segments without replacing diagonal distance', () => {
    const m = measureCurbInPhoto(rect,12,12,[rect[0]!,rect[1]!,rect[2]!]);
    expect(m.segmentsFt).toHaveLength(2);
    expect(m.lengthFt).toBeCloseTo(2,6);
  });
  it('rectifies an oblique planar reference before measuring', () => {
    const trapezoid = [
      {x:.35,y:.2}, {x:.65,y:.2}, {x:.85,y:.85}, {x:.15,y:.85},
    ];
    const toWorld = calibratePhotoPlane(trapezoid,24,36);
    expect(toWorld(trapezoid[2]!).x).toBeCloseTo(2,5);
    expect(toWorld(trapezoid[2]!).y).toBeCloseTo(3,5);
    expect(measureCurbInPhoto(trapezoid,24,36,[trapezoid[0]!,trapezoid[3]!]).lengthFt).toBeCloseTo(3,5);
  });
  it('rejects crossed, collinear, missing-reference and invalid dimensions', () => {
    expect(() => calibratePhotoPlane([rect[0]!,rect[2]!,rect[1]!,rect[3]!],12,12)).toThrow();
    expect(() => calibratePhotoPlane([rect[0]!,rect[1]!,rect[2]!],12,12)).toThrow();
    expect(() => calibratePhotoPlane(rect,0,12)).toThrow();
    expect(() => measureCurbInPhoto(rect,12,12,[rect[0]!])).toThrow();
  });
  it('never reports a measurement when no physical calibration is supplied', () => {
    expect(() => measureCurbInPhoto([],12,12,rect)).toThrow();
  });
});
