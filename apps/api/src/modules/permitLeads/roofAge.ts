// Roof-age leads: derive roof age from public permit history already published by Texas cities.
// A property's roof age here means "years since the newest roofing permit found for that address
// in the scanned records" — permit-history age only. It is never a damage or condition claim, and
// "no roofing permit on file" is never treated as an old roof. Verify in person before quoting.
import type { RawPermit } from './engine';
import {
  checkCustomFeed,
  LIVE_SOURCES,
  normalizeAustin,
  normalizeCollin,
  normalizeDallas,
  normalizeDenton,
  normalizeFortWorth,
  normalizeGeneric,
} from './sources';
import { cleanCityName } from './texas';

type FetchLike = typeof fetch;

const ROOF_TEXT = /roof|re-?roof|shingle/i;

export function isRoofingPermit(p: RawPermit): boolean {
  return ROOF_TEXT.test([p.description, p.permitType, p.workClass, p.landUse].join(' '));
}

/** Stable property key from published address fields; empty when the address is missing. */
export function propertyKey(p: RawPermit): string {
  const address = p.address
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!address) return '';
  return [address, p.city.toUpperCase().trim(), p.zip.trim()].join('|');
}

export interface RoofAgeLead {
  address: string;
  city: string;
  zip: string;
  source: string;
  sourceName: string;
  /** Newest roofing permit date found for this property in the scanned records. */
  newestRoofingPermitAt: string;
  /** Years since that permit, one decimal. Permit-history age only. */
  ageYears: number;
  roofingPermitCount: number;
  latestPermit: {
    permitNumber: string;
    description: string;
    contractor: string;
    url: string;
  };
}

export interface RoofAgeDerivation {
  leads: RoofAgeLead[];
  propertiesWithRoofingPermit: number;
  propertiesWithoutAddress: number;
  roofingPermitsWithoutDate: number;
}

const DAY_MS = 86_400_000;

/**
 * Group roofing permits by property and flag those whose newest roofing permit is at least
 * `thresholdYears` old. Oldest first. Pure: callers supply the permits.
 */
export function deriveRoofAge(
  permits: RawPermit[],
  now: Date,
  thresholdYears: number,
): RoofAgeDerivation {
  const byProperty = new Map<string, RawPermit[]>();
  let propertiesWithoutAddress = 0;
  let roofingPermitsWithoutDate = 0;
  for (const p of permits) {
    if (!isRoofingPermit(p)) continue;
    const key = propertyKey(p);
    if (!key) {
      propertiesWithoutAddress += 1;
      continue;
    }
    if (!(p.issuedAt ?? p.appliedAt)) {
      roofingPermitsWithoutDate += 1;
      continue;
    }
    byProperty.set(key, [...(byProperty.get(key) ?? []), p]);
  }
  const leads: RoofAgeLead[] = [];
  for (const list of byProperty.values()) {
    const sorted = [...list].sort((a, b) =>
      (b.issuedAt ?? b.appliedAt ?? '').localeCompare(a.issuedAt ?? a.appliedAt ?? ''),
    );
    const newest = sorted[0]!;
    const newestAt = (newest.issuedAt ?? newest.appliedAt)!;
    const ageYears = Math.round(((now.getTime() - Date.parse(newestAt)) / (365.25 * DAY_MS)) * 10) / 10;
    if (ageYears < thresholdYears) continue;
    leads.push({
      address: newest.address,
      city: newest.city,
      zip: newest.zip,
      source: newest.source,
      sourceName: newest.sourceName,
      newestRoofingPermitAt: newestAt,
      ageYears,
      roofingPermitCount: list.length,
      latestPermit: {
        permitNumber: newest.permitNumber,
        description: newest.description,
        contractor: newest.contractor,
        url: newest.url,
      },
    });
  }
  leads.sort((a, b) => b.ageYears - a.ageYears);
  return {
    leads,
    propertiesWithRoofingPermit: byProperty.size,
    propertiesWithoutAddress,
    roofingPermitsWithoutDate,
  };
}

// ---- Fetching roofing-permit history from the same live feeds (bounded scans) ----

async function fetchJsonArray(url: URL, fetcher: FetchLike): Promise<unknown[]> {
  const res = await fetcher(url.href, {
    method: 'GET',
    redirect: 'error',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
    cache: 'no-store',
  });
  if (!res.ok) throw Error('Permit feed unavailable (' + res.status + ').');
  const body = await res.text();
  if (body.length > 6_000_000) throw Error('Permit feed response too large.');
  const data = JSON.parse(body) as unknown;
  return Array.isArray(data) ? data : [];
}

export async function fetchAustinRoofing(fetcher: FetchLike): Promise<RawPermit[]> {
  const url = new URL('https://data.austintexas.gov/resource/3syk-w9eu.json');
  url.searchParams.set(
    '$where',
    "upper(description) like '%ROOF%' OR upper(permit_type_desc) like '%ROOF%'",
  );
  url.searchParams.set('$order', 'issue_date DESC');
  url.searchParams.set('$limit', '5000');
  return normalizeAustin(await fetchJsonArray(url, fetcher));
}

export async function fetchDallasRoofing(fetcher: FetchLike): Promise<RawPermit[]> {
  const url = new URL('https://www.dallasopendata.com/resource/e7gq-4sah.json');
  url.searchParams.set('$where', "upper(work_description) like '%ROOF%'");
  url.searchParams.set('$limit', '5000');
  return normalizeDallas(await fetchJsonArray(url, fetcher));
}

export async function fetchCollinRoofing(fetcher: FetchLike, now: Date): Promise<RawPermit[]> {
  const url = new URL('https://data.texas.gov/resource/82ee-gbj5.json');
  url.searchParams.set('$where', "upper(permittypedescr) like '%ROOF%'");
  url.searchParams.set('$order', 'permitissueddate DESC');
  url.searchParams.set('$limit', '5000');
  return normalizeCollin(await fetchJsonArray(url, fetcher), now);
}

async function fetchArcGisRoofing(
  endpoint: string,
  fields: string,
  where: string,
  orderBy: string,
  normalize: (rows: unknown[]) => RawPermit[],
  fetcher: FetchLike,
  geometry: boolean,
): Promise<RawPermit[]> {
  const permits: RawPermit[] = [];
  for (let page = 0; page < 5; page++) {
    const url = new URL(endpoint);
    url.searchParams.set('where', where);
    url.searchParams.set('outFields', fields);
    url.searchParams.set('orderByFields', orderBy);
    url.searchParams.set('resultOffset', String(page * 1000));
    url.searchParams.set('resultRecordCount', '1000');
    url.searchParams.set('returnGeometry', geometry ? 'true' : 'false');
    if (geometry) url.searchParams.set('outSR', '4326');
    url.searchParams.set('f', 'json');
    const res = await fetcher(url.href, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
      cache: 'no-store',
    });
    if (!res.ok) throw Error('Permit feed unavailable (' + res.status + ')');
    const raw = await res.text();
    if (raw.length > 6_000_000) throw Error('Permit feed response too large');
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (data.error) throw Error('Permit feed returned an ArcGIS error');
    if (!Array.isArray(data.features)) throw Error('Permit feed missing features');
    const features = data.features as Record<string, unknown>[];
    const rows = geometry ? features : features.map((f) => f.attributes);
    permits.push(...normalize(rows));
    if (features.length < 1000) break;
  }
  return permits;
}

export async function fetchFortWorthRoofing(fetcher: FetchLike): Promise<RawPermit[]> {
  return fetchArcGisRoofing(
    'https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Open_Data_Development_Permits_View/FeatureServer/0/query',
    [
      'Permit_No', 'Permit_Type', 'Permit_SubType', 'Permit_Category', 'B1_WORK_DESC',
      'B1_SPECIAL_TEXT', 'Full_Street_Address', 'Zip_Code', 'Current_Status',
      'Status_Date', 'File_Date', 'JobValue', 'Use_Type', 'Specific_Use', 'Units',
    ].join(','),
    "(UPPER(B1_WORK_DESC) LIKE '%ROOF%' OR UPPER(Permit_Type) LIKE '%ROOF%' OR UPPER(B1_SPECIAL_TEXT) LIKE '%ROOF%')",
    'File_Date DESC',
    normalizeFortWorth,
    fetcher,
    false,
  );
}

export async function fetchDentonRoofing(fetcher: FetchLike): Promise<RawPermit[]> {
  return fetchArcGisRoofing(
    'https://services.arcgis.com/9dTWrhPzuDPnUVXr/ArcGIS/rest/services/All_Permits/FeatureServer/0/query',
    [
      'PERMIT_NO', 'RECORDID', 'SITE_ADDR', 'SITUS', 'SITE_ZIP',
      'SITE_DESCRIPTION', 'NOTES', 'DESCRIPTION', 'PermitType', 'PermitSubType',
      'OCCUPANCY_TYPE', 'STATUS', 'ISSUED', 'APPLIED', 'JOBVALUE',
      'NO_UNITS', 'CONTRACTOR_NAME',
    ].join(','),
    "(UPPER(PermitType) LIKE '%ROOF%' OR UPPER(SITE_DESCRIPTION) LIKE '%ROOF%' OR UPPER(DESCRIPTION) LIKE '%ROOF%')",
    'APPLIED DESC',
    normalizeDenton,
    fetcher,
    true,
  );
}

export interface RoofAgeInput {
  cities: string[];
  thresholdYears: number;
  customFeeds: { city: string; url: string }[];
}

export async function searchRoofAge(
  input: RoofAgeInput,
  deps: { fetcher?: FetchLike; now?: Date; resolve?: Parameters<typeof checkCustomFeed>[1] } = {},
) {
  const now = deps.now ?? new Date();
  const fetcher = deps.fetcher ?? fetch;
  const wanted = [...new Set(input.cities.map(cleanCityName).filter(Boolean))];
  const wantedLower = new Set(wanted.map((c) => c.toLowerCase()));
  const everyCity = wantedLower.has('all texas');

  interface FeedOutcome {
    id: string;
    name: string;
    status: 'ok' | 'unavailable' | 'rejected';
    count: number;
    message: string;
    permits: RawPermit[];
  }
  const run = async (
    id: string,
    name: string,
    load: () => Promise<RawPermit[]>,
  ): Promise<FeedOutcome> => {
    try {
      const permits = (await load()).filter(isRoofingPermit);
      return {
        id,
        name,
        status: 'ok',
        count: permits.length,
        message: permits.length
          ? `${permits.length} roofing permits scanned.`
          : 'The feed answered but returned no roofing permits in the bounded scan.',
        permits,
      };
    } catch {
      return {
        id,
        name,
        status: 'unavailable',
        count: 0,
        message: 'The city feed did not answer. Try again in a few minutes.',
        permits: [],
      };
    }
  };

  const jobs: Promise<FeedOutcome>[] = [];
  for (const src of LIVE_SOURCES) {
    const hit = everyCity || src.cities.some((c) => wantedLower.has(c.toLowerCase()));
    if (!hit) continue;
    if (src.id === 'austin') jobs.push(run(src.id, src.name, () => fetchAustinRoofing(fetcher)));
    if (src.id === 'dallas') jobs.push(run(src.id, src.name, () => fetchDallasRoofing(fetcher)));
    if (src.id === 'collin')
      jobs.push(
        run(src.id, src.name, async () =>
          (await fetchCollinRoofing(fetcher, now)).filter(
            (p) => everyCity || wantedLower.has(p.city.toLowerCase()),
          ),
        ),
      );
    if (src.id === 'fortworth')
      jobs.push(run(src.id, src.name, () => fetchFortWorthRoofing(fetcher)));
    if (src.id === 'denton') jobs.push(run(src.id, src.name, () => fetchDentonRoofing(fetcher)));
  }
  for (const feed of input.customFeeds) {
    const city = cleanCityName(feed.city);
    const url = await checkCustomFeed(feed.url, deps.resolve);
    if (!url) {
      jobs.push(
        Promise.resolve({
          id: 'custom:' + city,
          name: `${city} feed`,
          status: 'rejected' as const,
          count: 0,
          message:
            'Use the https "/resource/xxxx-xxxx.json" API link from the city\'s open-data permit page.',
          permits: [],
        }),
      );
      continue;
    }
    jobs.push(
      run('custom:' + url.host, `${city} open data (${url.host})`, async () => {
        const q = new URL(url.href);
        q.searchParams.set('$order', ':updated_at DESC');
        q.searchParams.set('$limit', '4000');
        const rows = await fetchJsonArray(q, fetcher);
        const landing = url.origin + '/d/' + url.pathname.slice(10, 19);
        return normalizeGeneric(rows, 'custom:' + url.host + url.pathname, city, landing);
      }),
    );
  }
  const feeds = await Promise.all(jobs);
  const all = [
    ...new Map(
      feeds.flatMap((f) => f.permits).map((p) => [p.source + ':' + p.permitNumber, p]),
    ).values(),
  ];
  const derived = deriveRoofAge(all, now, input.thresholdYears);
  return {
    fetchedAt: now.toISOString(),
    thresholdYears: input.thresholdYears,
    summary: {
      roofingPermitsScanned: all.length,
      propertiesWithRoofingPermit: derived.propertiesWithRoofingPermit,
      flagged: derived.leads.length,
      propertiesWithoutAddress: derived.propertiesWithoutAddress,
      roofingPermitsWithoutDate: derived.roofingPermitsWithoutDate,
    },
    feeds: feeds.map(({ permits: _p, ...f }) => f),
    leads: derived.leads.slice(0, 300),
    caveats: [
      'Roof age means years since the newest roofing permit found for that address in the scanned city records. It is not a damage, condition or remaining-life claim.',
      'A property with no roofing permit in the scan is not listed: no permit on file does not mean an old roof.',
      'Scans are bounded (newest records first, per-feed caps), so a newer roofing permit outside the scan would make a roof younger than shown. Verify in person before quoting.',
      'Florida-style insurance-renewal rules do not apply in Texas; no insurance claim is made for these leads.',
    ],
  };
}
