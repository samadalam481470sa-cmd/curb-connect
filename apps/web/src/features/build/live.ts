// Live Home Depot listings for one material (HB-003). The browser asks the API, which holds the
// provider key (SERPAPI_API_KEY) and only answers signed-in members, caching each query for an
// hour. The API filters to Home Depot sellers and product URLs. With no key the UI keeps verified
// Home Depot base prices, official price indexes and direct retailer links.
import { MaterialPriceLookupResponseSchema } from '@fieldline/contracts';
import type { ApiClient } from '../../lib/api';
import type { LivePriceResponse } from './prices';

export const MAX_QUERY_LENGTH = 120;

/** Never throws; a failed lookup reads as "not live" with a plain reason. */
export async function fetchLivePrices(
  api: ApiClient,
  query: string,
  location?: string,
): Promise<LivePriceResponse> {
  const q = query.replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
  try {
    return await api.get('/v1/market/material-prices', {
      schema: MaterialPriceLookupResponseSchema,
      query: { q, ...(location ? { location: location.slice(0, 200) } : {}) },
    });
  } catch {
    return { live: false, query: q, offers: [], message: 'Could not reach the price service.' };
  }
}

// Kept for the legacy /api/material-prices route; the app now asks the API instead.
import type { LiveOffer } from './prices';
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

