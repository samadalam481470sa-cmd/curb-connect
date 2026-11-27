// Read-store delta sync: first sync stores rows + watermark; later syncs merge
// server-wins, drop deleted ids, and advance the watermark. Orgs never share rows.
import { describe, expect, it } from 'vitest';
import { ORG_A, ORG_B, json, scriptedFetch } from '../../test/helpers';
import { createApiClient } from '../api';
import { ReadStore } from './readStore';
import { memoryStore } from './store';

const scopeA = { orgId: ORG_A };
const scopeB = { orgId: ORG_B };

describe('ReadStore', () => {
  it('syncs, merges server-wins, drops deleted ids, and advances the watermark', async () => {
    const store = new ReadStore(memoryStore());
    const first = scriptedFetch({
      'GET /v1/jobs': json({
        items: [
          { id: 'j1', title: 'Alpha' },
          { id: 'j2', title: 'Beta' },
        ],
        deletedIds: [],
        serverTime: '2026-11-26T10:00:00.000Z',
      }),
    });
    const api1 = createApiClient({ fetch: first.fetch });
    const merged1 = await store.sync(api1, scopeA, 'jobs', '/v1/jobs');
    expect(merged1.map((j) => j.id).sort()).toEqual(['j1', 'j2']);
    expect(await store.watermark(scopeA, 'jobs')).toBe('2026-11-26T10:00:00.000Z');

    const second = scriptedFetch({
      'GET /v1/jobs': json({
        items: [{ id: 'j2', title: 'Beta renamed' }],
        deletedIds: ['j1'],
        serverTime: '2026-11-26T11:00:00.000Z',
      }),
    });
    const api2 = createApiClient({ fetch: second.fetch });
    const merged2 = await store.sync(api2, scopeA, 'jobs', '/v1/jobs');
    expect(merged2).toEqual([{ id: 'j2', title: 'Beta renamed' }]);
    expect(await store.watermark(scopeA, 'jobs')).toBe('2026-11-26T11:00:00.000Z');
    // The second request carried the first watermark.
    expect(second.calls[0]?.url).toContain('updatedSince=2026-11-26T10%3A00%3A00.000Z');
  });

  it('keeps orgs separate and serves cached rows offline', async () => {
    const store = new ReadStore(memoryStore());
    const { fetch } = scriptedFetch({
      'GET /v1/jobs': json({
        items: [{ id: 'j1', title: 'Alpha' }],
        deletedIds: [],
        serverTime: '2026-11-26T10:00:00.000Z',
      }),
    });
    const api = createApiClient({ fetch });
    await store.sync(api, scopeA, 'jobs', '/v1/jobs');
    expect(await store.read(scopeA, 'jobs')).toEqual([{ id: 'j1', title: 'Alpha' }]);
    expect(await store.read(scopeB, 'jobs')).toEqual([]);
    await store.clearOrg(ORG_A);
    expect(await store.read(scopeA, 'jobs')).toEqual([]);
  });
});
