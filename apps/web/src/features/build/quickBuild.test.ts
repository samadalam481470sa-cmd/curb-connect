import { describe, expect, it } from 'vitest';
import { applyAllSmart, jobsForSpec, savingBetween, savingOptions, specFromSquareFeet } from './quickBuild';
import { DEFAULT_STUDIO_COSTS } from './studioCost';
import { DEFAULT_SPEC } from './takeoff';

describe('quick build from square feet', () => {
  it('builds a house close to the asked area and lists what it assumed', () => {
    const { spec, assumed } = specFromSquareFeet({ sqft: 2000 }, DEFAULT_SPEC);
    const area = spec.lengthFt * spec.widthFt * spec.stories;
    expect(area).toBeGreaterThan(1800);
    expect(area).toBeLessThan(2200);
    expect(spec.bedrooms).toBe(4);
    expect(assumed).toContain('4 bedrooms');
  });

  it('keeps what the person said', () => {
    const { spec, assumed } = specFromSquareFeet({ sqft: 3000, stories: 2, bedrooms: 3, bathrooms: 2, garage: 'none' }, DEFAULT_SPEC);
    expect(spec).toMatchObject({ stories: 2, bedrooms: 3, bathrooms: 2, garage: 'none' });
    expect(assumed).toEqual([]);
  });

  it('turns every priced system into a job whose amounts add up to the total', () => {
    const { jobs, total } = jobsForSpec(DEFAULT_SPEC, DEFAULT_STUDIO_COSTS);
    expect(jobs.length).toBeGreaterThan(15);
    expect(jobs.reduce((s, j) => s + j.amount, 0)).toBeCloseTo(total, 0);
    expect(jobs[0]!.phase).toBe(1);
    expect(jobs.find((j) => j.system === 'roofing')?.trade).toBe('roofer');
  });
});

describe('make it cheaper', () => {
  const pricey = { ...DEFAULT_SPEC, lengthFt: 51, widthFt: 33, roofPitch: 10, wallHeightFt: 10 as const, bathrooms: 3 };

  it('prices each option with the cost model and sorts by saving', () => {
    const opts = savingOptions(pricey, DEFAULT_STUDIO_COSTS);
    expect(opts.length).toBeGreaterThan(2);
    for (let i = 1; i < opts.length; i += 1) expect(opts[i - 1]!.saving).toBeGreaterThanOrEqual(opts[i]!.saving);
    for (const o of opts) expect(savingBetween(pricey, o.spec, DEFAULT_STUDIO_COSTS).saving).toBeCloseTo(o.saving, 2);
    expect(opts.find((o) => o.id === 'pitch')?.basis).toBe('materials');
    // Snapping keeps at least the same area, so it is never a hidden 'smaller house' saving.
    expect(opts.find((o) => o.id === 'module')).toBeUndefined();
    expect(opts.find((o) => o.id === 'bath')?.kind).toBe('program');
  });

  it('applies the smart options together without cutting what the client gets', () => {
    const opts = savingOptions(pricey, DEFAULT_STUDIO_COSTS);
    const { spec, saving } = applyAllSmart(pricey, opts, DEFAULT_STUDIO_COSTS);
    expect(saving).toBeGreaterThan(0);
    expect(spec.bathrooms).toBe(3);
    expect(spec.garage).toBe(pricey.garage);
  });
});
describe('make it cheaper never just shrinks the house as a design saving', () => {
  it('keeps the floor area when snapping to a 2-ft grid', () => {
    const spec = { ...DEFAULT_SPEC, lengthFt: 45, widthFt: 27 };
    const snap = savingOptions(spec, DEFAULT_STUDIO_COSTS, {}, -1e9).find((o) => o.id === 'module');
    if (snap) expect(snap.spec.lengthFt * snap.spec.widthFt).toBeGreaterThanOrEqual(45 * 27);
    const design = savingOptions(spec, DEFAULT_STUDIO_COSTS).filter((o) => o.kind !== 'program' && o.id !== 'two-story');
    for (const o of design) expect(o.spec.lengthFt * o.spec.widthFt * o.spec.stories).toBeGreaterThanOrEqual(45 * 27 * spec.stories);
  });
});
