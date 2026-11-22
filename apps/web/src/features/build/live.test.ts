import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../../lib/api';
import { fetchLivePrices } from './live';

describe('live material prices (HB-003)', () => {
  it('asks the signed-in API with a cleaned query', async () => {
    const get = vi.fn(async () => ({ live: true, query: '2x4 stud', offers: [] }));
    const api = { get } as unknown as ApiClient;
    const out = await fetchLivePrices(api, '  2x4   stud ', 'Dallas, TX');
    expect(out.live).toBe(true);
    expect(get).toHaveBeenCalledWith('/v1/market/material-prices', expect.objectContaining({
      query: { q: '2x4 stud', location: 'Dallas, TX' },
    }));
  });

  it('reads a failed call as not live instead of throwing', async () => {
    const api = { get: vi.fn(async () => { throw new Error('offline'); }) } as unknown as ApiClient;
    await expect(fetchLivePrices(api, 'osb')).resolves.toMatchObject({ live: false, offers: [] });
  });
});
