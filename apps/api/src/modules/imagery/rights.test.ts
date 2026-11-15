// RF-022-QA / ADD-020-QA: the rights engine decides each use independently; expiry and unknown
// rights deny everything.
import { describe, expect, it } from 'vitest';
import { esriProvider, fixtureProvider } from './providers';
import { assertUse, decide, decideAll } from './rights';

const pt = { lon: 0.01, lat: 0.01 };

describe('RF-022-API imagery rights engine', () => {
  it('visualization-only sources allow visualize and nothing else', async () => {
    const [esri] = await esriProvider.candidates(pt);
    expect(decideAll(esri!.rights).filter((d) => d.allowed).map((d) => d.use)).toEqual(['visualize']);
    expect(() => assertUse(esri!.rights, 'analyze')).toThrow(/does not allow analyze/);
  });

  it('fixture imagery is synthetic, deterministic and fully licensed', async () => {
    const [a] = await fixtureProvider.candidates(pt);
    const [b] = await fixtureProvider.candidates(pt);
    expect(a!.providerImageId).toBe(b!.providerImageId);
    expect(a!.rights.isSynthetic).toBe(true);
    expect(decideAll(a!.rights).every((d) => d.allowed)).toBe(true);
  });

  it('expired or unknown rights deny every use', async () => {
    const [a] = await fixtureProvider.candidates(pt);
    const expired = { ...a!.rights, expiresAt: '2026-01-01T00:00:00Z' };
    expect(decide(expired, 'visualize', new Date('2026-06-01'))).toEqual({ use: 'visualize', allowed: false, reason: 'license_expired' });
    expect(decide(expired, 'visualize', new Date('2025-06-01')).allowed).toBe(true);
    expect(decide(null, 'cache').reason).toBe('rights_unknown');
  });
});
