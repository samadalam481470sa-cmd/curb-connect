// Pure helpers for bid outreach: the Texas search plan, Google Places results, finding a contact
// email on a company's own website, message templates with the required opt-out footer, and
// reading what a reply means (interested, offer with an amount, declined, remove me).
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const OUTREACH_TRADES = {
  concrete: { label: 'concrete', query: 'concrete contractor' },
  home_builder: { label: 'home building', query: 'home builder' },
  general_contractor: { label: 'general contracting', query: 'general contractor' },
  commercial_construction: {
    label: 'commercial construction',
    query: 'commercial construction company',
  },
  roofing: { label: 'roofing', query: 'roofing contractor' },
  site_work: { label: 'site work and excavation', query: 'excavation contractor' },
  paving: { label: 'paving', query: 'asphalt paving contractor' },
  remodeling: { label: 'remodeling', query: 'remodeling contractor' },
} as const;
export type OutreachTrade = keyof typeof OUTREACH_TRADES;
export const TRADE_KEYS = Object.keys(OUTREACH_TRADES) as OutreachTrade[];
export const DEFAULT_TRADES: OutreachTrade[] = ['concrete', 'home_builder', 'general_contractor'];

/** Texas cities searched in rotation when a company does not pick its own. */
export const TEXAS_CITIES = [
  'Houston',
  'Dallas',
  'Fort Worth',
  'San Antonio',
  'Austin',
  'El Paso',
  'Arlington',
  'Corpus Christi',
  'Plano',
  'Lubbock',
  'Laredo',
  'Irving',
  'Garland',
  'Frisco',
  'McKinney',
  'Amarillo',
  'Grand Prairie',
  'Brownsville',
  'Killeen',
  'Pasadena',
  'McAllen',
  'Mesquite',
  'Denton',
  'Waco',
  'Carrollton',
  'Midland',
  'Odessa',
  'Round Rock',
  'Abilene',
  'Pearland',
  'Richardson',
  'College Station',
  'Lewisville',
  'Tyler',
  'League City',
  'Beaumont',
  'Allen',
  'Sugar Land',
  'Conroe',
  'New Braunfels',
  'Wichita Falls',
  'San Marcos',
  'Georgetown',
  'Temple',
  'Longview',
  'Katy',
  'The Woodlands',
  'Bryan',
  'Edinburg',
  'San Angelo',
];

export interface SearchStep {
  trade: OutreachTrade;
  city: string;
  query: string;
}

/** Every (city, trade) pair in a fixed order; the cursor walks it one step per search. */
export function searchPlan(trades: string[], cities: string[]): SearchStep[] {
  const useTrades = trades.filter((t): t is OutreachTrade => t in OUTREACH_TRADES);
  const useCities = cities.length ? cities : TEXAS_CITIES;
  const plan: SearchStep[] = [];
  for (const city of useCities) {
    for (const trade of useTrades.length ? useTrades : DEFAULT_TRADES) {
      plan.push({ trade, city, query: `${OUTREACH_TRADES[trade].query} in ${city}, TX` });
    }
  }
  return plan;
}

export interface FoundCompany {
  sourceId: string;
  name: string;
  address: string;
  city: string;
  phone: string | null;
  website: string | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Google Places (New) Text Search -> open Texas businesses only. */
export function normalizePlaces(payload: unknown, fallbackCity: string): FoundCompany[] {
  const list = obj(payload).places;
  if (!Array.isArray(list)) return [];
  const out: FoundCompany[] = [];
  for (const raw of list) {
    const p = obj(raw);
    const id = str(p.id, 300);
    const name = str(obj(p.displayName).text, 200);
    const address = str(p.formattedAddress, 300);
    if (!id || !name) continue;
    if (p.businessStatus === 'CLOSED_PERMANENTLY' || p.businessStatus === 'CLOSED_TEMPORARILY')
      continue;
    if (address && !/,\s*TX\b/.test(address)) continue;
    const cityMatch = /,\s*([^,]+),\s*TX\b/.exec(address);
    const website = safeWebsite(str(p.websiteUri, 500));
    out.push({
      sourceId: id,
      name,
      address,
      city: cityMatch?.[1]?.trim() || fallbackCity,
      phone: str(p.nationalPhoneNumber, 40) || null,
      website,
    });
  }
  return out;
}

export function safeWebsite(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.origin + url.pathname;
  } catch {
    return null;
  }
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,24}/gi;
const BAD_EMAIL =
  /\.(png|jpe?g|gif|webp|svg|css|js)$|^(example|test|user|name|email|your)@|@(example|domain|email|sentry|wixpress|sentry-next)\.|@[0-9]+x\./i;
const PREFERRED = [
  'bids',
  'bid',
  'estimating',
  'estimates',
  'estimator',
  'preconstruction',
  'precon',
  'admin',
  'office',
  'info',
  'contact',
  'sales',
  'hello',
];

/** Contact emails found in a page, best first (bid desk, estimating, admin, office, info). */
export function extractEmails(html: string, siteHost?: string): string[] {
  const decoded = html
    .replace(/&#64;|&#x40;|\[at\]|\(at\)/gi, '@')
    .replace(/mailto:/gi, ' ')
    .replace(/%40/g, '@');
  const found = new Set<string>();
  for (const m of decoded.matchAll(EMAIL)) {
    const email = m[0].toLowerCase().replace(/^[.]+|[.]+$/g, '');
    if (email.length > 254 || BAD_EMAIL.test(email)) continue;
    found.add(email);
  }
  const host = siteHost?.replace(/^www\./, '').toLowerCase();
  const score = (e: string) => {
    const [local = '', domain = ''] = e.split('@');
    let s = 0;
    const idx = PREFERRED.findIndex((p) => local === p || local.startsWith(p));
    if (idx >= 0) s += 100 - idx * 5;
    if (host && (domain === host || domain.endsWith('.' + host))) s += 50;
    return s;
  };
  return [...found].sort((a, b) => score(b) - score(a)).slice(0, 5);
}

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateAddress(v.slice(7));
  return (
    v === '::' ||
    v === '::1' ||
    v.startsWith('fc') ||
    v.startsWith('fd') ||
    v.startsWith('fe8') ||
    v.startsWith('fe9') ||
    v.startsWith('fea') ||
    v.startsWith('feb')
  );
}

/** Only public hosts may be fetched, so a planted website URL cannot reach internal services. */
export async function assertPublicHost(hostname: string): Promise<void> {
  if (isIP(hostname)) {
    if (privateAddress(hostname)) throw new Error('private address');
    return;
  }
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(hostname)) throw new Error('private host');
  const addrs = await lookup(hostname, { all: true });
  if (!addrs.length || addrs.some((a) => privateAddress(a.address)))
    throw new Error('private address');
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function fetchPage(url: string, fetchImpl: FetchLike, hops = 2): Promise<string> {
  const target = new URL(url);
  if (target.protocol !== 'https:' && target.protocol !== 'http:') return '';
  if (target.port && target.port !== '80' && target.port !== '443') return '';
  await assertPublicHost(target.hostname);
  const res = await fetchImpl(target.toString(), {
    redirect: 'manual',
    headers: { 'User-Agent': 'FieldPro-Outreach/1.0 (+contact lookup)', Accept: 'text/html' },
    signal: AbortSignal.timeout(7000),
  });
  if (res.status >= 300 && res.status < 400 && hops > 0) {
    const next = res.headers.get('location');
    return next ? fetchPage(new URL(next, target).toString(), fetchImpl, hops - 1) : '';
  }
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return '';
  const text = await res.text();
  return text.slice(0, 400_000);
}

/** Look at the home page, then common contact pages, for a published contact email. */
export async function findWebsiteEmail(
  website: string,
  fetchImpl: FetchLike = fetch,
): Promise<string | null> {
  let base: URL;
  try {
    base = new URL(website);
  } catch {
    return null;
  }
  const pages = ['/', '/contact', '/contact-us', '/about'];
  for (const path of pages) {
    try {
      const html = await fetchPage(new URL(path, base.origin).toString(), fetchImpl);
      const emails = extractEmails(html, base.hostname);
      if (emails[0]) return emails[0];
    } catch {
      // try the next page
    }
  }
  return null;
}

export const DEFAULT_SUBJECT = 'Bid list request: {{trade}} work in {{city}}';
export const DEFAULT_BODY = `Hi {{company}} team,

My name is {{sender}} with {{my_company}}. We are a Texas contractor and would like to bid on your upcoming {{trade}} projects in and around {{city}}.

Could you add us to your invitation-to-bid list, or point me to the person who handles estimating and subcontractor bids? If you have a job you need priced now, reply with the plans or scope and we will send a number.

You can reply here or call {{my_phone}}.

Thank you,
{{sender}}
{{my_company}}`;

export interface TemplateVars {
  company: string;
  city: string;
  trade: string;
  myCompany: string;
  myPhone: string;
  sender: string;
}

export function renderTemplate(template: string, v: TemplateVars): string {
  const map: Record<string, string> = {
    company: v.company,
    city: v.city || 'Texas',
    trade: v.trade,
    my_company: v.myCompany,
    my_phone: v.myPhone || 'the number in my signature',
    sender: v.sender || v.myCompany,
  };
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (all, key: string) => map[key] ?? all);
}

/** CAN-SPAM: every commercial email names the sender, a postal address and a way to opt out. */
export function complianceFooter(businessName: string, businessAddress: string): string {
  return `\n\n--\n${businessName}\n${businessAddress}\nIf you do not want more emails from us, reply "remove" and we will not contact you again.`;
}

export type ReplyKind = 'opt_out' | 'offer' | 'interested' | 'declined' | 'auto_reply' | 'reply';

/** Drop quoted history so we judge only what the company wrote. */
export function newestPart(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue;
    if (/^On .+wrote:\s*$/i.test(line.trim()) || /^-{2,}\s*Original Message/i.test(line.trim()))
      break;
    if (/^From:\s.+/i.test(line.trim()) && out.length > 0) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

/** Largest dollar amount written in the reply, in cents. */
export function extractAmountMinor(text: string): number | null {
  let best: number | null = null;
  for (const m of text.matchAll(
    /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(k|K|thousand)?/g,
  )) {
    let value = Number(m[1]!.replace(/,/g, '')) + (m[2] ? Number(m[2].padEnd(2, '0')) / 100 : 0);
    if (m[3]) value *= 1000;
    const cents = Math.round(value * 100);
    if (Number.isSafeInteger(cents) && cents > 0 && (best === null || cents > best)) best = cents;
  }
  return best;
}

export function classifyReply(
  subject: string,
  text: string,
): { kind: ReplyKind; amountMinor: number | null } {
  const body = newestPart(text);
  const all = `${subject}\n${body}`.toLowerCase();
  if (
    /\b(unsubscribe|remove me|remove us|take (me|us) off|stop emailing|do not (contact|email)|don't (contact|email)|opt.?out)\b/.test(
      all,
    ) ||
    /^\s*(remove|stop)\s*$/i.test(body)
  ) {
    return { kind: 'opt_out', amountMinor: null };
  }
  if (/\b(out of (the )?office|auto.?reply|automatic reply|away until|on vacation)\b/.test(all)) {
    return { kind: 'auto_reply', amountMinor: null };
  }
  const amountMinor = extractAmountMinor(body);
  if (
    amountMinor !== null ||
    /\b(quote|proposal|our (price|number)|our bid (is|for|comes|would)|we can do (it|this) for|estimate attached|pricing attached)\b/.test(
      all,
    )
  ) {
    return { kind: 'offer', amountMinor };
  }
  if (
    /\b(not interested|no thanks|no thank you|not at this time|we('re| are) (all )?set|not hiring|no need|pass on)\b/.test(
      all,
    )
  ) {
    return { kind: 'declined', amountMinor: null };
  }
  if (
    /\b(interested|send (me|us|over)|call me|give (me|us) a call|let'?s (talk|connect|meet)|added you|add you|bid list|plans attached|invite you|invitation to bid|itb|rfp|sounds good)\b/.test(
      all,
    )
  ) {
    return { kind: 'interested', amountMinor: null };
  }
  return { kind: 'reply', amountMinor: null };
}

const RANK: Record<string, number> = {
  new: 0,
  contacted: 1,
  replied: 2,
  declined: 3,
  interested: 4,
  offer: 5,
  do_not_contact: 9,
};

/** A company's status only moves forward, and "remove me" always wins. */
export function statusAfterReply(current: string, kind: ReplyKind): string {
  const next =
    kind === 'opt_out'
      ? 'do_not_contact'
      : kind === 'offer'
        ? 'offer'
        : kind === 'interested'
          ? 'interested'
          : kind === 'declined'
            ? 'declined'
            : kind === 'auto_reply'
              ? current
              : 'replied';
  return (RANK[next] ?? 0) > (RANK[current] ?? 0) ? next : current;
}

// ------------------------------------------------------------------ OpenStreetMap (free, no key)
// Overpass API over OpenStreetMap data (© OpenStreetMap contributors, ODbL). Used when no Google
// Places key is set. Coverage is thinner than Google's, but it is free and often lists the email.

/** Public Overpass servers, tried in order. The main one sometimes refuses (HTTP 406/429/504). */
export const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
export const OVERPASS_URL = OVERPASS_URLS[0]!;

export function overpassQuery(city: string): string {
  const safe = city.replace(/["\\]/g, '');
  return `[out:json][timeout:10];
area["name"="Texas"]["admin_level"="4"]->.tx;
rel(area.tx)["name"="${safe}"]["boundary"="administrative"];
map_to_area->.c;
(
  nwr(area.c)["office"="construction_company"]["name"];
  nwr(area.c)["craft"~"^(builder|roofer|concrete|bricklayer|stonemason|carpenter|paver)$"]["name"];
  nwr(area.c)["shop"="trade"]["trade"~"building|construction|concrete",i]["name"];
  nwr(area.c)["name"~"concrete|construction|builders|custom homes|contracting|paving|excavation|roofing",i]["office"];
  nwr(area.c)["name"~"concrete|construction|builders|custom homes|contracting|paving|excavation|roofing",i]["craft"];
);
out center tags 80;`;
}

export function guessTrade(name: string, tags: Record<string, string>): OutreachTrade {
  const t =
    `${name} ${tags.craft ?? ''} ${tags.trade ?? ''} ${tags.description ?? ''}`.toLowerCase();
  if (/paving|asphalt/.test(t)) return 'paving';
  if (/concrete|flatwork|foundation|paver/.test(t)) return 'concrete';
  if (/roof/.test(t)) return 'roofing';
  if (/excavat|site work|dirt|grading|utility/.test(t)) return 'site_work';
  if (/remodel|renovat|kitchen|bath/.test(t)) return 'remodeling';
  if (/homes\b|home build|custom home|builder/.test(t)) return 'home_builder';
  if (/commercial/.test(t)) return 'commercial_construction';
  return 'general_contractor';
}

export interface OsmCompany extends FoundCompany {
  email: string | null;
  trade: OutreachTrade;
}

export function normalizeOverpass(payload: unknown, city: string): OsmCompany[] {
  const list = obj(payload).elements;
  if (!Array.isArray(list)) return [];
  const out: OsmCompany[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const e = obj(raw);
    const tags = obj(e.tags) as Record<string, string>;
    const name = str(tags.name, 200);
    const id = `${str(e.type, 10)}/${String(e.id ?? '')}`;
    if (!name || seen.has(id) || /^\/|\/$/.test(id)) continue;
    seen.add(id);
    const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
    const placeCity = str(tags['addr:city'], 100) || city;
    const email =
      str(tags.email ?? tags['contact:email'], 254)
        .toLowerCase()
        .split(/[;,\s]/)[0] ?? '';
    out.push({
      sourceId: `osm:${id}`,
      name,
      address: [street, placeCity, 'TX', tags['addr:postcode']].filter(Boolean).join(', '),
      city: placeCity,
      phone: str(tags.phone ?? tags['contact:phone'], 40) || null,
      website: safeWebsite(str(tags.website ?? tags['contact:website'], 500)),
      email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
      trade: guessTrade(name, tags),
    });
  }
  return out;
}
