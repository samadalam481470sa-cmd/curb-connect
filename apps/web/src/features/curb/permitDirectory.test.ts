import { describe, expect, it } from 'vitest';
import { normalizedCity, permitLinksFor, US_STATES, VERIFIED_PERMIT_PORTALS } from './permitDirectory';

describe('city-specific permit links', () => {
  it('resolves every verified city to HTTPS application, status and municipal source links', () => {
    for (const portal of VERIFIED_PERMIT_PORTALS) {
      const result = permitLinksFor(portal.city, portal.state);
      expect(result?.verified, portal.city).toBe(true);
      expect(result?.applyUrl).toBe(portal.applyUrl);
      expect(result?.statusUrl).toBe(portal.statusUrl);
      expect(result?.sourceUrl).toBe(portal.sourceUrl);
      for (const value of [result?.applyUrl, result?.statusUrl, result?.sourceUrl]) {
        expect(new URL(value!).protocol).toBe('https:');
      }
    }
  });

  it('normalizes casing, spacing, punctuation and common Fort Worth shorthand', () => {
    expect(permitLinksFor('  DALLAS  ', 'tx')?.name).toContain('DallasNow');
    expect(permitLinksFor(' Ft. Worth ', 'TX')?.city).toBe('Fort Worth');
    expect(normalizedCity(' Fort-Worth ')).toBe('fort worth');
  });

  it('does not confuse a city in another state with a verified Texas entry', () => {
    const result = permitLinksFor('Dallas', 'OR');
    expect(result?.verified).toBe(false);
    expect(result?.sourceUrl).toBeNull();
  });

  it('provides clearly unverified, encoded search links for an unknown municipality', () => {
    const result = permitLinksFor('Somewhere & Beyond', 'NY');
    expect(result?.verified).toBe(false);
    expect(result?.name).toContain('Find');
    const q = new URL(result!.applyUrl).searchParams.get('q');
    expect(q).toContain('Somewhere & Beyond, NY');
    expect(q).toContain('curb cut permit');
    expect(new URL(result!.statusUrl).searchParams.get('q')).toContain('permit status');
    expect(result?.sourceUrl).toBeNull();
  });

  it('requires a city and a valid state before presenting external links', () => {
    expect(permitLinksFor('', 'TX')).toBeNull();
    expect(permitLinksFor('   ', 'TX')).toBeNull();
    expect(permitLinksFor('Austin', 'XX')).toBeNull();
    expect(US_STATES.some(([code]) => code === 'TX')).toBe(true);
  });

  it('keeps different Frisco apply and status entry points', () => {
    const frisco = permitLinksFor('Frisco', 'TX');
    expect(frisco?.verified).toBe(true);
    expect(frisco?.applyUrl).not.toBe(frisco?.statusUrl);
  });

  it('includes the selected county in the nationwide unverified lookup', () => {
    const lookup = permitLinksFor('Springfield', 'IL', 'Sangamon County');
    expect(lookup?.verified).toBe(false);
    expect(new URL(lookup!.applyUrl).searchParams.get('q')).toContain(
      'Springfield, Sangamon County, IL',
    );
    expect(new URL(lookup!.statusUrl).searchParams.get('q')).toContain('permit status');
  });
});
