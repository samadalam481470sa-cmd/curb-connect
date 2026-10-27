import { describe, expect, it } from 'vitest';
import { GEOMETRY_VERSION } from './index';

describe('@fieldline/geometry smoke', () => {
  it('exports a semantic geometry version', () => {
    expect(GEOMETRY_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
