import { describe, expect, it } from 'vitest';
import {
  assessFreshness,
  computeFieldHealth,
  fetchArcGisLastEdit,
  fieldHealthNote,
  refreshSourceStatuses,
  type PermitSourceStatusRow,
  type SourceStatusStore,
} from './freshness';
import { searchTexasPermits } from './search';
import { normalizeCollin } from './sources';
import type { RawPermit } from './engine';

const now = new Date('2026-11-23T12:00:00.000Z');

function permit(overrides: Partial<RawPermit>): RawPermit {
  return {
    source: 'dallas',
    sourceName: 'City of Dallas – Building Permits',
    permitNumber: 'P-1',
    city: 'Dallas',
    address: '1 Main St',
    zip: '75201',
    description: 'New single family residence',
    permitType: 'Building',
    workClass: '',
    landUse: '',
    status: 'Issued',
    issuedAt: '2026-11-20',
    appliedAt: null,
    value: 100000,
    units: 1,
    contractor: 'Acme Builders',
    contractorPhone: '',
    url: 'https://example.invalid/p1',
    ...overrides,
  };
}

function mapStore(): { store: SourceStatusStore; rows: Map<string, PermitSourceStatusRow> } {
  const rows = new Map<string, PermitSourceStatusRow>();
  return {
    rows,
    store: {
      get: async (sourceId) => rows.get(sourceId) ?? null,
      upsert: async (row) => {
        rows.set(row.sourceId, row);
      },
    },
  };
}

/** The refresh also reads each ArcGIS service's own last-edit date; in unit tests that read is
 *  stubbed to "not published" so no test hits the network. */
const stubFetch = (async () => ({ ok: false })) as unknown as typeof fetch;

describe('permit source freshness', () => {
  it('calls a feed live when its newest permit is inside the cadence', () => {
    const f = assessFreshness('fortworth', '2026-11-23', now);
    expect(f.status).toBe('live');
    expect(f.ageDays).toBe(0);
  });

  it('calls Denton stale: newest permit 2026-01-05 is far past the 14-day window', () => {
    const f = assessFreshness('denton', '2026-01-05', now);
    expect(f.status).toBe('stale');
    expect(f.ageDays).toBeGreaterThan(300);
    expect(f.message).toMatch(/has not published newer permits/);
  });

  it('calls a feed unavailable when it returned no permits at all', () => {
    const f = assessFreshness('denton', null, now);
    expect(f.status).toBe('unavailable');
    expect(f.ageDays).toBeNull();
  });

  it('gives Dallas a longer leash than the daily feeds', () => {
    expect(assessFreshness('dallas', '2026-10-14', now).status).toBe('live');
    expect(assessFreshness('dallas', '2026-09-20', now).status).toBe('stale');
    expect(assessFreshness('fortworth', '2026-10-14', now).status).toBe('stale');
  });

  it('measures Dallas 2026 field collapse: contractor and value present on only a few percent', () => {
    const permits = Array.from({ length: 100 }, (_, i) =>
      permit({
        permitNumber: `D-${i}`,
        contractor: i < 3 ? 'Acme Builders' : '',
        value: i < 3 ? 50000 : 0,
        zip: i < 82 ? '75201' : '',
      }),
    );
    expect(computeFieldHealth(permits)).toEqual({ contractor: 0.03, value: 0.03, zip: 0.82 });
    expect(computeFieldHealth([])).toBeNull();
    const note = fieldHealthNote(
      'dallas',
      'City of Dallas – Building Permits',
      computeFieldHealth(permits),
      permits.length,
    );
    expect(note).toMatch(/almost no contractor or value in 2026/);
    expect(note).toMatch(/no contractor on file yet/);
  });

  it('does not warn when a feed names contractors normally', () => {
    const permits = Array.from({ length: 10 }, (_, i) =>
      permit({ permitNumber: `A-${i}`, source: 'austin' }),
    );
    expect(fieldHealthNote('austin', 'Austin', computeFieldHealth(permits), permits.length)).toBeNull();
  });

  it('locks in the Collin future-date guard: a year-2206 permit is dropped, never ranked', () => {
    const [kept] = normalizeCollin(
      [
        {
          permitnum: '2206-1',
          permitissueddate: '2206-08-19T00:00:00.000',
          permitissuedby: 'PLANO CITY',
          situscity: 'Plano',
          situsconcatshort: '1 Future Way',
          permittypedescr: 'New Construction',
          permitbuildername: 'Acme',
          permitvalue: 100000,
        },
        {
          permitnum: '26-2',
          permitissueddate: '2026-11-20T00:00:00.000',
          permitissuedby: 'PLANO CITY',
          situscity: 'Plano',
          situsconcatshort: '2 Present Way',
          permittypedescr: 'New Construction',
          permitbuildername: 'Acme',
          permitvalue: 100000,
        },
      ],
      now,
    );
    expect(kept?.permitNumber).toBe('26-2');
  });

  it('reads the last-edit date an ArcGIS service publishes about itself, and tolerates failure', async () => {
    const stub = (async () => ({
      ok: true,
      json: async () => ({ editingInfo: { lastEditDate: Date.parse('2026-01-06T00:00:00.000Z') } }),
    })) as unknown as typeof fetch;
    expect(await fetchArcGisLastEdit(stub, 'https://example.invalid/FeatureServer')).toBe(
      '2026-01-06T00:00:00.000Z',
    );
    const failing = (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    expect(await fetchArcGisLastEdit(failing, 'https://example.invalid/FeatureServer')).toBeNull();
  });

  it('search marks a stale feed stale instead of ok: Denton 2026-03-14 inside a 365-day window', async () => {
    const dentonPayload = {
      features: [
        {
          attributes: {
            PERMIT_NO: 'D-1',
            SITE_ADDR: '1 Oak St',
            SITE_ZIP: '76201',
            SITE_DESCRIPTION: 'New single family residence',
            PermitType: 'Building',
            STATUS: 'Issued',
            ISSUED: Date.parse('2026-03-14T00:00:00.000Z'),
            APPLIED: Date.parse('2026-01-05T00:00:00.000Z'),
            JOBVALUE: 0,
            CONTRACTOR_NAME: '',
          },
          geometry: { x: -97.13, y: 33.21 },
        },
      ],
    };
    const fetcher = (async () => ({
      ok: true,
      text: async () => JSON.stringify(dentonPayload),
    })) as unknown as typeof fetch;
    const result = await searchTexasPermits(
      {
        trade: 'grading',
        projectTypes: [],
        cities: ['Denton'],
        homeCity: 'Denton',
        days: 365,
        exclude: [],
        skipPublicOwners: true,
        earlyOnly: false,
        company: '',
        yourName: '',
        bookingLink: '',
        customFeeds: [],
      },
      { fetcher, now },
    );
    const denton = result.feeds.find((f) => f.id === 'denton')!;
    expect(denton.status).toBe('stale');
    expect(denton.freshness).toBe('stale');
    expect(denton.latest).toBe('2026-03-14T00:00:00.000Z');
    expect(denton.message).toMatch(/days old/);
  });

  it('refreshes every live source and is idempotent: a re-run updates the same rows', async () => {
    const { store, rows } = mapStore();
    const fetchers = Object.fromEntries(
      ['austin', 'dallas', 'denton', 'fortworth', 'arlington', 'sanantonio', 'collin', 'houston'].map(
        (id) => [
          id,
          async () => [permit({ source: id, issuedAt: '2026-11-22', appliedAt: null })],
        ],
      ),
    );
    const first = await refreshSourceStatuses({
      fetchFn: stubFetch,
      fetchers,
      now,
      store,
    });
    expect(first).toHaveLength(8);
    expect(rows.size).toBe(8);
    expect(rows.get('fortworth')?.status).toBe('live');

    const later = new Date('2026-11-24T12:00:00.000Z');
    const second = await refreshSourceStatuses({ fetchFn: stubFetch, fetchers, now: later, store });
    expect(second).toHaveLength(8);
    expect(rows.size).toBe(8);
    expect(rows.get('fortworth')?.lastCheckedAt).toBe('2026-11-24T12:00:00.000Z');
  });

  it('marks a failed source unavailable without wiping its last known newest permit', async () => {
    const { store, rows } = mapStore();
    const good = Object.fromEntries(
      ['austin', 'dallas', 'denton', 'fortworth', 'arlington', 'sanantonio', 'collin', 'houston'].map(
        (id) => [
          id,
          async () => [permit({ source: id, issuedAt: '2026-11-22', appliedAt: null })],
        ],
      ),
    );
    await refreshSourceStatuses({ fetchFn: stubFetch, fetchers: good, now, store });
    expect(rows.get('denton')?.newestPermitDate).toBe('2026-11-22');

    const failing = {
      ...good,
      denton: async () => {
        throw new Error('feed timed out');
      },
    };
    const second = await refreshSourceStatuses({ fetchFn: stubFetch, fetchers: failing, now, store });
    const denton = second.find((r) => r.sourceId === 'denton')!;
    expect(denton.status).toBe('unavailable');
    expect(denton.newestPermitDate).toBe('2026-11-22');
    expect(denton.message).toMatch(/could not reach this feed/);
    expect(rows.size).toBe(8);
    expect(second.filter((r) => r.status === 'live')).toHaveLength(7);
  });
});
