// Live Home Depot listings for one material (optional). The API holds SERPAPI_API_KEY so it
// never reaches a browser, and only signed-in members can spend lookups. Queries are restricted
// to Home Depot and results are filtered to Home Depot sellers/product URLs. Results are cached
// per query and job location for an hour to keep paid usage low.
import type { MaterialPriceLookupResponse } from '@fieldline/contracts';

const CACHE_MS = 60 * 60 * 1000;
const MAX_CACHE = 500;
const cache = new Map<string, { at: number; value: MaterialPriceLookupResponse }>();

export const MAX_QUERY_LENGTH = 120;

export function sanitizeQuery(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const printable = Array.from(raw, (ch) => (ch.charCodeAt(0) < 32 ? ' ' : ch)).join('');
  const q = printable.replace(/\s+/g, ' ').trim();
  if (q.length < 2 || q.length > MAX_QUERY_LENGTH) return null;
  return q;
}

function parsePrice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const n = Number(value.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function safeLink(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function homeDepotLink(...values: unknown[]): string | null {
  for (const value of values) {
    const link = safeLink(value);
    if (!link) continue;
    const host = new URL(link).hostname.toLowerCase();
    if (host === 'homedepot.com' || host.endsWith('.homedepot.com')) return link;
  }
  return null;
}

/** Normalizes only Home Depot Google Shopping offers, sorted by Home Depot price. */
export function parseShoppingResults(payload: unknown, limit = 8): MaterialPriceLookupResponse['offers'] {
  const results = (payload as { shopping_results?: unknown })?.shopping_results;
  if (!Array.isArray(results)) return [];
  const offers: MaterialPriceLookupResponse['offers'] = [];
  for (const item of results as Record<string, unknown>[]) {
    const price = parsePrice(item.extracted_price) ?? parsePrice(item.price);
    if (price === null || price > 1_000_000 || typeof item.title !== 'string') continue;
    const seller = typeof item.source === 'string' ? item.source.trim() : '';
    const link = homeDepotLink(item.product_link, item.link);
    const isHomeDepotSeller = /home\s*depot/i.test(seller);
    if (!isHomeDepotSeller && !link) continue;
    offers.push({
      title: item.title.slice(0, 160),
      seller: 'Home Depot',
      price,
      link,
    });
  }
  return offers.sort((a, b) => a.price - b.price).slice(0, limit);
}

export async function lookupMaterialPrices(
  query: string,
  location: string,
  apiKey: string | undefined,
  fetcher: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<MaterialPriceLookupResponse> {
  if (!apiKey) {
    return {
      live: false,
      query,
      offers: [],
      message: 'Home Depot live price lookup is not set up on this server (SERPAPI_API_KEY). Verified Home Depot base prices remain available; other items stay unpriced until a Home Depot listing or supplier quote is verified.',
    };
  }
  const key = `home-depot|${query.toLowerCase()}|${location.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && nowMs - hit.at < CACHE_MS) return hit.value;
  const upstream = new URL('https://serpapi.com/search.json');
  upstream.searchParams.set('engine', 'google_shopping');
  upstream.searchParams.set('q', `site:homedepot.com ${query}`);
  upstream.searchParams.set('location', location);
  upstream.searchParams.set('gl', 'us');
  upstream.searchParams.set('hl', 'en');
  upstream.searchParams.set('api_key', apiKey);
  try {
    const res = await fetcher(upstream, { signal: AbortSignal.timeout(12_000), redirect: 'error' });
    if (!res.ok) return { live: false, query, offers: [], message: `The price provider returned ${res.status}.` };
    const text = await res.text();
    if (text.length > 3_000_000) return { live: false, query, offers: [], message: 'The price provider answer was too large.' };
    const offers = parseShoppingResults(JSON.parse(text));
    const value: MaterialPriceLookupResponse = {
      live: true,
      query,
      offers,
      fetchedAt: new Date(nowMs).toISOString(),
      source: 'Home Depot listings via Google Shopping',
      ...(offers.length === 0 ? { message: 'No priced Home Depot listing found for that product and job location.' } : {}),
    };
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: nowMs, value });
    return value;
  } catch {
    // Never relay upstream bodies; they can echo the key or the query.
    return { live: false, query, offers: [], message: 'The price provider did not respond.' };
  }
}
