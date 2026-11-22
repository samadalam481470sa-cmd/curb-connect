import { describe, expect, it } from 'vitest';
import { runHouseCommand } from './houseCommands';
import { DEFAULT_STUDIO_COSTS } from './studioCost';
import { DEFAULT_SPEC } from './takeoff';

const run = (t: string, spec = DEFAULT_SPEC) => runHouseCommand(t, spec, DEFAULT_STUDIO_COSTS);
const specOf = (t: string, spec = DEFAULT_SPEC) => {
  const r = run(t, spec);
  if (r.kind !== 'spec') throw new Error(`no spec for ${t}`);
  return r;
};

describe('house commands (in the browser, no AI)', () => {
  it('builds a whole house from square feet', () => {
    const r = specOf('build me a 2400 sqft 4 bed 3 bath two story');
    expect(r.spec).toMatchObject({ stories: 2, bedrooms: 4, bathrooms: 3 });
    const area = r.spec.lengthFt * r.spec.widthFt * r.spec.stories;
    expect(area).toBeGreaterThan(2200);
    expect(area).toBeLessThan(2600);
    expect(r.said).toMatch(/2,400 sq ft/);
  });

  it('adds, removes and sets rooms and parts', () => {
    expect(specOf('add a bedroom').spec.bedrooms).toBe(DEFAULT_SPEC.bedrooms + 1);
    expect(specOf('remove a bathroom').spec.bathrooms).toBe(DEFAULT_SPEC.bathrooms - 1);
    expect(specOf('no garage').spec.garage).toBe('none');
    expect(specOf('roof 8/12 and 10 ft walls').spec).toMatchObject({ roofPitch: 8, wallHeightFt: 10 });
    expect(specOf('make it 60 x 34').spec).toMatchObject({ lengthFt: 60, widthFt: 34 });
    expect(specOf('studs 24').spec.studSpacingIn).toBe(24);
  });

  it('makes the house cheaper and says how much', () => {
    const r = specOf('make it cheaper');
    expect(r.said).toMatch(/Saved about \$/);
    expect(r.spec.bedrooms).toBe(DEFAULT_SPEC.bedrooms); // never takes rooms away on its own
  });

  it('passes undo and unknown text through', () => {
    expect(run('undo').kind).toBe('undo');
    expect(run('what color should the kitchen be').kind).toBe('none');
  });
});
