// Texas license leads from TDLR's public license file (data.texas.gov dataset 7358-krk7, Socrata,
// free, no key). Texas does not license general contractors, roofers or concrete companies, so the
// contractor licenses here are A/C, electrical, sign, elevator, appliance and water-well. The date
// is the LICENSE expiration date. TDLR does not publish insurance policy dates.

export const TDLR_URL = 'https://data.texas.gov/resource/7358-krk7.json';

/** Contractor (business) license types, with how strongly each fits construction work (0-1). */
export const TDLR_CONTRACTOR_TYPES: Record<string, { label: string; weight: number }> = {
  'A/C Contractor': { label: 'A/C and refrigeration contractor', weight: 1 },
  'Electrical Contractor': { label: 'electrical contractor', weight: 1 },
  'Electrical Sign Contractor': { label: 'electrical sign contractor', weight: 0.6 },
  'Elevator Contractor': { label: 'elevator contractor', weight: 0.6 },
  'Appliance Installation Contractor': { label: 'appliance installation contractor', weight: 0.5 },
  'Water Well Driller/Pump Installer': { label: 'water well driller', weight: 0.5 },
};
export const TDLR_TYPE_KEYS = Object.keys(TDLR_CONTRACTOR_TYPES);
export const DEFAULT_LICENSE_COUNTIES = ['DALLAS', 'COLLIN', 'DENTON', 'TARRANT'];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** SoQL for contractor licenses expiring between today and today + days, in the given counties. */
export function tdlrQuery(input: {
  types: string[];
  counties: string[];
  days: number;
  limit: number;
  offset?: number;
  today?: Date;
}): string {
  const today = input.today ?? new Date();
  const months: string[] = [];
  const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const end = new Date(today.getTime() + input.days * 86_400_000);
  while (cursor <= end && months.length < 14) {
    months.push(
      `${String(cursor.getUTCMonth() + 1).padStart(2, '0')}/%/${cursor.getUTCFullYear()}`,
    );
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
  const types = (input.types.length ? input.types : TDLR_TYPE_KEYS).filter(
    (t) => t in TDLR_CONTRACTOR_TYPES,
  );
  // The expiration column is text (mm/dd/yyyy): the query keeps the months in the window and the
  // exact day window is applied after download (normalizeTdlr).
  const where = [
    `(${months.map((m) => `license_expiration_date_mmddccyy like ${q(m)}`).join(' OR ')})`,
    `license_type in (${types.map(q).join(',')})`,
    `business_name IS NOT NULL`,
    ...(input.counties.length
      ? [`upper(business_county) in (${input.counties.map((c) => q(c.toUpperCase())).join(',')})`]
      : []),
  ].join(' AND ');
  const params = new URLSearchParams({
    $where: where,
    $limit: String(input.limit),
    $offset: String(input.offset ?? 0),
    $order: 'license_number',
  });
  return `${TDLR_URL}?${params}`;
}

export interface LicenseLead {
  sourceId: string;
  name: string;
  ownerName: string | null;
  licenseType: string;
  licenseNumber: string;
  expiresOn: string;
  phone: string | null;
  address: string;
  city: string;
  county: string | null;
}

type Obj = Record<string, unknown>;
const s = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** mm/dd/yyyy -> yyyy-mm-dd, or null. */
export function parseTdlrDate(v: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

export function formatPhone(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : null;
}

const title = (v: string) => v.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());

/** Rows -> leads whose license expires between today and today + days (inclusive).
 *  With `ignoreExpiry`, the expiry window is skipped entirely and expiresOn is '' when the
 *  row has no parseable date — used by the decision-maker name lookup, where a license
 *  holder is still the license holder even when the license has lapsed. Default is the
 *  outreach behaviour: only licenses expiring inside the window. */
export function normalizeTdlr(
  rows: unknown,
  days: number,
  today = new Date(),
  opts: { ignoreExpiry?: boolean } = {},
): LicenseLead[] {
  if (!Array.isArray(rows)) return [];
  const start = isoDay(today);
  const end = isoDay(new Date(today.getTime() + days * 86_400_000));
  const out: LicenseLead[] = [];
  for (const raw of rows) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Obj;
    const type = s(r.license_type, 80);
    const number = s(r.license_number, 40);
    const name = s(r.business_name);
    const expires = parseTdlrDate(s(r.license_expiration_date_mmddccyy, 10));
    if (!type || !number || !name) continue;
    if (!opts.ignoreExpiry && (!expires || expires < start || expires > end)) continue;
    const csz = s(r.business_city_state_zip, 120) || s(r.mailing_address_city_state_zip, 120);
    const city = /^(.*?)\s+TX\b/i.exec(csz)?.[1] ?? '';
    const line1 = s(r.business_address_line1, 150) || s(r.mailing_address_line1, 150);
    const owner = s(r.owner_name);
    out.push({
      sourceId: `${type}#${number}`,
      name: title(name),
      ownerName: owner && owner.toUpperCase() !== name.toUpperCase() ? title(owner) : null,
      licenseType: type,
      licenseNumber: number,
      expiresOn: expires ?? '',
      phone: formatPhone(s(r.business_telephone, 30)) ?? formatPhone(s(r.owner_telephone, 30)),
      address: [line1, csz]
        .filter(Boolean)
        .map(title)
        .join(', ')
        .replace(/\bTx\b/, 'TX'),
      city: title(city),
      county: s(r.business_county, 60) || s(r.mailing_address_county, 60) || null,
    });
  }
  return out;
}

/**
 * SoQL for contractor licenses whose business name contains the given name (case-insensitive).
 * This is only a coarse pre-filter — the caller must still check an exact/normalized name
 * match, because LIKE '%NAME%' also returns longer names that merely contain it. Restricted
 * to the contractor license types, so a roofer or general contractor with no TDLR license
 * simply returns nothing. Wildcards in the name are stripped so they cannot widen the match.
 */
export function tdlrNameQuery(name: string, limit = 25): string {
  const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
  const needle = name.replace(/[%_]/g, '').trim().slice(0, 120).toUpperCase();
  const where = [
    `upper(business_name) like ${q(`%${needle}%`)}`,
    `license_type in (${TDLR_TYPE_KEYS.map(q).join(',')})`,
    `business_name IS NOT NULL`,
  ].join(' AND ');
  const params = new URLSearchParams({
    $where: where,
    $limit: String(Math.max(1, Math.min(100, limit))),
    $order: 'license_number',
  });
  return `${TDLR_URL}?${params}`;
}

/**
 * Look up contractor licenses by business name in the public TDLR file. Never throws:
 * a failed fetch, a bad payload or an empty name returns []. The expiry window is ignored
 * here — the license holder is the decision-maker whether the license is current or lapsed;
 * callers show expiresOn so the user can see a lapsed license for what it is.
 */
export async function lookupTdlrByName(
  name: string,
  fetcher: typeof fetch = fetch,
  opts: { limit?: number; today?: Date } = {},
): Promise<LicenseLead[]> {
  if (!name.trim()) return [];
  try {
    const res = await fetcher(tdlrNameQuery(name, opts.limit), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    if (!res.ok) return [];
    const rows = JSON.parse(await res.text()) as unknown;
    return normalizeTdlr(rows, 0, opts.today ?? new Date(), { ignoreExpiry: true });
  } catch {
    return [];
  }
}

/**
 * Lead score 1-100. Trade fit 40%, how soon the license expires 30% (sooner = higher, they are
 * paying attention to paperwork now), reachability 30% (phone 20, a business separate from a
 * person's name 10). TDLR publishes no business start date, so business age is not used.
 */
export function scoreLead(lead: LicenseLead, days: number, today = new Date()): number {
  const fit = TDLR_CONTRACTOR_TYPES[lead.licenseType]?.weight ?? 0.3;
  const left = Math.max(0, (Date.parse(lead.expiresOn) - Date.parse(isoDay(today))) / 86_400_000);
  const soon = 1 - Math.min(1, left / Math.max(days, 1));
  const reach = (lead.phone ? 20 : 0) + (lead.ownerName ? 10 : 0);
  return Math.max(1, Math.min(100, Math.round(fit * 40 + soon * 30 + reach)));
}

export const DEFAULT_CALL_SCRIPT = `Hi, is this {{owner_first}}? This is {{sender}} with {{my_company}}, a Texas contractor here in the area.

I'm calling {{business}} because we work alongside {{trade}} companies on residential and commercial jobs, and we are building a short list of reliable partners to bring onto our projects and to send work to.

Do you have a minute? I'd like to know what kind of jobs you take on, and whether you'd want us to send you bid invitations when we have {{trade}} scope. What's the best email for your estimating or bid team?

(If busy:) No problem. Can I email you the details and call back later this week?

Close: Thanks, {{owner_first}}. I'll send that over today from {{my_company}}. My number is {{my_phone}}.`;

export interface ScriptVars {
  business: string;
  owner: string | null;
  licenseType: string;
  expiresOn: string | null;
  city: string;
  myCompany: string;
  myPhone: string;
  sender: string;
}

/** Fill a call script. Unknown placeholders are left as written so nothing is invented. */
export function renderCallScript(template: string, v: ScriptVars, today = new Date()): string {
  const first = v.owner
    ? v.owner.includes(',')
      ? v.owner.split(',')[1]!.trim().split(' ')[0]
      : v.owner.split(' ')[0]
    : null;
  const left = v.expiresOn
    ? Math.round((Date.parse(v.expiresOn) - Date.parse(isoDay(today))) / 86_400_000)
    : null;
  const map: Record<string, string> = {
    business: v.business,
    owner_first: first || 'the owner',
    trade: TDLR_CONTRACTOR_TYPES[v.licenseType]?.label ?? v.licenseType.toLowerCase(),
    license_type: v.licenseType,
    expires: v.expiresOn ?? 'unknown',
    days_left: left === null ? 'unknown' : String(left),
    city: v.city || 'your area',
    my_company: v.myCompany || 'our company',
    my_phone: v.myPhone || 'the number I called from',
    sender: v.sender || v.myCompany || 'me',
  };
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (all, key: string) => map[key] ?? all);
}
