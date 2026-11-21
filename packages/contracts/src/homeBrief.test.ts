import { describe, expect, it } from 'vitest';
import { HouseBriefSpecSchema, normalizeHouseBrief, parseHouseBriefText } from './homeBrief';

const base = { lengthFt: 50, widthFt: 32, stories: 1, bedrooms: 3, bathrooms: 2, garage: 'two_car', wallHeightFt: 9, roofPitch: 6 } as const;

describe('house brief', () => {
  it('reads a plain-English brief', () => {
    const { spec } = parseHouseBriefText('4 bed 3 bath two-story, about 2,600 sq ft, 2-car garage, 9 ft walls, 8/12 roof', base);
    expect(spec).toMatchObject({ bedrooms: 4, bathrooms: 3, stories: 2, garage: 'two_car', wallHeightFt: 9, roofPitch: 8 });
    expect(spec.lengthFt * spec.widthFt * 2).toBeGreaterThan(2400);
    expect(HouseBriefSpecSchema.safeParse(spec).success).toBe(true);
  });

  it('reads stated dimensions and a ranch with no garage', () => {
    const { spec } = parseHouseBriefText('3 bedroom ranch 60 x 30, no garage', base);
    expect(spec).toMatchObject({ lengthFt: 60, widthFt: 30, stories: 1, garage: 'none', bedrooms: 3 });
  });

  it('clamps values from an AI reply to the builder limits', () => {
    const { spec, notes } = normalizeHouseBrief({ lengthFt: 400, widthFt: 10, bedrooms: 12, bathrooms: '2', stories: 3, roofPitch: 30, wallHeightFt: 12 }, base);
    expect(spec).toMatchObject({ lengthFt: 120, widthFt: 20, bedrooms: 6, bathrooms: 2, stories: 1, roofPitch: 14, wallHeightFt: 10 });
    expect(notes.length).toBeGreaterThan(0);
  });
});
