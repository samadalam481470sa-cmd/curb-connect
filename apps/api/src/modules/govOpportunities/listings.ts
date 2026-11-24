// Listing-presence checks: is the contractor actually listed where governments look?
//
// SAM.gov: the official Entity Management API (same SAM_GOV_API_KEY the existing externalBids
// module already uses for opportunity search — no new key). A company is "listed" only when
// the API returns a matching entity registration; no key means "requires_setup", never a
// guessed answer. This is different from externalBids, which searches federal opportunities;
// this checks whether the contractor's own business is registered.
//
// CMBL: the Texas Comptroller's vendor search is a legacy form with no public API
// (https://mycpa.cpa.state.tx.us/tpasscmblsearch/tpasscmblsearch.do — verified live
// 2026-11-24), so Field Pro never claims a CMBL result. It always returns an honest
// "check manually" item with the exact search URL and the steps from the Comptroller's own
// FAQ, so the contractor can look themselves up in under a minute.
import type { GovListing } from '@fieldline/contracts';

export const SAM_ENTITY_API = 'https://api.sam.gov/entity-information/v3/entities';
export const SAM_REGISTER_URL = 'https://sam.gov/entity-information';
export const CMBL_SEARCH_URL = 'https://mycpa.cpa.state.tx.us/tpasscmblsearch/tpasscmblsearch.do';
export const CMBL_REGISTER_URL = 'https://comptroller.texas.gov/purchasing/vendor/cmbl/';

export const CMBL_SEARCH_STEPS = [
  'Open the CMBL online search and type the first word of the company name in "Vendor Name".',
  'Directly underneath, choose the "contains" option.',
  'Scroll to the bottom of the page and click "Submit Search", then click "Go" on the next page.',
  'Click the company name to see the vendor detail — if it is not there, the company is not on the CMBL.',
];

type Obj = Record<string, unknown>;
const asObj = (value: unknown): Obj =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Obj) : {};
const asStr = (value: unknown, max = 200): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

export type SamCheckResult =
  | { status: 'listed'; uei: string | null; legalName: string }
  | { status: 'not_listed' }
  | { status: 'requires_setup' }
  | { status: 'unknown'; detail: string };

/**
 * Check SAM.gov entity registration by legal business name (Texas only). Returns 'listed'
 * only when the API returns an entity whose legal name contains the company name; anything
 * unexpected is 'unknown', never a claimed listing.
 */
export async function checkSamRegistration(deps: {
  fetchFn?: typeof fetch;
  samKey: string | null | undefined;
  companyName: string;
  now?: Date;
}): Promise<SamCheckResult> {
  if (!deps.samKey || !deps.companyName.trim()) return { status: 'requires_setup' };
  const fetchFn = deps.fetchFn ?? fetch;
  const url = new URL(SAM_ENTITY_API);
  url.searchParams.set('api_key', deps.samKey);
  url.searchParams.set('legalBusinessName', deps.companyName.trim());
  url.searchParams.set('state', 'TX');
  url.searchParams.set('page', '0');
  try {
    const res = await fetchFn(url.href, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 403) {
      return { status: 'unknown', detail: 'SAM.gov rejected the API key — check SAM_GOV_API_KEY.' };
    }
    if (!res.ok) {
      return { status: 'unknown', detail: `SAM.gov returned HTTP ${res.status}.` };
    }
    const payload = (await res.json()) as unknown;
    const data = asObj(payload);
    const entities = Array.isArray(data.entityData) ? data.entityData : null;
    if (!entities) {
      return { status: 'unknown', detail: 'SAM.gov answered in an unexpected format.' };
    }
    const wanted = deps.companyName.trim().toLowerCase();
    for (const raw of entities) {
      const reg = asObj(asObj(raw).entityRegistration);
      const legalName = asStr(reg.legalBusinessName, 200);
      if (!legalName) continue;
      if (!legalName.toLowerCase().includes(wanted) && !wanted.includes(legalName.toLowerCase())) continue;
      const core = asObj(asObj(raw).coreData);
      return {
        status: 'listed',
        uei: asStr(core.ueiSAM ?? asObj(core).uei, 40) || null,
        legalName,
      };
    }
    return { status: 'not_listed' };
  } catch (error) {
    return {
      status: 'unknown',
      detail: `SAM.gov could not be reached (${error instanceof Error ? error.message : String(error)}).`,
    };
  }
}

/** The two listing items for a company. SAM is checked live when a key is configured;
 *  CMBL is always a manual item — there is no public API to check it against. */
export async function listingItems(deps: {
  fetchFn?: typeof fetch;
  samKey: string | null | undefined;
  companyName: string;
  now?: Date;
}): Promise<GovListing[]> {
  const now = deps.now ?? new Date();
  const company = deps.companyName.trim();
  const sam = company ? await checkSamRegistration(deps) : { status: 'requires_setup' as const };
  const samListing: GovListing = {
    id: 'sam',
    name: 'SAM.gov — federal small-business registration',
    status:
      sam.status === 'listed'
        ? 'listed'
        : sam.status === 'not_listed'
          ? 'not_listed'
          : sam.status === 'requires_setup'
            ? 'requires_setup'
            : 'unknown',
    detail:
      sam.status === 'listed'
        ? `Registered on SAM.gov as "${sam.legalName}"${sam.uei ? ` (UEI ${sam.uei})` : ''} — federal buyers can find the company.`
        : sam.status === 'not_listed'
          ? 'No SAM.gov entity registration was found for this company name — register for free to get a public .gov profile with the company website on it.'
          : sam.status === 'requires_setup'
            ? company
              ? 'SAM.gov cannot be checked until a SAM.gov API key is set (SAM_GOV_API_KEY). Registration itself is free — anyone charging for it is a middleman.'
              : 'Enter the company name to check SAM.gov. Registration itself is free — anyone charging for it is a middleman.'
            : `SAM.gov could not be checked: ${sam.detail}`,
    url: SAM_REGISTER_URL,
    checkedAt: sam.status === 'listed' || sam.status === 'not_listed' ? now.toISOString() : null,
  };
  const cmblListing: GovListing = {
    id: 'cmbl',
    name: 'Texas CMBL — state supplier list ($70/year)',
    status: 'manual_check',
    detail:
      'The CMBL has no public API, so Field Pro cannot check it automatically. The search takes under a minute — the steps are below.',
    url: CMBL_SEARCH_URL,
    steps: CMBL_SEARCH_STEPS,
    checkedAt: null,
  };
  return [samListing, cmblListing];
}
