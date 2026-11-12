import { describe, expect, it } from 'vitest';
import { generateLayout } from './layout';
import { houseMeshObj, makeHouseMesh } from './House3DView';
const layout = generateLayout({
  lengthFt: 40, widthFt: 30, stories: 1, bedrooms: 3, bathrooms: 2, garage: 'none',
});
describe('house 3D massing', () => {
  it('produces exportable triangle geometry with the roof', () => {
    const mesh = makeHouseMesh(layout, 9, 6);
    expect(mesh.length).toBeGreaterThan(10);
    expect(houseMeshObj(mesh)).toContain('f 1 2 3');
    expect(houseMeshObj(mesh)).toContain('v 0 15 16.5');
  });
  it('allows viewing the room floors without the roof shell', () => {
    expect(makeHouseMesh(layout, 9, 6, false).length)
      .toBeLessThan(makeHouseMesh(layout, 9, 6, true).length);
  });
});
