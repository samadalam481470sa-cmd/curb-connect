import { describe, expect, it } from 'vitest';
import { earthSearchUrl, googleSatelliteUrl, validCoordinates } from './satelliteLinks';
describe('Home aerial map links', () => {
  it('generates valid Google Maps satellite URL for a real address location', () => {
    expect(googleSatelliteUrl(32.7767, -96.797)).toContain('32.776700,-96.797000');
    expect(googleSatelliteUrl(32.7767, -96.797)).toContain('!1e3');
  });
  it('only creates links for valid geographic coordinates', () => {
    expect(validCoordinates(100, -96)).toBe(false);
    expect(() => googleSatelliteUrl(NaN, -96)).toThrow();
    expect(() => earthSearchUrl('', -91, 0)).toThrow();
  });
  it('sends an explicit property search to Google Earth', () => {
    expect(earthSearchUrl('123 Main Street, Dallas TX', 32, -96)).toContain(
      '123%20Main%20Street%2C%20Dallas%20TX');
    expect(earthSearchUrl('Dallas example', 32, -96)).toContain('32.000000%2C-96.000000');
  });
});
