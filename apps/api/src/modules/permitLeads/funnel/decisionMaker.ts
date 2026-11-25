// Decision-maker finder (cfongai P6): who to ask for on a lead file.
//
// A builder/owner lead file today has an owner name + mailing address and no named contact.
// This resolves a decision-maker from, in order:
//   1. The public TDLR license file — a license-holder name (the owner_name on the license,
//      or the business name when the license names no separate person), plus the license
//      type/number/expiry and the phone TDLR published. Matched by business name only, exact
//      or normalized; an ambiguous match (two different licenses) returns nothing rather than
//      the wrong license. Texas does not license general contractors, roofers or concrete
//      companies, so most builders have no TDLR license at all — that is an honest miss, not
//      a gap to fill by guessing.
//   2. The company's own CRM contacts, matched by normalized name — the only source besides
//      the public record that can supply a name, email or phone.
//   3. Nothing: the lead says plainly "Decision-maker not in public records".
//
// What never happens: a name, email or phone is never invented, never looked up from a data
// broker, never scraped. TDLR lookups are best-effort and cached per name: a failed lookup
// leaves the decision-maker blank, it never fails the funnel or the search.
import { lookupTdlrByName, type LicenseLead } from '../../outreach/tdlr';
import { normalizeName } from './owner';

type FetchLike = typeof fetch;

/** A CRM contact as the funnel/search routes load it (display name, email, phone, role). */
export interface CrmContact {
  displayName: string;
  email: string | null;
  phone: string | null;
  role: string | null;
}

export type DecisionMakerSource = 'tdlr' | 'contacts';

export interface DecisionMaker {
  /** License-holder person, business name, or CRM contact name — null when unknown. */
  name: string | null;
  /** Where the name came from; null when no decision-maker is known. */
  source: DecisionMakerSource | null;
  /** TDLR license type/number/expiry when source is 'tdlr'; null otherwise. */
  licenseType: string | null;
  licenseNumber: string | null;
  licenseExpiresOn: string | null;
  /** Phone exactly as TDLR published it or the CRM contact lists it; null when unknown. */
  phone: string | null;
  /** Which record the phone came from; null when no phone is known. */
  phoneSource: DecisionMakerSource | null;
  /** Email from the company's own CRM contact only — TDLR publishes no email. */
  email: string | null;
  /** Role from the CRM contact (e.g. "Estimator"); null when unknown. */
  role: string | null;
}

export const EMPTY_DECISION_MAKER: DecisionMaker = {
  name: null,
  source: null,
  licenseType: null,
  licenseNumber: null,
  licenseExpiresOn: null,
  phone: null,
  phoneSource: null,
  email: null,
  role: null,
};

/** Honest label the UI shows when no decision-maker is known. */
export const NO_DECISION_MAKER_LABEL = 'Decision-maker not in public records';
export const NO_DECISION_MAKER_DETAIL =
  'No license holder is published for this company in the Texas TDLR license file, and no contact matches this name in your CRM. Texas does not license general contractors, roofers or concrete companies, so most builders have no TDLR license — the permit applicant or the owner mailing address is still shown on the lead.';
export const TDLR_COVERAGE_NOTE =
  'TDLR licenses A/C, electrical, sign, elevator, appliance and water-well contractors only. General contractors, roofers and concrete companies are not in the TDLR file.';

/** Legal-entity suffixes stripped for the second-pass name comparison only. "ABC Homes LLC"
 *  and "ABC Homes Inc" are different legal entities, so the suffix-stripped comparison is
 *  only used when the names are otherwise identical — it forgives "LLC" vs "L.L.C." and
 *  "ABC Homes" vs "ABC Homes LLC", never a different core name. */
const ENTITY_SUFFIXES = new Set([
  'llc',
  'inc',
  'corp',
  'corporation',
  'co',
  'company',
  'ltd',
  'lp',
  'llp',
  'pllc',
  'dba',
]);

function coreName(name: string): string {
  const tokens = normalizeName(name).split(' ').filter(Boolean);
  // "L.L.C." normalizes to single letters — rejoin a trailing run of them ("l l c" -> "llc")
  // so dotted and undotted suffixes compare the same.
  const rejoined: string[] = [];
  let i = tokens.length;
  while (i > 0) {
    if (tokens[i - 1]!.length === 1) {
      let j = i - 1;
      while (j > 0 && tokens[j - 1]!.length === 1) j--;
      rejoined.unshift(tokens.slice(j, i).join(''));
      i = j;
    } else {
      rejoined.unshift(tokens[i - 1]!);
      i--;
    }
  }
  while (rejoined.length > 1 && ENTITY_SUFFIXES.has(rejoined[rejoined.length - 1]!)) {
    rejoined.pop();
  }
  return rejoined.join(' ');
}

/** Exact or normalized match only: full normalized names equal, core names (entity suffixes
 *  stripped) equal, or the same letters with different word splits ("O'Brien" vs "OBRIEN").
 *  Anything else is not a match. */
export function namesMatch(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) return false;
  if (normalizeName(a) === normalizeName(b)) return true;
  const ca = coreName(a);
  const cb = coreName(b);
  if (ca.length > 0 && ca === cb) return true;
  const squash = (v: string) => normalizeName(v).replace(/ /g, '');
  const sa = squash(a);
  return sa.length > 0 && sa === squash(b);
}

/**
 * The single license whose business name matches the given name, or null when none matches
 * or when two or more different licenses match (ambiguous — never the wrong license).
 * Two rows for the same license number (e.g. a renewal duplicate) count as one license.
 */
export function matchLicenseByName(name: string, licenses: LicenseLead[]): LicenseLead | null {
  if (!name.trim()) return null;
  const matched = licenses.filter((l) => namesMatch(name, l.name));
  const distinct = [...new Map(matched.map((l) => [l.licenseNumber, l])).values()];
  return distinct.length === 1 ? distinct[0]! : null;
}

/** License holder as the decision-maker: the person named on the license when there is one,
 *  otherwise the business itself. */
export function decisionMakerFromLicense(license: LicenseLead): DecisionMaker {
  return {
    name: license.ownerName ?? license.name,
    source: 'tdlr',
    licenseType: license.licenseType,
    licenseNumber: license.licenseNumber,
    licenseExpiresOn: license.expiresOn || null,
    phone: license.phone,
    phoneSource: license.phone ? 'tdlr' : null,
    email: null,
    role: null,
  };
}

export function decisionMakerFromContact(contact: CrmContact): DecisionMaker {
  return {
    name: contact.displayName,
    source: 'contacts',
    licenseType: null,
    licenseNumber: null,
    licenseExpiresOn: null,
    phone: contact.phone,
    phoneSource: contact.phone ? 'contacts' : null,
    email: contact.email,
    role: contact.role,
  };
}

export interface ResolveDecisionMakerInput {
  /** Contractor/applicant name as the city published it. */
  contractor: string;
  /** Owner name as published by the appraisal district or the permit, if any. */
  ownerName: string | null;
  /** TDLR licenses already fetched for these names (the coarse pre-filter). */
  licenses: LicenseLead[];
  /** The company's own CRM contacts, keyed by normalized display name. */
  contactsByName?: Map<string, CrmContact>;
}

/**
 * Pure resolution: TDLR license-holder first (contractor name, then owner name), then the
 * company's own CRM contacts by name (contractor, then owner), then nothing. Never invents.
 */
export function resolveDecisionMaker(input: ResolveDecisionMakerInput): DecisionMaker {
  for (const name of [input.contractor, input.ownerName]) {
    if (!name) continue;
    const license = matchLicenseByName(name, input.licenses);
    if (license) return decisionMakerFromLicense(license);
  }
  if (input.contactsByName) {
    for (const name of [input.contractor, input.ownerName]) {
      if (!name) continue;
      const contact = input.contactsByName.get(normalizeName(name));
      if (contact) return decisionMakerFromContact(contact);
    }
  }
  return { ...EMPTY_DECISION_MAKER };
}

// TDLR name lookups are one network call per distinct company name; cache them for an hour
// so a funnel run with the same builder on many permits does not re-query data.texas.gov.
const nameCache = new Map<string, { at: number; value: LicenseLead[] }>();
const NAME_CACHE_MS = 60 * 60 * 1000;
const NAME_CACHE_MAX = 200;

async function cachedTdlrByName(
  name: string,
  fetcher: FetchLike,
  today: Date,
): Promise<LicenseLead[]> {
  const key = normalizeName(name);
  const hit = nameCache.get(key);
  if (hit && Date.now() - hit.at < NAME_CACHE_MS) return hit.value;
  const value = await lookupTdlrByName(name, fetcher, { today });
  if (nameCache.size >= NAME_CACHE_MAX) nameCache.delete(nameCache.keys().next().value!);
  nameCache.set(key, { at: Date.now(), value });
  return value;
}

export interface EnrichDecisionMakerDeps {
  fetcher?: FetchLike;
  contactsByName?: Map<string, CrmContact>;
  today?: Date;
  /** Skip the TDLR lookup (e.g. when only CRM contacts should resolve). */
  skipTdlr?: boolean;
}

/**
 * Resolve a lead's decision-maker: TDLR lookup by contractor/owner name, then CRM contacts.
 * Never throws and never fails the caller — a failed lookup falls through to contacts, and
 * a failed everything returns the empty decision-maker.
 */
export async function enrichDecisionMaker(
  input: { contractor: string; ownerName: string | null },
  deps: EnrichDecisionMakerDeps = {},
): Promise<DecisionMaker> {
  const today = deps.today ?? new Date();
  let licenses: LicenseLead[] = [];
  if (!deps.skipTdlr) {
    try {
      const names = [input.contractor, input.ownerName].filter(
        (n): n is string => Boolean(n && n.trim()),
      );
      const seen = new Set<string>();
      const found: LicenseLead[] = [];
      for (const name of names) {
        const key = normalizeName(name);
        if (seen.has(key)) continue;
        seen.add(key);
        found.push(...(await cachedTdlrByName(name, deps.fetcher ?? fetch, today)));
      }
      licenses = found;
    } catch {
      licenses = [];
    }
  }
  return resolveDecisionMaker({
    contractor: input.contractor,
    ownerName: input.ownerName,
    licenses,
    contactsByName: deps.contactsByName,
  });
}
