// Live public permit feeds for Texas. Built-in feeds use fixed official hosts. A company can add
// any other Texas city's Socrata open-data permit feed; those URLs are checked so the server never
// calls private or internal addresses.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { RawPermit } from './engine';

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
    note: 'Published by the City of Dallas. The city updates this file on its own schedule, so recent weeks can be missing.',
  },
  {
    id: 'denton',
    name: 'City of Denton – All Permits',
    cities: ['Denton'],
    url: 'https://www.cityofdenton.com/237/Permits-Licenses',
    documentation: 'https://services.arcgis.com/9dTWrhPzuDPnUVXr/ArcGIS/rest/services/All_Permits/FeatureServer/0',
    note: 'Official City of Denton ArcGIS permit table with contractor when recorded. This feed does not cover the whole of Denton County.',
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
  status: 'ok' | 'unavailable' | 'rejected';
  count: number;
  latest: string | null;
  message: string;
  permits: RawPermit[];
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
