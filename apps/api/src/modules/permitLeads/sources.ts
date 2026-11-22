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
