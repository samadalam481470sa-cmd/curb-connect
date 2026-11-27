// Live public permit feeds for Texas. Built-in feeds use fixed official hosts. A company can add
// any other Texas city's Socrata open-data permit feed; those URLs are checked so the server never
// calls private or internal addresses.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { strFromU8, unzipSync } from 'fflate';
import { extractPdfText } from '../../services/plan-pdf';
import type { RawPermit } from './engine';

export type { RawPermit } from './engine';

type Obj = Record<string, unknown>;
type FetchLike = typeof fetch;
const obj = (v: unknown): Obj =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
const str = (v: unknown, max = 300): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '';
const num = (v: unknown): number => {
  const n = Number(String(v ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n > 0 && n < 5e10 ? n : 0;
};
function iso(v: unknown): string | null {
  const raw = str(v, 40);
  if (!raw) return null;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})/.exec(raw);
  const d = us
    ? new Date(
        Date.UTC(
          Number(us[3]!.length === 2 ? '20' + us[3] : us[3]),
          Number(us[1]) - 1,
          Number(us[2]),
        ),
      )
    : new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
const PHONE = /\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}/;

export interface LiveSource {
  id: string;
  name: string;
  cities: string[];
  url: string;
  documentation: string;
  note: string;
}

export const LIVE_SOURCES: LiveSource[] = [
  {
    id: 'austin',
    name: 'City of Austin – Issued Construction Permits',
    cities: ['Austin'],
    url: 'https://data.austintexas.gov/d/3syk-w9eu',
    documentation: 'https://data.austintexas.gov/d/3syk-w9eu',
    note: 'Updated daily by the City of Austin. Includes contractor name and phone when filed.',
  },
  {
    id: 'dallas',
    name: 'City of Dallas – Building Permits',
    cities: ['Dallas'],
    url: 'https://www.dallasopendata.com/d/e7gq-4sah',
    documentation: 'https://www.dallasopendata.com/d/e7gq-4sah',
    note: 'Published by the City of Dallas. The city updates this file on its own schedule, so recent weeks can be missing. In 2026 the city publishes counts but almost no contractor or value on permits, so Dallas leads usually have no contractor on file yet (verified 2026-11-23).',
  },
  {
    id: 'denton',
    name: 'City of Denton – All Permits',
    cities: ['Denton'],
    url: 'https://www.cityofdenton.com/237/Permits-Licenses',
    documentation: 'https://services.arcgis.com/9dTWrhPzuDPnUVXr/ArcGIS/rest/services/All_Permits/FeatureServer/0',
    note: 'Official City of Denton ArcGIS permit table with contractor when recorded. This feed does not cover the whole of Denton County. Verified 2026-11-23: the feed has not published new permits since 2026-01-06, so Denton leads are out of date until the city resumes publishing.',
  },
  {
    id: 'fortworth',
    name: 'City of Fort Worth – Development Permits',
    cities: ['Fort Worth'],
    url: 'https://www.fortworthtexas.gov/departments/development-services/permits/issued',
    documentation: 'https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Open_Data_Development_Permits_View/FeatureServer/0',
    note: 'Official Fort Worth open-data permits. Owner name is not assumed to be the general contractor; Tarrant County cities outside Fort Worth need separate feeds.',
  },
  {
    id: 'arlington',
    name: 'City of Arlington – Issued Permits',
    cities: ['Arlington'],
    url: 'https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/1',
    documentation:
      'https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/1',
    note: 'Official City of Arlington open-data permits (CC-BY 4.0). This feed does not publish zip, units, contractor or phone.',
  },
  {
    id: 'sanantonio',
    name: 'City of San Antonio – Permits Issued',
    cities: ['San Antonio'],
    url: 'https://data.sanantonio.gov/dataset/building-permits',
    documentation: 'https://data.sanantonio.gov/dataset/building-permits',
    note: 'Official City of San Antonio open-data permits, updated daily. Contacts are only the primary contact the city published; no phone is published.',
  },
  {
    id: 'collin',
    name: 'Collin Central Appraisal District – Building Permits (all Collin County cities)',
    cities: [
      'Plano',
      'Frisco',
      'McKinney',
      'Allen',
      'Prosper',
      'Celina',
      'Princeton',
      'Anna',
      'Wylie',
      'Murphy',
      'Melissa',
      'Fairview',
      'Lucas',
      'Parker',
      'Lavon',
      'Farmersville',
      'Josephine',
      'Blue Ridge',
      'Nevada',
      'Saint Paul',
      'Weston',
      'Lowry Crossing',
      'New Hope',
    ],
    url: 'https://data.texas.gov/d/82ee-gbj5',
    documentation: 'https://data.texas.gov/d/82ee-gbj5',
    note: 'Texas Open Data Portal. Permits the Collin County cities report to the appraisal district, with value, owner and builder.',
  },
  {
    id: 'houston',
    name: 'City of Houston – Sold Permits (weekly Excel)',
    cities: ['Houston'],
    url: 'https://www.houstonpermittingcenter.org/sold-permits-search',
    documentation: 'https://www.houstonpermittingcenter.org/sold-permits-search',
    note: 'Official Houston Permitting Center weekly Excel report of permits sold that week. The city posts a new file about once a week, usually 1–2 weeks after the permit date, so newest permits are normally up to a week old. The file publishes no contractor, value or applicant — those stay empty, never guessed. Verified 2026-11-23: newest file covers 2026-11-16→2026-11-22 (385 permits).',
  },
  {
    id: 'carrollton',
    name: 'City of Carrollton – Monthly Permit Report (PDF)',
    cities: ['Carrollton'],
    url: 'https://webrpts.cityofcarrollton.com/bldg_insp/results/permit_reports/previous_month.pdf',
    documentation: 'https://webrpts.cityofcarrollton.com/bldg_insp/results/permit_reports/previous_month.pdf',
    note: 'Official City of Carrollton monthly permit report (PDF). The city posts one report a month covering the previous calendar month, so leads are ~4–5 weeks old. The report publishes applicant and valuation; the applicant is shown in the description, not treated as a hired contractor. Verified 2026-11-27: report dated 2026-11-01 (110 pages) covering October 2026 permits.',
  },
  {
    id: 'irving',
    name: 'City of Irving – Permits Issued (historical)',
    cities: ['Irving'],
    url: 'https://data-cityofirving.opendata.arcgis.com/',
    documentation:
      'https://services3.arcgis.com/OfsJXUlu8pSkbl7B/ArcGIS/rest/services/Residential_Permits_Issued_Feb_15_2022_Present/FeatureServer',
    note: 'Historical — feed stopped March 2025. Official City of Irving open-data permit tables (residential + commercial). Both feeds were last edited 2025-03-12 and the newest permit is dated 2025-02-28 (verified 2026-11-27). Irving permits are shown for history only and are never counted as current leads.',
  },
];

async function getJson(url: URL, fetcher: FetchLike): Promise<unknown[]> {
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

const day = (d: Date) => d.toISOString().slice(0, 10);

export function normalizeAustin(rows: unknown[]): RawPermit[] {
  return rows
    .map((raw) => {
      const r = obj(raw);
      const link = obj(r.link);
      const linkUrl = str(link.url, 500);
      return {
        source: 'austin',
        sourceName: 'City of Austin',
        permitNumber: str(r.permit_number, 60),
        city: str(r.original_city, 60) || 'Austin',
        address: str(r.permit_location, 160) || str(r.original_address1, 160),
        zip: str(r.original_zip, 10),
        description: str(r.description, 400),
        permitType: str(r.permit_type_desc, 80),
        workClass: str(r.work_class, 80),
        landUse: str(r.permit_class_mapped, 80) + ' ' + str(r.permit_class, 80),
        status: str(r.status_current, 40),
        issuedAt: iso(r.issue_date),
        appliedAt: iso(r.applieddate),
        value: num(r.total_job_valuation) || num(r.building_valuation_remodel),
        units: num(r.housing_units),
        contractor: str(r.contractor_company_name, 140) || str(r.contractor_full_name, 140),
        contractorPhone: str(r.contractor_phone, 30),
        url: /^https:\/\/abc\.austintexas\.gov\//.test(linkUrl)
          ? linkUrl
          : 'https://data.austintexas.gov/d/3syk-w9eu',
      };
    })
    .filter((p) => p.permitNumber);
}

export function normalizeDallas(rows: unknown[]): RawPermit[] {
  return rows
    .map((raw) => {
      const r = obj(raw);
      const contractorRaw = str(r.contractor, 300);
      const phone = PHONE.exec(contractorRaw)?.[0] ?? '';
      // Dallas stores "NAME ADDRESS, CITY, TX ZIP (PHONE)" in one field. Keep the name part.
      const name = contractorRaw.replace(/\s\d+\s.*$/, '').trim();
      return {
        source: 'dallas',
        sourceName: 'City of Dallas',
        permitNumber: str(r.permit_number, 60),
        city: 'Dallas',
        address: str(r.street_address, 160),
        zip: str(r.zip_code, 10),
        description: str(r.work_description, 400),
        permitType: str(r.permit_type, 80),
        workClass: '',
        landUse: str(r.land_use, 120),
        status: 'Issued',
        issuedAt: iso(r.issued_date),
        appliedAt: null,
        value: num(r.value),
        units: 0,
        contractor: name,
        contractorPhone: phone,
        url: 'https://www.dallasopendata.com/d/e7gq-4sah',
      };
    })
    .filter((p) => p.permitNumber);
}

const titleCase = (v: string) => v.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());

export function normalizeCollin(rows: unknown[], now: Date): RawPermit[] {
  const latest = now.getTime() + 86_400_000;
  return rows
    .map((raw) => {
      const r = obj(raw);
      const builder = str(r.permitbuildername, 140);
      const issuedTo = str(r.permitissuedto, 140);
      // The builder column sometimes holds a suite number; fall back to who the permit went to.
      const contractor = /^(STE|SUITE|UNIT|#)\b/i.test(builder) || !builder ? issuedTo : builder;
      const city = titleCase(
        str(r.situscity, 60) || str(r.permitissuedby, 60).replace(/\s+CITY$/i, ''),
      );
      return {
        source: 'collin',
        sourceName: 'Collin County (appraisal district)',
        permitNumber: str(r.permitnum, 60) || str(r.permitid, 60),
        city,
        address: str(r.situsconcatshort, 160) || str(r.situsconcat, 160),
        zip: str(r.situszip, 10),
        description: [str(r.permittypedescr, 120), str(r.propabssubname, 120)]
          .filter(Boolean)
          .join(' – '),
        permitType: str(r.permittypedescr, 80),
        workClass: str(r.permittypecode, 20),
        landUse: str(r.proprescom, 40),
        status: 'Issued',
        issuedAt: iso(r.permitissueddate),
        appliedAt: null,
        value: num(r.permitvalue),
        units: 0,
        contractor,
        contractorPhone: '',
        url: 'https://data.texas.gov/d/82ee-gbj5',
      };
    })
    .filter((p) => p.permitNumber && (!p.issuedAt || Date.parse(p.issuedAt) <= latest));
}

/** Common column names across Texas Socrata permit datasets. */
const PICK: Record<string, string[]> = {
  permitNumber: [
    'permit_number',
    'permitnumber',
    'permit_no',
    'permit_num',
    'record_id',
    'permit_id',
    'case_number',
  ],
  address: [
    'address',
    'street_address',
    'permit_location',
    'site_address',
    'full_address',
    'location_address',
    'original_address1',
  ],
  zip: ['zip', 'zip_code', 'zipcode', 'original_zip'],
  description: [
    'description',
    'work_description',
    'project_description',
    'scope_of_work',
    'workdesc',
  ],
  permitType: ['permit_type', 'permit_type_desc', 'type', 'record_type', 'permittype'],
  workClass: ['work_class', 'work_type', 'worktype', 'subtype', 'permit_subtype'],
  landUse: ['land_use', 'use', 'occupancy', 'permit_class', 'use_type'],
  status: ['status', 'status_current', 'permit_status', 'current_status'],
  issued: ['issued_date', 'issue_date', 'issueddate', 'date_issued', 'issued'],
  applied: ['applied_date', 'applieddate', 'application_date', 'date_applied', 'submitted_date'],
  value: [
    'value',
    'valuation',
    'job_value',
    'total_job_valuation',
    'project_value',
    'estimated_cost',
    'declared_valuation',
  ],
  units: ['units', 'housing_units', 'dwelling_units', 'number_of_units'],
  contractor: [
    'contractor',
    'contractor_name',
    'contractor_company_name',
    'applicant',
    'applicant_name',
    'company_name',
    'owner_name',
  ],
  phone: ['contractor_phone', 'phone', 'applicant_phone'],
};
function pick(r: Obj, key: keyof typeof PICK): unknown {
  for (const k of PICK[key]!) if (r[k] !== undefined) return r[k];
  return undefined;
}

export function normalizeGeneric(
  rows: unknown[],
  id: string,
  city: string,
  landing: string,
): RawPermit[] {
  return rows
    .map((raw) => {
      const r = obj(raw);
      const contractor = str(pick(r, 'contractor'), 200);
      return {
        source: id,
        sourceName: `City of ${city}`,
        permitNumber: str(pick(r, 'permitNumber'), 60),
        city,
        address: str(pick(r, 'address'), 160),
        zip: str(pick(r, 'zip'), 10),
        description: str(pick(r, 'description'), 400),
        permitType: str(pick(r, 'permitType'), 80),
        workClass: str(pick(r, 'workClass'), 80),
        landUse: str(pick(r, 'landUse'), 120),
        status: str(pick(r, 'status'), 40),
        issuedAt: iso(pick(r, 'issued')),
        appliedAt: iso(pick(r, 'applied')),
        value: num(pick(r, 'value')),
        units: num(pick(r, 'units')),
        contractor: contractor.replace(/\s\d+\s.*$/, '').trim(),
        contractorPhone: str(pick(r, 'phone'), 30) || (PHONE.exec(contractor)?.[0] ?? ''),
        url: landing,
      };
    })
    .filter((p) => p.permitNumber || p.address);
}

/** Months covered by the window, as Dallas "MM/%/YY" patterns (Dallas stores dates as text). */
export function dallasMonthPatterns(since: Date, now: Date): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), 1));
  while (d <= now && out.length < 13) {
    out.push(
      `${String(d.getUTCMonth() + 1).padStart(2, '0')}/%/${String(d.getUTCFullYear()).slice(2)}`,
    );
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

const PRIVATE_V4 =
  /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;
function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) return PRIVATE_V4.test(ip);
  const v6 = ip.toLowerCase();
  return (
    v6 === '::1' ||
    v6 === '::' ||
    v6.startsWith('fc') ||
    v6.startsWith('fd') ||
    v6.startsWith('fe80') ||
    (v6.startsWith('::ffff:') && PRIVATE_V4.test(v6.slice(7)))
  );
}

/**
 * Accept only an https Socrata resource URL on a public host, e.g.
 * https://data.example-city.gov/resource/abcd-1234.json
 */
export async function checkCustomFeed(raw: string, resolve = lookup): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (!/^\/resource\/[a-z0-9]{4}-[a-z0-9]{4}\.json$/.test(url.pathname)) return null;
  const host = url.hostname.toLowerCase();
  if (isIP(host) || !host.includes('.') || /\.(local|internal|localhost|lan|corp|home)$/.test(host))
    return null;
  try {
    const addrs = await resolve(host, { all: true });
    if (!addrs.length || addrs.some((a) => privateAddress(a.address))) return null;
  } catch {
    return null;
  }
  return new URL(url.origin + url.pathname);
}

export interface FeedResult {
  id: string;
  name: string;
  status: 'ok' | 'stale' | 'unavailable' | 'rejected';
  count: number;
  latest: string | null;
  message: string;
  permits: RawPermit[];
  /** Freshness of the newest permit in this batch (see freshness.ts). */
  freshness: 'live' | 'stale' | 'unavailable' | 'unknown';
  /** Share of permits naming a contractor / listing a value / carrying a zip; null when empty. */
  fieldHealth: { contractor: number; value: number; zip: number } | null;
}

export async function fetchAustin(since: Date, fetcher: FetchLike): Promise<RawPermit[]> {
  const url = new URL('https://data.austintexas.gov/resource/3syk-w9eu.json');
  url.searchParams.set(
    '$where',
    `issue_date >= '${day(since)}T00:00:00' OR applieddate >= '${day(since)}T00:00:00'`,
  );
  url.searchParams.set('$order', 'issue_date DESC');
  url.searchParams.set('$limit', '4000');
  return normalizeAustin(await getJson(url, fetcher));
}

export async function fetchDallas(
  since: Date,
  now: Date,
  fetcher: FetchLike,
): Promise<RawPermit[]> {
  const url = new URL('https://www.dallasopendata.com/resource/e7gq-4sah.json');
  const where = dallasMonthPatterns(since, now)
    .map((m) => `issued_date like '${m}'`)
    .join(' OR ');
  url.searchParams.set('$where', where);
  url.searchParams.set('$limit', '4000');
  const all = normalizeDallas(await getJson(url, fetcher));
  return all.filter((p) => !p.issuedAt || Date.parse(p.issuedAt) >= since.getTime());
}

export async function fetchCollin(
  since: Date,
  now: Date,
  fetcher: FetchLike,
): Promise<RawPermit[]> {
  const url = new URL('https://data.texas.gov/resource/82ee-gbj5.json');
  url.searchParams.set(
    '$where',
    `permitissueddate >= '${day(since)}T00:00:00' AND permitissueddate <= '${day(new Date(now.getTime() + 86_400_000))}T00:00:00'`,
  );
  url.searchParams.set('$order', 'permitissueddate DESC');
  url.searchParams.set('$limit', '5000');
  return normalizeCollin(await getJson(url, fetcher), now);
}

export async function fetchCustom(
  url: URL,
  city: string,
  since: Date,
  fetcher: FetchLike,
): Promise<RawPermit[]> {
  const q = new URL(url.href);
  q.searchParams.set('$order', ':updated_at DESC');
  q.searchParams.set('$limit', '4000');
  const rows = await getJson(q, fetcher);
  const landing = url.origin + '/d/' + url.pathname.slice(10, 19);
  return normalizeGeneric(rows, 'custom:' + url.host + url.pathname, city, landing).filter(
    (p) =>
      !(p.issuedAt ?? p.appliedAt) || Date.parse((p.issuedAt ?? p.appliedAt)!) >= since.getTime(),
  );
}


/** Fort Worth ArcGIS records are a city feed, not a countywide GC/subcontractor registry.
 * Its Owner_Full_Name field is intentionally NOT treated as a general contractor.
 */
export function normalizeFortWorth(rows: unknown[]): RawPermit[] {
  const arcDate = (value: unknown): string | null => {
    if (typeof value === 'number') {
      const d = new Date(value);
      return Number.isFinite(d.getTime()) ? d.toISOString() : null;
    }
    return iso(value);
  };
  return rows.map((raw) => {
    const r = obj(raw);
    const address = str(r.Full_Street_Address, 160) ||
      [str(r.Addr_No), str(r.Direction), str(r.Street_Name), str(r.Street_Suffix)].filter(Boolean).join(' ');
    return {
      source: 'fortworth',
      sourceName: 'City of Fort Worth',
      permitNumber: str(r.Permit_No, 60),
      city: 'Fort Worth',
      address,
      zip: str(r.Zip_Code, 10),
      description: str(r.B1_WORK_DESC, 400) || str(r.B1_SPECIAL_TEXT, 400),
      permitType: str(r.Permit_Type, 80),
      workClass: str(r.Permit_SubType, 80) + ' ' + str(r.Permit_Category, 80),
      landUse: str(r.Use_Type, 80) + ' ' + str(r.Specific_Use, 80),
      status: str(r.Current_Status, 80),
      issuedAt: /^(issued|approved|permit issued)\b/i.test(str(r.Current_Status)) ? arcDate(r.Status_Date) : null,
      appliedAt: arcDate(r.File_Date),
      value: num(r.JobValue),
      units: num(r.Units),
      contractor: '',
      contractorPhone: '',
      url: 'https://www.fortworthtexas.gov/departments/development-services/permits/issued',
    };
  }).filter((p) => p.permitNumber);
}

/** ArcGIS FeatureServer paginates at 1,000 records; newer permit filings first.
 * The bounded scan prevents runaway ingestion when an entire year is requested.
 */
export async function fetchFortWorth(since: Date, fetcher: FetchLike): Promise<RawPermit[]> {
  const endpoint = 'https://services5.arcgis.com/3ddLCBXe1bRt7mzj/arcgis/rest/services/CFW_Open_Data_Development_Permits_View/FeatureServer/0/query';
  const fields = [
    'Permit_No', 'Permit_Type', 'Permit_SubType', 'Permit_Category', 'B1_WORK_DESC',
    'B1_SPECIAL_TEXT', 'Full_Street_Address', 'Zip_Code', 'Current_Status',
    'Status_Date', 'File_Date', 'JobValue', 'Use_Type', 'Specific_Use', 'Units',
  ].join(',');
  const permits: RawPermit[] = [];
  for (let page = 0; page < 5; page++) {
    const url = new URL(endpoint);
    url.searchParams.set('where', '1=1');
    url.searchParams.set('outFields', fields);
    url.searchParams.set('orderByFields', 'File_Date DESC');
    url.searchParams.set('resultOffset', String(page * 1000));
    url.searchParams.set('resultRecordCount', '1000');
    url.searchParams.set('returnGeometry', 'false');
    url.searchParams.set('f', 'json');
    const res = await fetcher(url.href, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
      cache: 'no-store',
    });
    if (!res.ok) throw Error('Fort Worth permit feed unavailable (' + res.status + ')');
    const raw = await res.text();
    if (raw.length > 6_000_000) throw Error('Fort Worth permit response too large');
    const data = obj(JSON.parse(raw) as unknown);
    if (data.error) throw Error('Fort Worth permit feed returned an ArcGIS error');
    if (!Array.isArray(data.features)) throw Error('Fort Worth permit feed missing features');
    const rows = data.features.map((f) => obj(f).attributes);
    const batch = normalizeFortWorth(rows);
    permits.push(...batch.filter((p) => !p.appliedAt || Date.parse(p.appliedAt) >= since.getTime()));
    if (rows.length < 1000 || batch.some((p) => p.appliedAt && Date.parse(p.appliedAt) < since.getTime())) break;
  }
  return permits;
}


/** Official Denton city ArcGIS All_Permits records; coordinates are sourced from
 * ArcGIS point geometry reprojected to WGS84 by outSR=4326.
 */
export function normalizeDenton(rows: unknown[]): RawPermit[] {
  const arcDate = (v: unknown): string | null => {
    if (typeof v === 'number') {
      const d = new Date(v);
      return Number.isFinite(d.getTime()) ? d.toISOString() : null;
    }
    return iso(v);
  };
  return rows.map((raw) => {
    const feature = obj(raw);
    const r = obj(feature.attributes);
    const shape = obj(feature.geometry);
    const lat = typeof shape.y === 'number' && shape.y >= 25 && shape.y <= 37 ? shape.y : null;
    const lon = typeof shape.x === 'number' && shape.x >= -107 && shape.x <= -93 ? shape.x : null;
    return {
      source: 'denton',
      sourceName: 'City of Denton',
      permitNumber: str(r.PERMIT_NO, 60) || str(r.RECORDID, 60),
      city: 'Denton',
      address: str(r.SITE_ADDR, 160) || str(r.SITUS_ADDR, 160) || str(r.SITUS, 160),
      zip: str(r.SITE_ZIP, 10),
      description: str(r.SITE_DESCRIPTION, 400) || str(r.NOTES, 400) || str(r.DESCRIPTION, 400),
      permitType: str(r.PermitType, 80),
      workClass: str(r.PermitSubType, 80),
      landUse: str(r.OCCUPANCY_TYPE, 120),
      status: str(r.STATUS, 80),
      issuedAt: arcDate(r.ISSUED),
      appliedAt: arcDate(r.APPLIED),
      value: num(r.JOBVALUE),
      units: num(r.NO_UNITS),
      contractor: str(r.CONTRACTOR_NAME, 140),
      contractorPhone: '',
      latitude: lat,
      longitude: lon,
      url: 'https://www.cityofdenton.com/237/Permits-Licenses',
    };
  }).filter((p) => p.permitNumber);
}

export async function fetchDenton(since: Date, fetcher: FetchLike): Promise<RawPermit[]> {
  const endpoint = 'https://services.arcgis.com/9dTWrhPzuDPnUVXr/ArcGIS/rest/services/All_Permits/FeatureServer/0/query';
  const fields = [
    'PERMIT_NO', 'RECORDID', 'SITE_ADDR', 'SITUS', 'SITE_ZIP',
    'SITE_DESCRIPTION', 'NOTES', 'DESCRIPTION', 'PermitType', 'PermitSubType',
    'OCCUPANCY_TYPE', 'STATUS', 'ISSUED', 'APPLIED', 'JOBVALUE',
    'NO_UNITS', 'CONTRACTOR_NAME',
  ].join(',');
  const permits: RawPermit[] = [];
  for (let page = 0; page < 5; page++) {
    const url = new URL(endpoint);
    url.searchParams.set('where', '1=1');
    url.searchParams.set('outFields', fields);
    url.searchParams.set('orderByFields', 'APPLIED DESC');
    url.searchParams.set('resultOffset', String(page * 1000));
    url.searchParams.set('resultRecordCount', '1000');
    url.searchParams.set('returnGeometry', 'true');
    url.searchParams.set('outSR', '4326');
    url.searchParams.set('f', 'json');
    const res = await fetcher(url.href, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
      cache: 'no-store',
    });
    if (!res.ok) throw Error('Denton permit feed unavailable (' + res.status + ')');
    const raw = await res.text();
    if (raw.length > 6_000_000) throw Error('Denton permit response too large');
    const data = obj(JSON.parse(raw) as unknown);
    if (data.error) throw Error('Denton permit feed returned an ArcGIS error');
    if (!Array.isArray(data.features)) throw Error('Denton permit feed missing features');
    const batch = normalizeDenton(data.features);
    permits.push(...batch.filter((p) =>
      !p.appliedAt || Date.parse(p.appliedAt) >= since.getTime()));
    if (data.features.length < 1000 ||
        batch.some((p) => p.appliedAt && Date.parse(p.appliedAt) < since.getTime())) break;
  }
  return permits;
}

/** Official City of Arlington "Issued Permits" ArcGIS layer (CC-BY 4.0). The layer's
 * native coordinates are State Plane feet; outSR=4326 reprojects geometry to WGS84.
 * The feed publishes no zip, units, contractor or phone — those stay empty, never guessed.
 */
export function normalizeArlington(rows: unknown[]): RawPermit[] {
  const arcDate = (v: unknown): string | null => {
    if (typeof v === 'number') {
      const d = new Date(v);
      return Number.isFinite(d.getTime()) ? d.toISOString() : null;
    }
    return iso(v);
  };
  return rows
    .map((raw) => {
      const feature = obj(raw);
      const r = obj(feature.attributes);
      const shape = obj(feature.geometry);
      const lat = typeof shape.y === 'number' && shape.y >= 25 && shape.y <= 37 ? shape.y : null;
      const lon = typeof shape.x === 'number' && shape.x >= -107 && shape.x <= -93 ? shape.x : null;
      const year = str(r.FOLDERYEAR, 10);
      const sequence = str(r.FOLDERSEQUENCE, 20);
      return {
        source: 'arlington',
        sourceName: 'City of Arlington',
        permitNumber: year && sequence ? `${year}-${sequence}` : sequence,
        city: 'Arlington',
        address: str(r.FOLDERNAME, 160),
        zip: '',
        description:
          str(r.WORKDESC, 400) || str(r.FOLDERCONDITION, 400) || str(r.SUBDESC, 400),
        permitType: str(r.FOLDERTYPE, 80),
        workClass: str(r.SUBDESC, 80),
        landUse: str(r.LandUseDescription, 120) || str(r.MainUse, 120) || str(r.ZoningUse, 120),
        status: str(r.STATUSDESC, 80),
        issuedAt: arcDate(r.ISSUEDATE),
        appliedAt: arcDate(r.InDate),
        value: num(r.ConstructionValuationDeclared) || num(r.SignConstructionValue),
        units: 0,
        contractor: '',
        contractorPhone: '',
        latitude: lat,
        longitude: lon,
        url: 'https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/1',
      };
    })
    .filter((p) => p.permitNumber);
}

export async function fetchArlington(since: Date, fetcher: FetchLike): Promise<RawPermit[]> {
  const endpoint =
    'https://gis2.arlingtontx.gov/agsext2/rest/services/OpenData/OD_Property/MapServer/1/query';
  const fields = [
    'FOLDERYEAR', 'FOLDERSEQUENCE', 'FOLDERTYPE', 'STATUSDESC', 'ISSUEDATE',
    'SUBDESC', 'WORKDESC', 'FOLDERNAME', 'ConstructionValuationDeclared',
    'MainUse', 'LandUseDescription', 'SignConstructionValue', 'FOLDERCONDITION',
    'ZoningUse', 'InDate',
  ].join(',');
  const permits: RawPermit[] = [];
  for (let page = 0; page < 5; page++) {
    const url = new URL(endpoint);
    url.searchParams.set('where', '1=1');
    url.searchParams.set('outFields', fields);
    url.searchParams.set('orderByFields', 'ISSUEDATE DESC');
    url.searchParams.set('resultOffset', String(page * 1000));
    url.searchParams.set('resultRecordCount', '1000');
    url.searchParams.set('returnGeometry', 'true');
    url.searchParams.set('outSR', '4326');
    url.searchParams.set('f', 'json');
    const res = await fetcher(url.href, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
      cache: 'no-store',
    });
    if (!res.ok) throw Error('Arlington permit feed unavailable (' + res.status + ')');
    const raw = await res.text();
    if (raw.length > 6_000_000) throw Error('Arlington permit response too large');
    const data = obj(JSON.parse(raw) as unknown);
    if (data.error) throw Error('Arlington permit feed returned an ArcGIS error');
    if (!Array.isArray(data.features)) throw Error('Arlington permit feed missing features');
    const batch = normalizeArlington(data.features);
    permits.push(
      ...batch.filter((p) => !p.issuedAt || Date.parse(p.issuedAt) >= since.getTime()),
    );
    if (
      data.features.length < 1000 ||
      batch.some((p) => p.issuedAt && Date.parse(p.issuedAt) < since.getTime())
    )
      break;
  }
  return permits;
}

/** City of San Antonio "PERMITS ISSUED" CKAN resource. One permit number can carry
 * several trade rows, so rows are deduped on permit number + permit type. Coordinates
 * arrive as lon/lat for most rows; State-Plane-looking pairs are dropped, not converted.
 * Only the city-published primary contact is used; no phone is published.
 */
export function normalizeSanAntonio(rows: unknown[]): RawPermit[] {
  const seen = new Set<string>();
  const out: RawPermit[] = [];
  for (const raw of rows) {
    const r = obj(raw);
    const permitNumber = str(r['PERMIT #'], 60);
    const permitType = str(r['PERMIT TYPE'], 80);
    if (!permitNumber) continue;
    // Signs, banners and temporary/event permits are not construction opportunities.
    if (/sign|banner|temporary|special event|food truck|vending/i.test(permitType)) continue;
    const key = permitNumber + '|' + permitType;
    if (seen.has(key)) continue;
    seen.add(key);
    const address = str(r.ADDRESS, 160);
    const zip = /(\d{5})(?:-\d{4})?\s*$/.exec(address)?.[1] ?? '';
    const x = Number(str(r.X_COORD, 30));
    const y = Number(str(r.Y_COORD, 30));
    const lon = Number.isFinite(x) && x >= -107 && x <= -93 ? x : null;
    const lat = Number.isFinite(y) && y >= 25 && y <= 37 ? y : null;
    out.push({
      source: 'sanantonio',
      sourceName: 'City of San Antonio',
      permitNumber,
      city: 'San Antonio',
      address,
      zip,
      description: [str(r['PROJECT NAME'], 200), str(r['WORK TYPE'], 200)]
        .filter(Boolean)
        .join(' – '),
      permitType,
      workClass: str(r['WORK TYPE'], 80),
      landUse: '',
      status: 'Issued',
      issuedAt: iso(r['DATE ISSUED']),
      appliedAt: iso(r['DATE SUBMITTED']),
      value: num(r['DECLARED VALUATION']),
      units: 0,
      contractor: str(r['PRIMARY CONTACT'], 140).replace(/\*+$/, '').trim(),
      contractorPhone: '',
      latitude: lat,
      longitude: lon,
      url: 'https://data.sanantonio.gov/dataset/building-permits',
    });
  }
  return out;
}

export async function fetchSanAntonio(since: Date, fetcher: FetchLike): Promise<RawPermit[]> {
  const resource = 'c21106f9-3ef5-4f3a-8604-f992b4db7512';
  const permits: RawPermit[] = [];
  for (let page = 0; page < 4; page++) {
    const sql =
      `SELECT * FROM "${resource}" WHERE "DATE ISSUED" >= '${day(since)}' ` +
      `ORDER BY "DATE ISSUED" DESC LIMIT 5000 OFFSET ${page * 5000}`;
    const url = new URL('https://data.sanantonio.gov/api/3/action/datastore_search_sql');
    url.searchParams.set('sql', sql);
    const res = await fetcher(url.href, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(12000),
      cache: 'no-store',
    });
    if (!res.ok) throw Error('San Antonio permit feed unavailable (' + res.status + ')');
    const raw = await res.text();
    if (raw.length > 6_000_000) throw Error('San Antonio permit response too large');
    const data = obj(JSON.parse(raw) as unknown);
    if (data.success !== true) throw Error('San Antonio permit feed returned a CKAN error');
    const records = obj(data.result).records;
    if (!Array.isArray(records)) throw Error('San Antonio permit feed missing records');
    permits.push(...normalizeSanAntonio(records));
    if (records.length < 5000) break;
  }
  return permits;
}

/** Houston Permitting Center weekly "sold permits" Excel reports.
 *
 * Houston publishes no per-permit API. The city posts one workbook per week on its public
 * Sold Permits Search page (https://www.houstonpermittingcenter.org/sold-permits-search),
 * usually 1–2 weeks after the permit date. Verified live 2026-11-23: the newest file
 * (Nov 16-22.xlsx, 35,786 bytes) covers permits issued 2026-11-16→2026-11-22 — 385 rows,
 * all with a project number, zip and address; types Building Pmt / Demolition / OCC-BLDG PMT.
 * The file publishes NO contractor, value or applicant, so those stay empty, never guessed.
 * Two April 2026 weeks were HTML tables saved with an .xls extension, so the parser handles
 * both real .xlsx and that HTML variant. Only direct links to the city's own file host are
 * followed — never the Office viewer links, never a login page.
 */
export const HOUSTON_REPORTS_URL = 'https://www.houstonpermittingcenter.org/sold-permits-search';
const HOUSTON_REPORT_HOST = 'www.houstonpermittingcenter.org';
const HOUSTON_MAX_WORKBOOK_BYTES = 5_000_000;
const HOUSTON_MAX_ROWS = 20_000;
const HOUSTON_MAX_WEEKLY_FILES = 5;

const decodeXmlEntities = (s: string): string =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, code: string) => {
    if (code === 'amp') return '&';
    if (code === 'lt') return '<';
    if (code === 'gt') return '>';
    if (code === 'quot') return '"';
    if (code === 'apos') return "'";
    const n = code.startsWith('#x')
      ? parseInt(code.slice(2), 16)
      : parseInt(code.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : m;
  });

function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel stores dates as days since 1899-12-30 (the 1900 leap-year bug is baked in). */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 80000) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000);
  return d.toISOString();
}

function parseXlsxRows(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes);
  const shared: string[] = [];
  if (files['xl/sharedStrings.xml']) {
    const xml = strFromU8(files['xl/sharedStrings.xml']!, true);
    for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      let text = '';
      for (const t of si[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))
        text += decodeXmlEntities(t[1]!);
      shared.push(text);
    }
  }
  const sheetName = Object.keys(files)
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort()[0];
  if (!sheetName) throw Error('Houston Excel file has no worksheet.');
  const xml = strFromU8(files[sheetName]!, true);
  const rows: string[][] = [];
  for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const c of row[1]!.matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!;
      const inner = c[2] ?? '';
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1] ?? '';
      const type = /t="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      let value: string;
      if (type === 's') {
        const idx = Number(/<v>(-?\d+)<\/v>/.exec(inner)?.[1]);
        value = Number.isInteger(idx) ? (shared[idx] ?? '') : '';
      } else if (type === 'inlineStr') {
        value = decodeXmlEntities(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? '');
      } else if (type === 'str') {
        value = decodeXmlEntities(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '');
      } else if (type === 'b') {
        value = /<v>1<\/v>/.test(inner) ? 'TRUE' : 'FALSE';
      } else {
        value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
      }
      const col = columnIndex(ref);
      while (cells.length < col) cells.push('');
      cells[col] = value;
    }
    if (cells.some((v) => v.trim())) rows.push(cells);
    if (rows.length > HOUSTON_MAX_ROWS) throw Error('Houston Excel file has too many rows.');
  }
  return rows;
}

function parseHtmlTableRows(text: string): string[][] {
  const rows: string[][] = [];
  const table = /<table[\s\S]*?<\/table>/i.exec(text)?.[0] ?? text;
  for (const tr of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells: string[] = [];
    for (const td of tr[1]!.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)) {
      cells.push(
        decodeXmlEntities(
          td[1]!.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim(),
        ),
      );
    }
    if (cells.some((v) => v.trim())) rows.push(cells);
    if (rows.length > HOUSTON_MAX_ROWS) throw Error('Houston report has too many rows.');
  }
  if (rows.length === 0) throw Error('Houston report has no table rows.');
  return rows;
}

/** Parse one Houston weekly report: a real .xlsx, or the HTML table the city sometimes saves
 *  with an .xls extension. Returns raw cell strings, title and header rows included. */
export function parseHoustonWorkbook(bytes: Uint8Array): string[][] {
  if (bytes.length === 0 || bytes.length > HOUSTON_MAX_WORKBOOK_BYTES)
    throw Error('Houston report is empty or too large.');
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) return parseXlsxRows(bytes);
  const text = strFromU8(bytes, true).replace(/^\uFEFF/, '');
  if (/^\s*</.test(text)) return parseHtmlTableRows(text);
  throw Error('Houston report is neither an Excel workbook nor an HTML table.');
}

function houstonDate(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) return excelSerialToIso(Number(raw));
  // The file writes dates as 2026/11/16; normalise to ISO before parsing.
  const ymd = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(raw);
  return iso(ymd ? `${ymd[1]}-${ymd[2]}-${ymd[3]}` : raw);
}

/** Normalize parsed Houston rows into RawPermit. The header row is found by name (the file
 *  starts with title rows: "From: …" / "To: …"), columns are matched by header text, rows are
 *  deduped on project number + permit type, and future-dated rows are dropped like Collin. */
export function normalizeHouston(rows: string[][], now: Date): RawPermit[] {
  const latest = now.getTime() + 86_400_000;
  const headerIdx = rows.findIndex(
    (r) => r.some((c) => /permit date/i.test(c)) && r.some((c) => /project no/i.test(c)),
  );
  if (headerIdx < 0) return [];
  const header = rows[headerIdx]!.map((c) => c.trim().toLowerCase());
  const col = (names: string[]): number =>
    header.findIndex((h) => names.some((n) => h.includes(n)));
  const zipCol = col(['zip code', 'zip']);
  const dateCol = col(['permit date']);
  const typeCol = col(['permit type']);
  const projectCol = col(['project no', 'project number']);
  const addressCol = col(['address']);
  const commentsCol = col(['comments', 'description']);
  if (dateCol < 0 || projectCol < 0) return [];
  const seen = new Set<string>();
  const out: RawPermit[] = [];
  for (const row of rows.slice(headerIdx + 1)) {
    const permitNumber = str(row[projectCol], 60);
    const permitType = typeCol >= 0 ? str(row[typeCol], 80) : '';
    if (!permitNumber) continue;
    const key = permitNumber + '|' + permitType;
    if (seen.has(key)) continue;
    seen.add(key);
    const issuedAt = houstonDate(row[dateCol] ?? '');
    if (issuedAt && Date.parse(issuedAt) > latest) continue;
    out.push({
      source: 'houston',
      sourceName: 'City of Houston',
      permitNumber,
      city: 'Houston',
      address: addressCol >= 0 ? str(row[addressCol], 160) : '',
      zip:
        zipCol >= 0
          ? str(row[zipCol], 10).replace(/\D/g, '').slice(0, 5)
          : '',
      description: commentsCol >= 0 ? str(row[commentsCol], 400) : '',
      permitType,
      workClass: '',
      landUse: '',
      status: 'Issued',
      issuedAt,
      appliedAt: null,
      value: 0,
      units: 0,
      contractor: '',
      contractorPhone: '',
      url: HOUSTON_REPORTS_URL,
    });
  }
  return out;
}

const HOUSTON_MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sept: 8,
  sep: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

/** Week-end date encoded in a report filename, e.g. "Nov 16-22.xlsx" or "Oct 26 - Nov 01.xlsx". */
export function houstonReportWeekEnd(filename: string, year: number): Date | null {
  const months = Object.keys(HOUSTON_MONTHS).join('|');
  const range = new RegExp(
    `(${months})\\s*(\\d{1,2})\\s*[-_\u2013]\\s*(?:(${months})\\s*)?(\\d{1,2})`,
    'i',
  ).exec(filename);
  if (range) {
    const endMonth = HOUSTON_MONTHS[(range[3] ?? range[1])!.toLowerCase()]!;
    return new Date(Date.UTC(year, endMonth, Number(range[4])));
  }
  const single = new RegExp(`(${months})\\s*(\\d{1,2})`, 'i').exec(filename);
  if (single) {
    return new Date(
      Date.UTC(year, HOUSTON_MONTHS[single[1]!.toLowerCase()]!, Number(single[2])),
    );
  }
  return null;
}

export interface HoustonReportFile {
  url: string;
  weekEnd: Date | null;
  label: string;
}

/** Newest weekly sold-permit workbooks, newest first. The city posts one file per week under
 *  dated folders with no stable filename, so the public report index page is read to find them.
 *  Only direct links to the city's own file host are followed — never the Office viewer. */
export async function discoverHoustonReportFiles(
  fetcher: FetchLike,
  limit = HOUSTON_MAX_WEEKLY_FILES,
): Promise<HoustonReportFile[]> {
  const res = await fetcher(HOUSTON_REPORTS_URL, {
    method: 'GET',
    redirect: 'error',
    headers: { accept: 'text/html' },
    signal: AbortSignal.timeout(12000),
    cache: 'no-store',
  });
  if (!res.ok) throw Error('Houston report index unavailable (' + res.status + ').');
  const html = await res.text();
  if (html.length > 1_000_000) throw Error('Houston report index too large.');
  const found: HoustonReportFile[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/href="([^"]+)"/gi)) {
    const raw = m[1]!;
    if (!/\.xlsx?$/i.test(raw.split('?')[0]!)) continue;
    let url: URL;
    try {
      url = new URL(raw, HOUSTON_REPORTS_URL);
    } catch {
      continue;
    }
    if (url.hostname.toLowerCase() !== HOUSTON_REPORT_HOST) continue;
    if (!/^\/sites\/g\/files\/nwywnm431\/files\/20\d\d-\d\d\//.test(url.pathname)) continue;
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const year = Number(/\/files\/(20\d\d)-\d\d\//.exec(url.pathname)?.[1] ?? 0) || 0;
    const filename = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
    found.push({
      url: url.href,
      weekEnd: year ? houstonReportWeekEnd(filename, year) : null,
      label: filename,
    });
  }
  if (found.length === 0) throw Error('Houston report index lists no weekly files.');
  const dated = found.filter((f) => f.weekEnd);
  if (!dated.length) return found.slice(-limit).reverse();
  return dated
    .sort((a, b) => (b.weekEnd?.getTime() ?? 0) - (a.weekEnd?.getTime() ?? 0))
    .slice(0, limit);
}

/** Fetch Houston permits for the window. One weekly file covers one week, so the newest
 *  few files are read until the window is covered (at most five weeks); rows are deduped
 *  across files on project number + permit type. */
export async function fetchHouston(
  since: Date,
  now: Date,
  fetcher: FetchLike,
): Promise<RawPermit[]> {
  const files = await discoverHoustonReportFiles(fetcher);
  const seen = new Set<string>();
  const out: RawPermit[] = [];
  for (const file of files) {
    const res = await fetcher(file.url, {
      method: 'GET',
      redirect: 'error',
      headers: {
        accept:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel, text/html',
      },
      signal: AbortSignal.timeout(12000),
      cache: 'no-store',
    });
    if (!res.ok) throw Error('Houston weekly report unavailable (' + res.status + ').');
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > HOUSTON_MAX_WORKBOOK_BYTES)
      throw Error('Houston weekly report too large.');
    const permits = normalizeHouston(parseHoustonWorkbook(buf), now);
    for (const p of permits) {
      const key = p.permitNumber + '|' + p.permitType;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!p.issuedAt || Date.parse(p.issuedAt) >= since.getTime()) out.push(p);
    }
    // Once a file reaches back before the window, older weeks add nothing in range.
    const earliest = permits
      .map((p) => p.issuedAt)
      .filter(Boolean)
      .sort()[0];
    if (earliest && Date.parse(earliest) < since.getTime()) break;
    if (out.length >= 5000) break;
  }
  return out;
}

/** City of Carrollton monthly permit report (PDF).
 *
 * Carrollton publishes no permit API. The city posts one PDF a month — the
 * "previous month" report — at a fixed public URL. Verified live 2026-11-27:
 * report dated 2026-11-01, 110 pages, covering October 2026 permits, with
 * Date Entered, Permit Number, Permit Type, Property Address, Job
 * Description, Applicant Name, Valuation, Permit Status and Date Issued.
 * The same permit can repeat across pages (one row per review step), so rows
 * are deduped on permit number. The applicant is published as the applicant,
 * not as a hired contractor, so it is carried in the description and the
 * contractor field stays empty. Leads from this source are ~4–5 weeks old by
 * design (monthly cadence) and are labeled that way everywhere they appear.
 */
export const CARROLLTON_REPORT_URL =
  'https://webrpts.cityofcarrollton.com/bldg_insp/results/permit_reports/previous_month.pdf';
const CARROLLTON_MAX_PDF_BYTES = 25 * 1024 * 1024;
const CARROLLTON_MAX_RECORDS = 5000;

export interface CarrolltonRecord {
  permitNumber: string;
  permitType: string;
  address: string;
  zip: string;
  /** Date the application was entered (ISO), when printed. */
  dateEntered: string | null;
  /** Date the permit was issued (ISO), when printed. */
  dateIssued: string | null;
  /** Published valuation in dollars; 0 when the report prints $0 or none. */
  valuation: number;
  status: string;
  applicant: string;
  description: string;
}

const CARROLLTON_PERMIT_NUMBER = /\bPR[A-Z]{2}\d{9}\b/g;
// \b matters: without it the street number can match the digits inside the
// permit number itself ("PRSE202601539 Special Event 2001 Kelly Blvd...").
const CARROLLTON_ADDRESS =
  /\b(\d{1,6}\s+[A-Za-z0-9 .'-]+?,\s*(?:Suite:?\s*[\w-]+,\s*)?Carrollton,\s*TX\s*(750\d{2}))/;
const CARROLLTON_DATE = /(\d{1,2})\/(\d{1,2})\/(\d{4})/g;

function carrolltonIso(m: RegExpMatchArray): string | null {
  const d = new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2])));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function carrolltonValuation(text: string): { value: number; index: number } | null {
  // The report prints valuations like $4,400,000.00; the cents can land on the
  // next text run ("$4,400,000 .00"), so allow whitespace before the dot.
  const m = /\$\s?([\d,]+)(?:\s*\.\s*(\d{2}))?/.exec(text);
  if (!m) return null;
  const value = Number(m[1]!.replace(/,/g, ''));
  return Number.isFinite(value) ? { value, index: m.index } : null;
}

function carrolltonApplicant(text: string, valuationIndex: number): string {
  // The applicant name directly precedes the valuation in the detail block
  // ("Tony Trammell $0.00"). Accept only a short run of capitalized name
  // tokens; anything else stays blank rather than guessing a name out of the
  // job description.
  const before = text.slice(Math.max(0, valuationIndex - 80), valuationIndex).trim();
  const m = /([A-Z][A-Za-z.'-]*(?:\s+(?:[A-Z][A-Za-z.'-]*|of|the|and|&)){1,4})\s*$/.exec(before);
  if (!m) return '';
  const name = m[1]!.trim();
  if (name.length < 3 || name.length > 60 || /\d/.test(name)) return '';
  return name;
}

function carrolltonDetail(text: string): {
  valuation: number;
  status: string;
  dateIssued: string | null;
  applicant: string;
  description: string;
} {
  const found = carrolltonValuation(text);
  const valuation = found?.value ?? 0;
  const applicant = found ? carrolltonApplicant(text, found.index) : '';
  // Whichever status word the block prints first wins — a window can reach
  // into the next record's block, whose status is not this record's.
  const issuedAt = text.search(/Permit\(s\)\s*Issued/);
  const closedAt = text.search(/\bClosed\b/);
  const status =
    issuedAt >= 0 && (closedAt < 0 || issuedAt < closedAt)
      ? 'Issued'
      : closedAt >= 0
        ? 'Closed'
        : '';
  // Date issued: the first date printed after the valuation/status area;
  // fall back to the last date in the block.
  const dates = [...text.matchAll(CARROLLTON_DATE)];
  let dateIssued: string | null = null;
  if (found) {
    const after = dates.find((d) => (d.index ?? 0) > found.index);
    dateIssued = after ? carrolltonIso(after) : null;
  }
  if (!dateIssued && dates.length > 0) dateIssued = carrolltonIso(dates[dates.length - 1]!);
  const description = text
    .replace(/\$\s?[\d,]+(?:\s*\.\s*\d{2})?/g, ' ')
    .replace(/Permit\(s\)\s*Issued/g, ' ')
    .replace(/\bClosed\b/g, ' ')
    .replace(CARROLLTON_DATE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
  return { valuation, status, dateIssued, applicant, description };
}

/** Parse the extracted text of one Carrollton monthly report. Pure: the caller
 *  supplies text from the PDF text layer. Records are anchored on permit
 *  numbers (PR + 2 letters + 9 digits); the detail block (description,
 *  applicant, valuation, status, date issued) repeats the street address, so
 *  details are matched back to records by that address. */
export function parseCarrolltonReportText(text: string): {
  reportDate: string | null;
  coverageMonth: string | null;
  records: CarrolltonRecord[];
} {
  const flat = text.replace(/\s+/g, ' ');
  const reportMatch = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+Monthly Permit Report/.exec(flat);
  const reportDate = reportMatch ? carrolltonIso(reportMatch) : null;
  let coverageMonth: string | null = null;
  if (reportDate) {
    const d = new Date(reportDate);
    const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
    coverageMonth = prev.toISOString().slice(0, 7);
  }

  const numberMatches = [...flat.matchAll(CARROLLTON_PERMIT_NUMBER)];
  interface Header {
    permitNumber: string;
    permitType: string;
    address: string;
    zip: string;
    dateEntered: string | null;
    start: number;
    segment: string;
  }
  const headers: Header[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < numberMatches.length && headers.length < CARROLLTON_MAX_RECORDS; i++) {
    const match = numberMatches[i]!;
    const permitNumber = match[0];
    if (seen.has(permitNumber)) continue;
    seen.add(permitNumber);
    const start = match.index ?? 0;
    const end = numberMatches[i + 1]?.index ?? flat.length;
    const segment = flat.slice(start, Math.min(end, start + 4000));

    // Date entered is printed immediately before the permit number.
    const before = flat.slice(Math.max(0, start - 40), start);
    const enteredMatches = [...before.matchAll(CARROLLTON_DATE)];
    const dateEntered = enteredMatches.length
      ? carrolltonIso(enteredMatches[enteredMatches.length - 1]!)
      : null;

    const afterNumber = segment.slice(permitNumber.length);
    const addressMatch = CARROLLTON_ADDRESS.exec(afterNumber);
    const address = addressMatch ? addressMatch[1]!.replace(/\s+/g, ' ').trim() : '';
    const zip = addressMatch ? addressMatch[2]! : '';
    const typeEnd = addressMatch ? (addressMatch.index ?? 0) : Math.min(afterNumber.length, 60);
    const permitType = afterNumber
      .slice(0, typeEnd)
      .replace(/CADID:.*$/i, '')
      .replace(/County:.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
    headers.push({ permitNumber, permitType, address, zip, dateEntered, start, segment });
  }

  const streets = headers
    .map((h) => h.address.split(',')[0]?.trim() ?? '')
    .filter((s) => s.length >= 6);
  const records: CarrolltonRecord[] = headers.map((h) => {
    let detail = carrolltonDetail(h.segment.slice(h.permitNumber.length));
    const street = h.address.split(',')[0]?.trim() ?? '';
    if (street.length >= 6) {
      // The detail block repeats the street address. Header rows repeat it
      // too (the report prints a record once per review step), but a header
      // occurrence is followed by "CADID:" — skip those.
      let from = flat.indexOf(street, h.start);
      let detailAt = -1;
      while (from >= 0) {
        const next = flat.indexOf(street, from + street.length);
        if (next < 0) break;
        if (!flat.slice(next, next + 160).includes('CADID')) {
          detailAt = next;
          break;
        }
        from = next;
      }
      if (detailAt >= 0) {
        // Cut the block at the next record's street address so one record's
        // valuation/status never bleeds into another's.
        let cut = detailAt + 900;
        for (const other of streets) {
          if (other === street) continue;
          const at = flat.indexOf(other, detailAt + street.length);
          if (at >= 0 && at < cut) cut = at;
        }
        const fromDetail = carrolltonDetail(flat.slice(detailAt, cut));
        // Prefer the detail block when it carries a valuation or a status;
        // the header segment alone rarely does.
        if (fromDetail.valuation > 0 || fromDetail.status || fromDetail.dateIssued) {
          detail = fromDetail;
        }
      }
    }
    return {
      permitNumber: h.permitNumber,
      permitType: h.permitType,
      address: h.address,
      zip: h.zip,
      dateEntered: h.dateEntered,
      dateIssued: detail.dateIssued,
      valuation: detail.valuation,
      status: detail.status,
      applicant: detail.applicant,
      description: detail.description,
    };
  });
  return { reportDate, coverageMonth, records };
}

/** Normalize parsed Carrollton records into RawPermit. Future-dated rows are
 *  dropped like the other sources; the applicant is carried in the
 *  description, never as a hired contractor. */
export function normalizeCarrollton(records: CarrolltonRecord[], now: Date): RawPermit[] {
  const latest = now.getTime() + 86_400_000;
  const out: RawPermit[] = [];
  for (const r of records) {
    if (r.dateIssued && Date.parse(r.dateIssued) > latest) continue;
    const description = [r.applicant ? `Applicant: ${r.applicant}.` : '', r.description]
      .filter(Boolean)
      .join(' ')
      .slice(0, 400);
    out.push({
      source: 'carrollton',
      sourceName: 'City of Carrollton',
      permitNumber: r.permitNumber,
      city: 'Carrollton',
      address: r.address.replace(/,\s*Carrollton,\s*TX\s*750\d{2}$/i, '').slice(0, 160),
      zip: r.zip,
      description,
      permitType: r.permitType,
      workClass: '',
      landUse: '',
      status: r.status,
      issuedAt: r.dateIssued,
      appliedAt: r.dateEntered,
      value: r.valuation,
      units: 0,
      contractor: '',
      contractorPhone: '',
      url: CARROLLTON_REPORT_URL,
    });
  }
  return out;
}

export async function fetchCarrollton(
  since: Date,
  now: Date,
  fetcher: FetchLike,
): Promise<RawPermit[]> {
  const res = await fetcher(CARROLLTON_REPORT_URL, {
    method: 'GET',
    redirect: 'error',
    headers: { accept: 'application/pdf' },
    signal: AbortSignal.timeout(30_000),
    cache: 'no-store',
  });
  if (!res.ok) throw Error('Carrollton monthly report unavailable (' + res.status + ').');
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length === 0 || buf.length > CARROLLTON_MAX_PDF_BYTES)
    throw Error('Carrollton monthly report is empty or too large.');
  const { text } = await extractPdfText(buf, {
    maxPages: 250,
    maxChars: 3_000_000,
    timeoutMs: 30_000,
  });
  const { records } = parseCarrolltonReportText(text);
  const permits = normalizeCarrollton(records, now);
  return permits.filter((p) => !p.issuedAt || Date.parse(p.issuedAt) >= since.getTime());
}

/** City of Irving permits — HISTORICAL layer only.
 *
 * Irving's two open-data permit tables (residential + commercial, ArcGIS
 * FeatureServer) stopped updating in March 2025: both report
 * lastEditDate 2025-03-12 and the newest permit is dated 2025-02-28
 * (verified live 2026-11-27). The feeds still answer, so they are wired like
 * Denton's — but every view labels them historical, the freshness cadence
 * marks them stale, and the funnel never treats them as call leads. The
 * tables publish no contractor — that field stays empty, never guessed.
 */
const IRVING_SERVICES = [
  'https://services3.arcgis.com/OfsJXUlu8pSkbl7B/ArcGIS/rest/services/Residential_Permits_Issued_Feb_15_2022_Present/FeatureServer/0/query',
  'https://services3.arcgis.com/OfsJXUlu8pSkbl7B/ArcGIS/rest/services/Commercial_Permits_Issued_2_15_22_Present/FeatureServer/0/query',
];
const IRVING_PORTAL_URL = 'https://data-cityofirving.opendata.arcgis.com/';

export function normalizeIrving(rows: unknown[]): RawPermit[] {
  const arcDate = (v: unknown): string | null => {
    if (typeof v === 'number') {
      const d = new Date(v);
      return Number.isFinite(d.getTime()) ? d.toISOString() : null;
    }
    return iso(v);
  };
  return rows
    .map((raw) => {
      const r = obj(obj(raw).attributes);
      const rawAddress = str(r.Address, 160);
      const addrMatch = /^(.*?),\s*IRVING\s+TX\s*(\d{5})?/i.exec(rawAddress);
      return {
        source: 'irving',
        sourceName: 'City of Irving',
        permitNumber: str(r.Permit__, 60),
        city: 'Irving',
        address: addrMatch ? addrMatch[1]!.trim() : rawAddress,
        zip: addrMatch?.[2] ?? '',
        description: str(r.Project_Description, 400),
        permitType: str(r.Permit_Type, 80),
        workClass: str(r.Designation, 80),
        landUse: '',
        status: str(r.Status, 80),
        issuedAt: arcDate(r.Issued_Date),
        appliedAt: null,
        value: num(r.Valuation),
        units: 0,
        contractor: '',
        contractorPhone: '',
        url: IRVING_PORTAL_URL,
      };
    })
    .filter((p) => p.permitNumber);
}

export async function fetchIrving(since: Date, fetcher: FetchLike): Promise<RawPermit[]> {
  const fields = [
    'Issued_Date', 'Permit__', 'Permit_Type', 'Address', 'Valuation',
    'Project_Description', 'Designation', 'Status',
  ].join(',');
  const seen = new Set<string>();
  const permits: RawPermit[] = [];
  for (const endpoint of IRVING_SERVICES) {
    for (let page = 0; page < 2; page++) {
      const url = new URL(endpoint);
      url.searchParams.set('where', '1=1');
      url.searchParams.set('outFields', fields);
      url.searchParams.set('orderByFields', 'Issued_Date DESC');
      url.searchParams.set('resultOffset', String(page * 1000));
      url.searchParams.set('resultRecordCount', '1000');
      url.searchParams.set('returnGeometry', 'false');
      url.searchParams.set('f', 'json');
      const res = await fetcher(url.href, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(12000),
        cache: 'no-store',
      });
      if (!res.ok) throw Error('Irving permit feed unavailable (' + res.status + ')');
      const raw = await res.text();
      if (raw.length > 6_000_000) throw Error('Irving permit response too large');
      const data = obj(JSON.parse(raw) as unknown);
      if (data.error) throw Error('Irving permit feed returned an ArcGIS error');
      if (!Array.isArray(data.features)) throw Error('Irving permit feed missing features');
      const batch = normalizeIrving(data.features);
      for (const p of batch) {
        if (seen.has(p.permitNumber)) continue;
        seen.add(p.permitNumber);
        if (!p.issuedAt || Date.parse(p.issuedAt) >= since.getTime()) permits.push(p);
      }
      if (data.features.length < 1000 ||
          batch.some((p) => p.issuedAt && Date.parse(p.issuedAt) < since.getTime())) break;
    }
  }
  return permits;
}

export interface SourceFetcherContext {
  fetch: FetchLike;
  since: Date;
  now: Date;
}
export type SourceFetcherFn = (ctx: SourceFetcherContext) => Promise<RawPermit[]>;

/** One fetcher per live source, used by the daily freshness refresh (freshness.ts).
 *  Every id in LIVE_SOURCES must have an entry here. */
export const fetchers: Record<string, SourceFetcherFn> = {
  austin: ({ fetch: f, since }) => fetchAustin(since, f),
  dallas: ({ fetch: f, since, now }) => fetchDallas(since, now, f),
  collin: ({ fetch: f, since, now }) => fetchCollin(since, now, f),
  fortworth: ({ fetch: f, since }) => fetchFortWorth(since, f),
  denton: ({ fetch: f, since }) => fetchDenton(since, f),
  arlington: ({ fetch: f, since }) => fetchArlington(since, f),
  sanantonio: ({ fetch: f, since }) => fetchSanAntonio(since, f),
  houston: ({ fetch: f, since, now }) => fetchHouston(since, now, f),
  carrollton: ({ fetch: f, since, now }) => fetchCarrollton(since, now, f),
  irving: ({ fetch: f, since }) => fetchIrving(since, f),
};
