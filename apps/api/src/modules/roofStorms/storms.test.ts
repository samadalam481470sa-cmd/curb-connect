// Hail feed unit tests. The live NOAA feed is never hit here — every fetch is mocked.
import { describe, expect, it, afterEach } from 'vitest';
import {
  averageJobValueMinor,
  buildStormDraft,
  clearHailCache,
  fetchHailEvents,
  getCachedHailEvents,
  haversineMiles,
  parseSpcReports,
  refreshHailEvents,
  type HailEvent,
} from './storms';

// Real shape, copied from the live 261122_rpts.csv file (verified 2026-11-24): two
// 1.00" hail rows in Arkansas, plus tornado/wind sections that must be ignored.
const SPC_SAMPLE = [
  'Time,F_Scale,Location,County,State,Lat,Lon,Comments',
  '2117,UNK,1 W Prattsville,ARC053,AR,34.32,-92.56,Dispatch reports relayed to media of large trees down. (LZK)',
  'Time,Speed,Location,County,State,Lat,Lon,Comments',
  '0800,58,2 N Yukon,Canadian,OK,35.53,-97.74,(OUN)',
  'Time,Size,Location,County,State,Lat,Lon,Comments',
  '2105,100,Poyen,ARC053,AR,34.32,-92.64,Quarter size hail report from mPing near Poyen. (LZK)',
  '2257,100,1 NE Warren,ARC011,AR,33.62,-92.06,Media report of a quarter sized hail near Warren. (LZK)',
  '',
].join('\n');

const FILE_DATE = new Date(Date.UTC(2026, 10, 22));

afterEach(() => clearHailCache());

function mockFetch(csvByUrl: Map<string, string>, failUrls: Set<string> = new Set()) {
  return (async (url: string) => {
    if (failUrls.has(url)) throw new Error('network down');
    const csv = csvByUrl.get(url);
    if (csv === undefined) return new Response('Not Found', { status: 404 });
    return new Response(csv, { status: 200, headers: { 'content-type': 'text/csv' } });
  }) as unknown as typeof fetch;
}

describe('parseSpcReports', () => {
  it('keeps only the hail section and converts hundredths of an inch', () => {
    const events = parseSpcReports(SPC_SAMPLE, FILE_DATE);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      magnitudeIn: 1,
      location: 'Poyen',
      county: 'ARC053',
      state: 'AR',
      lat: 34.32,
      lon: -92.64,
      date: '2026-11-22',
      timeUtc: '21:05',
      source: 'NOAA Storm Prediction Center',
    });
    expect(events[1]).toMatchObject({ location: '1 NE Warren', magnitudeIn: 1 });
  });

  it('returns no events for a headers-only file (a quiet storm day)', () => {
    const csv = [
      'Time,F_Scale,Location,County,State,Lat,Lon,Comments',
      'Time,Speed,Location,County,State,Lat,Lon,Comments',
      'Time,Size,Location,County,State,Lat,Lon,Comments',
      '',
    ].join('\n');
    expect(parseSpcReports(csv, FILE_DATE)).toEqual([]);
  });

  it('assigns pre-noon reports to the next calendar day (SPC convective day)', () => {
    const csv = [
      'Time,Size,Location,County,State,Lat,Lon,Comments',
      '0745,175,Test Town,Test,OK,35.50,-97.90,1.75 inch hail.',
      '',
    ].join('\n');
    const [event] = parseSpcReports(csv, FILE_DATE);
    expect(event?.date).toBe('2026-11-23');
    expect(event?.magnitudeIn).toBe(1.75);
  });

  it('drops rows with a non-numeric size or coordinates instead of inventing values', () => {
    const csv = [
      'Time,Size,Location,County,State,Lat,Lon,Comments',
      '2105,UNK,Nowhere,Test,OK,35.50,-97.90,Unknown size.',
      '2110,100,Somewhere,Test,OK,,,-97.90,Missing latitude.',
      '',
    ].join('\n');
    expect(parseSpcReports(csv, FILE_DATE)).toEqual([]);
  });
});

describe('fetchHailEvents', () => {
  it('fetches the last N daily files and returns real hail rows, newest first', async () => {
    const fetchFn = mockFetch(
      new Map([
        ['https://www.spc.noaa.gov/climo/reports/261122_rpts.csv', SPC_SAMPLE],
        ['https://www.spc.noaa.gov/climo/reports/261121_rpts.csv', ''],
      ]),
    );
    const result = await fetchHailEvents({
      days: 2,
      now: new Date(Date.UTC(2026, 10, 22, 23, 0)),
      fetchFn,
    });
    expect(result.status).toBe('ok');
    expect(result.daysFetched).toBe(2);
    expect(result.events).toHaveLength(2);
    expect(result.source).toBe('NOAA Storm Prediction Center');
    expect(result.checkedAt).toBe('2026-11-22T23:00:00.000Z');
  });

  it('tolerates a failed day and reports it instead of failing the whole feed', async () => {
    const fetchFn = mockFetch(
      new Map([['https://www.spc.noaa.gov/climo/reports/261122_rpts.csv', SPC_SAMPLE]]),
      new Set(['https://www.spc.noaa.gov/climo/reports/261121_rpts.csv']),
    );
    const result = await fetchHailEvents({
      days: 2,
      now: new Date(Date.UTC(2026, 10, 22, 23, 0)),
      fetchFn,
    });
    expect(result.status).toBe('ok');
    expect(result.daysFetched).toBe(1);
    expect(result.daysFailed).toBe(1);
    expect(result.events).toHaveLength(2);
  });

  it('reports unavailable with no invented events when every day fails', async () => {
    const fetchFn = mockFetch(new Map(), new Set([
      'https://www.spc.noaa.gov/climo/reports/261122_rpts.csv',
      'https://www.spc.noaa.gov/climo/reports/261121_rpts.csv',
    ]));
    const result = await fetchHailEvents({
      days: 2,
      now: new Date(Date.UTC(2026, 10, 22, 23, 0)),
      fetchFn,
    });
    expect(result.status).toBe('unavailable');
    expect(result.events).toEqual([]);
    expect(result.daysFetched).toBe(0);
    expect(result.message).toContain('could not be reached');
  });
});

describe('hail cache', () => {
  it('serves the cached feed within the TTL without re-fetching', async () => {
    let calls = 0;
    const fetchFn = (async (_url: string) => {
      calls += 1;
      return new Response(SPC_SAMPLE, { status: 200 });
    }) as unknown as typeof fetch;
    const now = new Date(Date.UTC(2026, 10, 22, 23, 0));
    const first = await refreshHailEvents({ days: 1, now, fetchFn });
    expect(first.events).toHaveLength(2);
    const second = await getCachedHailEvents({ days: 1, now, fetchFn });
    expect(second.events).toHaveLength(2);
    expect(calls).toBe(1);
  });
});

describe('haversineMiles', () => {
  it('measures Dallas to Fort Worth at about 32 miles', () => {
    const miles = haversineMiles(32.7767, -96.797, 32.7555, -97.3308);
    expect(miles).toBeGreaterThan(28);
    expect(miles).toBeLessThan(36);
  });

  it('is zero for the same point', () => {
    expect(haversineMiles(34.32, -92.64, 34.32, -92.64)).toBe(0);
  });
});

describe('averageJobValueMinor', () => {
  it('averages the company’s own past roof estimates', () => {
    expect(averageJobValueMinor([1_200_000, 1_500_000, 900_000])).toBe(1_200_000);
  });

  it('returns null — never a made-up number — when there are no priced estimates', () => {
    expect(averageJobValueMinor([])).toBeNull();
    expect(averageJobValueMinor([0, -5])).toBeNull();
  });
});

describe('buildStormDraft', () => {
  it('names the real hail size, place and date from the NOAA report', () => {
    const event: HailEvent = {
      id: 'spc-261122-2105-34.32--92.64-0',
      date: '2026-11-22',
      timeUtc: '21:05',
      magnitudeIn: 1,
      location: 'Poyen',
      county: 'ARC053',
      state: 'AR',
      lat: 34.32,
      lon: -92.64,
      comments: 'Quarter size hail.',
      source: 'NOAA Storm Prediction Center',
    };
    const draft = buildStormDraft(event, { name: 'Jamie', phone: '+15125550100' }, 'Acme Roofing');
    expect(draft).toContain('Acme Roofing');
    expect(draft).toContain('Poyen, AR');
    expect(draft).toContain('2026-11-22');
    expect(draft).toContain('STOP to opt out');
  });
});
