import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HOUSTON_REPORTS_URL,
  discoverHoustonReportFiles,
  excelSerialToIso,
  fetchHouston,
  houstonReportWeekEnd,
  normalizeHouston,
  parseHoustonWorkbook,
} from './sources';
import { assessFreshness, refreshSourceStatuses, type PermitSourceStatusRow, type SourceStatusStore } from './freshness';
import { searchTexasPermits } from './search';

const now = new Date('2026-11-23T12:00:00.000Z');
// The fixture is stored base64 (pushes through the GitHub API are UTF-8 only,
// so the raw .xlsx cannot be pushed); decode it back to workbook bytes here.
const fixture = new Uint8Array(
  Buffer.from(
    readFileSync(new URL('./fixtures/houston-week.xlsx.b64', import.meta.url), 'utf8'),
    'base64',
  ),
);

/** Two April 2026 weeks were HTML tables saved with an .xls extension. */
const HTML_WEEK = `<html><body><table>
<tr><th>Zip Code</th><th>Permit Date</th><th>Permit Type</th><th>Project No</th><th>Address</th><th>Comments</th></tr>
<tr><td>77008</td><td>2026/04/20</td><td>Building Pmt</td><td>26010001</td><td>123 HEIGHTS BLVD</td><td>NEW SINGLE FAMILY RESIDENCE</td></tr>
<tr><td>77008</td><td>2026/04/21</td><td>Demolition</td><td>26010002</td><td>456 HEIGHTS BLVD</td><td>DEMOLITION OF GARAGE</td></tr>
</table></body></html>`;

const INDEX_HTML = `<html><body><ul>
<li><a href="https://view.officeapps.live.com/op/view.aspx?src=https%3A%2F%2Fwww.houstonpermittingcenter.org%2Fsites%2Fg%2Ffiles%2Fnwywnm431%2Ffiles%2F2026-11%2FNov%252016-22.xlsx">Nov 16-22</a></li>
<li><a href="https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-11/Nov%202%20-%208.xlsx">Nov 2 - 8</a></li>
<li><a href="https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-11/Nov%209-15.xlsx">Nov 9-15</a></li>
<li><a href="https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-11/Nov%2016-22.xlsx">Nov 16-22</a></li>
<li><a href="https://hpc.hpwtech.acsitefactory.com/sites/g/files/nwywnm431/files/2026-11/Nov%2016-22.xlsx">mirror host, ignored</a></li>
</ul></body></html>`;

function stubFetch(routes: Record<string, { text?: string; bytes?: Uint8Array; ok?: boolean }>) {
  return (async (url: string) => {
    const route = routes[url];
    if (!route || route.ok === false) return { ok: false, status: 404, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
    return {
      ok: true,
      status: 200,
      text: async () => route.text ?? '',
      arrayBuffer: async () =>
        (route.bytes ?? new TextEncoder().encode(route.text ?? '')).buffer as ArrayBuffer,
    };
  }) as unknown as typeof fetch;
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

describe('Houston weekly Excel ingester', () => {
  it('parses the real weekly workbook: title rows, header, serial dates', () => {
    const rows = parseHoustonWorkbook(fixture);
    expect(rows[0]?.[0]).toBe('Web eReport');
    expect(rows[1]?.[0]).toMatch(/2026\/11\/16/);
    const header = rows.find((r) => r.some((c) => /permit date/i.test(c)));
    expect(header).toEqual(['Zip Code', 'Permit Date', 'Permit Type', 'Project No', 'Address', 'Comments']);
    // The fixture is a trimmed copy of the live Nov 16-22 file plus a duplicate and a
    // future-dated row appended for the normalizer tests below. The blank separator row
    // between the title rows and the header is dropped by the parser.
    expect(rows.length).toBe(12);
  });

  it('normalizes the real file honestly: no contractor, no value, dedupe, future guard', () => {
    const permits = normalizeHouston(parseHoustonWorkbook(fixture), now);
    // 6 real rows, minus the duplicate project number, minus the 2027-01-04 row.
    expect(permits).toHaveLength(6);
    const first = permits.find((p) => p.permitNumber === '25065444');
    expect(first).toMatchObject({
      source: 'houston',
      sourceName: 'City of Houston',
      city: 'Houston',
      zip: '77002',
      permitType: 'Building Pmt',
      status: 'Issued',
      value: 0,
      units: 0,
      contractor: '',
      contractorPhone: '',
      url: HOUSTON_REPORTS_URL,
    });
    expect(first?.issuedAt).toBe('2026-11-16T00:00:00.000Z');
    expect(first?.description).toMatch(/LIBRARY ROOF REPAIR/);
    expect(permits.some((p) => p.permitNumber === '27000001')).toBe(false);
    expect(permits.filter((p) => p.permitNumber === '25065444')).toHaveLength(1);
  });

  it('parses the HTML .xls variant the city sometimes posts', () => {
    const permits = normalizeHouston(
      parseHoustonWorkbook(new TextEncoder().encode(HTML_WEEK)),
      now,
    );
    expect(permits).toHaveLength(2);
    expect(permits[0]).toMatchObject({
      permitNumber: '26010001',
      city: 'Houston',
      zip: '77008',
      permitType: 'Building Pmt',
      issuedAt: '2026-04-20T00:00:00.000Z',
    });
    expect(permits[1]?.permitType).toBe('Demolition');
  });

  it('converts Excel serial dates and reads week-end dates from filenames', () => {
    expect(excelSerialToIso(46342)).toBe('2026-11-16T00:00:00.000Z');
    expect(excelSerialToIso(0)).toBeNull();
    expect(houstonReportWeekEnd('Nov 16-22.xlsx', 2026)?.toISOString()).toBe(
      '2026-11-22T00:00:00.000Z',
    );
    expect(houstonReportWeekEnd('Oct 26 - Nov 01.xlsx', 2026)?.toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
    expect(houstonReportWeekEnd('June 1_7.xlsx', 2026)?.toISOString()).toBe(
      '2026-06-07T00:00:00.000Z',
    );
    expect(houstonReportWeekEnd('March 30_April 05.xlsx', 2026)?.toISOString()).toBe(
      '2026-04-05T00:00:00.000Z',
    );
    expect(houstonReportWeekEnd('January 5 2026.xlsx', 2026)?.toISOString()).toBe(
      '2026-01-05T00:00:00.000Z',
    );
  });

  it('discovers the newest weekly file from the public index, ignoring viewer and mirror links', async () => {
    const files = await discoverHoustonReportFiles(stubFetch({ [HOUSTON_REPORTS_URL]: { text: INDEX_HTML } }));
    expect(files.map((f) => f.label)).toEqual(['Nov 16-22.xlsx', 'Nov 9-15.xlsx', 'Nov 2 - 8.xlsx']);
    expect(files[0]?.url).toBe(
      'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-11/Nov%2016-22.xlsx',
    );
  });

  it('fetches across weekly files and dedupes, stopping once the window is covered', async () => {
    const fetcher = stubFetch({
      [HOUSTON_REPORTS_URL]: { text: INDEX_HTML },
      'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-11/Nov%2016-22.xlsx': { bytes: fixture },
      'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-11/Nov%209-15.xlsx': { bytes: fixture },
      'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-11/Nov%202%20-%208.xlsx': { bytes: fixture },
    });
    const permits = await fetchHouston(new Date('2026-10-24T00:00:00.000Z'), now, fetcher);
    // Same fixture for every week: 6 unique permits, not 18.
    expect(permits).toHaveLength(6);
    expect(permits.every((p) => p.source === 'houston')).toBe(true);
  });

  it('treats a 10-day-old newest permit as live for the weekly file, 20 days as stale', () => {
    const live = assessFreshness('houston', '2026-11-13', now);
    expect(live.status).toBe('live');
    expect(live.message).toMatch(/Weekly Excel file/);
    const stale = assessFreshness('houston', '2026-11-03', now);
    expect(stale.status).toBe('stale');
    expect(stale.message).toMatch(/Weekly Excel file/);
  });

  it('refresh stores one Houston row and a second run updates it, never duplicates', async () => {
    const { store, rows } = mapStore();
    const fetchers = {
      houston: async () => [
        {
          source: 'houston',
          sourceName: 'City of Houston',
          permitNumber: '25065444',
          city: 'Houston',
          address: '500 MCKINNEY ST',
          zip: '77002',
          description: 'LIBRARY ROOF REPAIR',
          permitType: 'Building Pmt',
          workClass: '',
          landUse: '',
          status: 'Issued',
          issuedAt: '2026-11-16T00:00:00.000Z',
          appliedAt: null,
          value: 0,
          units: 0,
          contractor: '',
          contractorPhone: '',
          url: HOUSTON_REPORTS_URL,
        },
      ],
    };
    const first = await refreshSourceStatuses({
      fetchFn: stubFetch({}),
      fetchers: fetchers as never,
      now,
      store,
    });
    expect(first.find((r) => r.sourceId === 'houston')?.status).toBe('live');
    expect(first.find((r) => r.sourceId === 'houston')?.message).toMatch(/Weekly Excel file/);
    // One row per live source (10); the stubbed-only-Houston fetchers leave the rest unavailable.
    expect(rows.size).toBe(10);
    const second = await refreshSourceStatuses({
      fetchFn: stubFetch({}),
      fetchers: fetchers as never,
      now: new Date('2026-11-24T12:00:00.000Z'),
      store,
    });
    expect(rows.size).toBe(10);
    expect(second.find((r) => r.sourceId === 'houston')?.lastCheckedAt).toBe(
      '2026-11-24T12:00:00.000Z',
    );
  });

  it('search includes the Houston feed when Houston is selected', async () => {
    const fetcher = stubFetch({
      [HOUSTON_REPORTS_URL]: { text: INDEX_HTML },
      'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-11/Nov%2016-22.xlsx': { bytes: fixture },
      'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-11/Nov%209-15.xlsx': { bytes: fixture },
      'https://www.houstonpermittingcenter.org/sites/g/files/nwywnm431/files/2026-11/Nov%202%20-%208.xlsx': { bytes: fixture },
    });
    const result = await searchTexasPermits(
      {
        trade: 'roofing',
        projectTypes: [],
        cities: ['Houston'],
        homeCity: 'Houston',
        days: 30,
        exclude: [],
        skipPublicOwners: true,
        earlyOnly: false,
        company: 'Test Co',
        yourName: 'Sam',
        bookingLink: '',
        customFeeds: [],
      },
      { fetcher, now },
    );
    const feed = result.feeds.find((f) => f.id === 'houston');
    expect(feed?.status).toBe('ok');
    expect(feed?.count).toBe(6);
    expect(feed?.message).toMatch(/Weekly Excel file/);
    expect(result.citiesWithoutFeed).toHaveLength(0);
  });
});
