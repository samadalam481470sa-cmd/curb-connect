import { parseShoppingResults, sanitizeQuery } from '../../../features/build/live';
import type { LivePriceResponse } from '../../../features/build/prices';

// GET /api/material-prices?q=<material>&location=<city, state>
// Server-side proxy to SerpApi's Google Shopping engine (HB-003). Set SERPAPI_API_KEY on the web
// server to turn live prices on. Responses are cached for an hour per query to limit paid lookups.

const CACHE_SECONDS = 3600;

function json(body: LivePriceResponse, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': status === 200 ? `private, max-age=${CACHE_SECONDS}` : 'no-store' },
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = sanitizeQuery(url.searchParams.get('q'));
  if (!query) {
    return json({ live: false, query: '', offers: [], message: 'Enter 2–120 characters.' }, 400);
  }
  const location = sanitizeQuery(url.searchParams.get('location')) ?? 'United States';
  const key = process.env.SERPAPI_API_KEY;
  if (!key) {
    return json({
      live: false,
      query,
      offers: [],
      message:
        'Live pricing is not configured on this server (SERPAPI_API_KEY). Showing reference prices and retailer links instead.',
    });
  }

  const upstream = new URL('https://serpapi.com/search.json');
  upstream.searchParams.set('engine', 'google_shopping');
  upstream.searchParams.set('q', query);
  upstream.searchParams.set('location', location);
  upstream.searchParams.set('gl', 'us');
  upstream.searchParams.set('hl', 'en');
  upstream.searchParams.set('api_key', key);

  try {
    const res = await fetch(upstream, {
      signal: AbortSignal.timeout(12_000),
      next: { revalidate: CACHE_SECONDS },
    });
    if (!res.ok) {
      return json(
        { live: false, query, offers: [], message: `Price provider returned ${res.status}.` },
        502,
      );
    }
    const offers = parseShoppingResults(await res.json());
    return json({
      live: true,
      query,
      offers,
      message: offers.length === 0 ? 'No priced listings found for that search.' : undefined,
    });
  } catch {
    return json(
      { live: false, query, offers: [], message: 'Price provider did not respond.' },
      504,
    );
  }
}
