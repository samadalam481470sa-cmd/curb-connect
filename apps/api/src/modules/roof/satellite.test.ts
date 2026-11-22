import { describe, expect, it } from 'vitest';
import { pitchFromDegrees, sectionsFromInsights } from './satellite';

describe('satellite roof sections', () => {
  it('turns degrees into rise per 12', () => {
    expect(pitchFromDegrees(26.57)).toBe(6);
    expect(pitchFromDegrees(0)).toBe(0);
  });
  it('turns Google Solar segments into sections in square feet', () => {
    const out = sectionsFromInsights({
      roofSegments: [
        { pitchDegrees: 26.57, azimuthDegrees: 180, areaM2: 100, groundAreaM2: 89.4 },
        { pitchDegrees: 18.43, azimuthDegrees: 0, areaM2: 0.5, groundAreaM2: 0.4 },
      ],
      wholeRoofAreaM2: null,
    } as never);
    expect(out.sections).toEqual([
      { name: 'Section A', slopedSqFt: 1076, planSqFt: 962, pitch: 6, azimuthDegrees: 180 },
    ]);
    expect(out.totalSqFt).toBe(1076);
  });
});
