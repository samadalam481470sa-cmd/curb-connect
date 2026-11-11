// Live material price lookup (HB-003). The browser calls /api/material-prices on the web origin;
// the server forwards the query to a shopping-results provider with a server-side key, so the key
// never reaches the browser. With no key configured the endpoint says so (live: false) and the UI
// falls back to the reference price book and direct retailer links.
import type { LiveOffer, LivePriceResponse } from './prices';

export const MAX_QUERY_LENGTH = 120;

export function sanitizeQuery(raw: string | null): string | null {
  if (!raw) return null;
  const printable = Array.from(raw, (ch) => (ch.charCodeAt(0) < 32 ? ' ' : ch)).join('');
  const q = printable.replace(/\s+/g, ' ').trim();
  if (q.length < 2 || q.length > MAX_QUERY_LENGTH) return null;
  return q;
}

interface SerpShoppingResult {
  title?: unknown;
  source?: unknown;
  extracted_price?: unknown;
  price?: unknown;
  product_link?: unknown;
  link?: unknown;
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
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Normalizes a SerpApi google_shopping payload into offers sorted cheapest first. */
export function parseShoppingResults(payload: unknown, limit = 8): LiveOffer[] {
  const results = (payload as { shopping_results?: unknown })?.shopping_results;
  if (!Array.isArray(results)) return [];
  const offers: LiveOffer[] = [];
  for (const item of results as SerpShoppingResult[]) {
    const price = parsePrice(item.extracted_price) ?? parsePrice(item.price);
    if (price === null || typeof item.title !== 'string') continue;
    offers.push({
      title: item.title.slice(0, 160),
      seller: typeof item.source === 'string' ? item.source.slice(0, 80) : 'Unknown seller',
      price,
      link: safeLink(item.product_link) ?? safeLink(item.link),
    });
  }
  return offers.sort((a, b) => a.price - b.price).slice(0, limit);
}

/** Client helper: never throws; a failed lookup reads as "not live". */
export async function fetchLivePrices(
  query: string,
  location?: string,
): Promise<LivePriceResponse> {
  const params = new URLSearchParams({ q: query });
  if (location) params.set('location', location);
  try {
    const res = await fetch(`/api/material-prices?${params.toString()}`, {
      headers: { accept: 'application/json' },
    });
    const body = (await res.json()) as LivePriceResponse;
    if (!res.ok)
      return { live: false, query, offers: [], message: body.message ?? 'Lookup failed.' };
    return body;
  } catch {
    return { live: false, query, offers: [], message: 'Could not reach the price service.' };
  }
}
