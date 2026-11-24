// Owner enrichment for funnel leads: who to call, from public records only.
//
// Where an owner comes from, in order:
//   1. The permit itself — Austin and Dallas publish a contractor name and sometimes a phone;
//      Collin publishes the builder / who the permit was issued to.
//   2. The county appraisal district parcel record, matched by street address — Collin CAD
//      and Dallas CAD both publish owner name + owner mailing address. Matched only when the
//      normalized street address agrees; a fuzzy or multi-parcel match returns nothing rather
//      than the wrong owner.
//   3. The company's own CRM contacts, matched by normalized owner/contractor name — the only
//      source a phone number can come from besides the permit itself.
//
// What never happens: a phone number is never invented, never looked up from a data broker,
// never scraped. When no public record publishes a phone, the lead says so plainly
// ("Phone not in public records") and the mailing address is the way to reach the owner.
// CAD lookups are best-effort and capped: a failed lookup leaves the owner blank, it never
// fails the funnel. Dallas CAD is appraisal-year 2019 — the vintage is carried on the lead.
import {
  COLLIN_PARCELS_URL,
  DALLAS_PARCELS_URL,
  normalizeCollinParcel,
  normalizeDallasParcel,
} from '../../landScout/sources';
import type { RawPermit } from '../engine';
import { poolPropertyKey } from '../poolRadar';
import { LIVE_SOURCES } from '../sources';
import type { FunnelContact, FunnelOwner } from './funnel';

type FetchLike = typeof fetch;
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};

const COLLIN_CITIES = new Set(
  (LIVE_SOURCES.find((s) => s.id === 'collin')?.cities ?? []).map((c) => c.toLowerCase()),
);

const UNIT_RE = /\b(?:APT|APARTMENT|SUITE|STE|UNIT|BLDG|#)\b.*$/i;

/** Street key for owner matching: normalized address + city, unit designators dropped
 *  (a parcel record never carries the apartment number). Reuses Pool Radar's suffix
 *  expansion so "123 Main St" and "123 Main Street" are the same property. */
export function ownerMatchKey(address: string, city: string): string {
  const stripped = address.replace(UNIT_RE, '').trim();
  return poolPropertyKey({ address: stripped, city } as RawPermit);
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DIRECTIONS = new Set(['N', 'S', 'E', 'W', 'NORTH', 'SOUTH', 'EAST', 'WEST']);

/** House number + street tokens from a situs address, for the CAD LIKE query. */
function streetParts(address: string): { number: string; street: string } | null {
  const clean = address.replace(UNIT_RE, '').trim();
  const m = /^(\d+)\s+(.+)$/.exec(clean);
  if (!m) return null;
  const tokens = m[2]!.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  const street = DIRECTIONS.has(tokens[0]!) && tokens.length > 1 ? tokens.slice(0, 2).join(' ') : tokens[0]!;
  return { number: m[1]!, street };
}

interface CadOwner {
  name: string | null;
  mailingAddress: string | null;
  vintage: string | null;
}

const cache = new Map<string, { at: number; value: CadOwner | null }>();
const CACHE_MS = 60 * 60 * 1000;

async function arcgisFeatures(
  fetcher: FetchLike,
  layerUrl: string,
  where: string,
  outFields: string,
): Promise<Obj[]> {
  const url = new URL(`${layerUrl}/query`);
  url.searchParams.set('where', where);
  url.searchParams.set('outFields', outFields);
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('resultRecordCount', '10');
  url.searchParams.set('f', 'json');
  const res = await fetcher(url.href, {
    method: 'GET',
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`CAD lookup failed (${res.status})`);
  const data = obj(JSON.parse(await res.text()) as unknown);
  if (data.error) throw new Error('CAD service returned an error');
  return Array.isArray(data.features) ? data.features.map((f) => obj(f)) : [];
}

const COLLIN_OWNER_FIELDS = [
  'propID', 'geoID', 'situsConcat', 'situsConcatShort', 'situsCity',
  'ownerName', 'ownerAddrLine1', 'ownerAddrLine2', 'ownerAddrCity',
  'ownerAddrState', 'ownerAddrZip', 'currValYear',
].join(',');
const DALLAS_OWNER_FIELDS = [
  'ACCT', 'TAXPANAME1', 'TAXPAADD1', 'TAXPAADD2', 'TAXPACITY', 'TAXPASTA', 'TAXPAZIP',
  'ST_NUM', 'ST_DIR', 'ST_NAME', 'ST_TYPE', 'CITY', 'APPRAISALYEAR',
].join('');

/**
 * Look up the appraisal-district owner for one permit address. Collin County cities and
 * Dallas only — no other county has a public parcel layer wired into Field Pro. Returns
 * null when no parcel matches exactly, when several match, or when the service fails.
 */
export async function lookupCadOwner(
  permit: RawPermit,
  fetcher: FetchLike = fetch,
): Promise<CadOwner | null> {
  const key = ownerMatchKey(permit.address, permit.city);
  if (!key) return null;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value: CadOwner | null = null;
  try {
    const parts = streetParts(permit.address);
    if (parts) {
      const isCollin = COLLIN_CITIES.has(permit.city.toLowerCase());
      const isDallas = permit.city.toLowerCase() === 'dallas';
      if (isCollin) {
        const like = `${parts.number} ${parts.street}%`.replace(/'/g, "''");
        const features = await arcgisFeatures(
          fetcher,
          COLLIN_PARCELS_URL,
          `UPPER(situsConcatShort) LIKE '${like}'`,
          COLLIN_OWNER_FIELDS,
        );
        const parcels = features
          .map((f) => normalizeCollinParcel(f))
          .filter((p): p is NonNullable<typeof p> => p !== null)
          .filter((p) => ownerMatchKey(p.situsAddress ?? '', p.city ?? '') === key);
        if (parcels.length === 1) {
          const p = parcels[0]!;
          value = {
            name: p.ownerName,
            mailingAddress: p.ownerMailing,
            vintage: p.vintage,
          };
        }
      } else if (isDallas) {
        const features = await arcgisFeatures(
          fetcher,
          DALLAS_PARCELS_URL,
          `ST_NUM = ${Number(parts.number) || 0}`,
          DALLAS_OWNER_FIELDS,
        );
        const parcels = features
          .map((f) => normalizeDallasParcel(f))
          .filter((p): p is NonNullable<typeof p> => p !== null)
          .filter((p) => ownerMatchKey(p.situsAddress ?? '', p.city ?? '') === key);
        if (parcels.length === 1) {
          const p = parcels[0]!;
          value = {
            name: p.ownerName,
            mailingAddress: p.ownerMailing,
            vintage: p.vintage,
          };
        }
      }
    }
  } catch {
    value = null;
  }
  if (cache.size >= 500) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), value });
  return value;
}

export interface EnrichDeps {
  fetcher?: FetchLike;
  /** The company's own CRM contacts by normalized name → phone. Only these and the permit
   *  itself can supply a phone number. */
  contactsByName?: Map<string, string>;
  /** Skip the CAD lookup (e.g. when enriching a long list — the route caps it instead). */
  skipCad?: boolean;
}

/**
 * Fill in a lead's owner + contact from public records and the company's own contacts.
 * Never throws and never invents: every field is either published somewhere or null.
 */
export async function enrichOwner(
  permit: RawPermit,
  deps: EnrichDeps = {},
): Promise<{ owner: FunnelOwner; contact: FunnelContact }> {
  const owner: FunnelOwner = { name: null, mailingAddress: null, source: null, vintage: null };
  const contact: FunnelContact = {
    phone: permit.contractorPhone || null,
    phoneSource: permit.contractorPhone ? 'permit' : null,
  };
  if (!deps.skipCad) {
    const cad = await lookupCadOwner(permit, deps.fetcher ?? fetch);
    if (cad && (cad.name || cad.mailingAddress)) {
      owner.name = cad.name;
      owner.mailingAddress = cad.mailingAddress;
      owner.source = 'cad';
      owner.vintage = cad.vintage;
    }
  }
  if (!owner.name && permit.contractor) {
    owner.name = permit.contractor;
    owner.source = 'permit';
  }
  if (!contact.phone && deps.contactsByName) {
    for (const name of [owner.name, permit.contractor]) {
      if (!name) continue;
      const phone = deps.contactsByName.get(normalizeName(name));
      if (phone) {
        contact.phone = phone;
        contact.phoneSource = 'contacts';
        break;
      }
    }
  }
  return { owner, contact };
}

/** "Phone not in public records" — the honest label the UI shows when no phone is known. */
export const NO_PHONE_LABEL = 'Phone not in public records';
export const NO_PHONE_DETAIL =
  'No phone number is published for this owner in the permit record or the county appraisal district. Mail the owner at the mailing address, or add the number to your contacts once you have it.';
export const NO_OWNER_DETAIL =
  'No owner is published for this permit — the city did not name an owner and no county parcel record matched the address. The permit applicant/contractor is still shown when the city published one.';
export const CAD_VINTAGE_NOTE =
  'Owner from the county appraisal district. Dallas records are appraisal-year 2019 — verify current ownership with DCAD before relying on it.';
export const OWNER_SOURCE_LABEL: Record<NonNullable<FunnelOwner['source']>, string> = {
  cad: 'County appraisal district',
  permit: 'Permit record',
};
