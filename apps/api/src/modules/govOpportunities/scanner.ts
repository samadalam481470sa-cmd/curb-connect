// Gov Opportunities scanner: fetches each seed .gov resource page, extracts its outbound
// links, and checks each one. Public .gov pages only; nothing behind a login is fetched.
//
// Honesty rules:
// - HTTP 4xx/5xx = 'dead' (the link really goes nowhere).
// - A host that no longer resolves (DNS failure) = 'dead' (the site is gone).
// - A timeout, a refused/reset connection, or any other check failure = 'unknown', never dead.
// - The seed page itself failing to load marks every link on it 'unknown' for that run, with
//   the page error recorded — a page that cannot be read is not reported as link-free.
// - Results are stored by (page, link) and upserted, so a re-run overwrites the same rows.
import type { GovLinkStatus } from '@fieldline/contracts';
import { SEED_PAGES } from './seeds';

export interface GovLinkRow {
  pageId: string;
  pageName: string;
  pageCity: string;
  pageUrl: string;
  linkUrl: string;
  linkText: string;
  status: GovLinkStatus;
  httpStatus: number | null;
  checkedAt: string;
  /** Why a link is unknown, or the page error that blocked the scan — never a guess. */
  note: string | null;
}

export interface GovLinkStore {
  upsert(row: GovLinkRow): Promise<void>;
  all(): Promise<GovLinkRow[]>;
}

export interface ScanSummary {
  pagesChecked: number;
  linksChecked: number;
  deadFound: number;
  unknownCount: number;
  pageErrors: { pageId: string; error: string }[];
  checkedAt: string;
}

const PAGE_TIMEOUT_MS = 15_000;
const LINK_TIMEOUT_MS = 8_000;
const CHECK_CONCURRENCY = 5;

const SKIP_SCHEMES = new Set(['mailto:', 'tel:', 'javascript:', 'data:']);

/** Extract outbound http(s) links from a page's HTML. Same-page anchors, mailto/tel links,
 *  and non-web schemes are skipped; relative links are resolved against the page URL.
 *  One row per distinct URL, keeping the first link text seen. */
export function extractOutboundLinks(html: string, pageUrl: string): { url: string; text: string }[] {
  const base = new URL(pageUrl);
  const seen = new Map<string, string>();
  const anchorRe = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
  for (const match of html.matchAll(anchorRe)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (!raw || raw.startsWith('#')) continue;
    let resolved: URL;
    try {
      resolved = new URL(raw, base);
    } catch {
      continue;
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
    if (SKIP_SCHEMES.has(resolved.protocol)) continue;
    if (resolved.hostname === base.hostname) continue;
    resolved.hash = '';
    const href = resolved.href;
    if (seen.has(href)) continue;
    const text = (match[4] ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    seen.set(href, text);
  }
  return [...seen.entries()].map(([url, text]) => ({ url, text }));
}

export interface LinkCheckResult {
  status: GovLinkStatus;
  httpStatus: number | null;
  note: string | null;
}

function errorKind(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? (error.cause as { code?: unknown } | undefined)?.code : undefined;
  return `${typeof cause === 'string' ? `${cause}: ` : ''}${message}`;
}

/**
 * Check one outbound link. HEAD first (cheap), GET fallback when the server refuses HEAD
 * (405/501) or answers without a usable status. 2xx/3xx = live; 4xx/5xx = dead; a host that
 * no longer resolves (ENOTFOUND) = dead; anything else = unknown.
 */
export async function checkLink(
  fetchFn: typeof fetch,
  url: string,
): Promise<LinkCheckResult> {
  const tryOnce = async (method: 'HEAD' | 'GET'): Promise<Response> =>
    fetchFn(url, {
      method,
      headers: { 'user-agent': 'FieldPro GovOpportunities/1.0 (+https://curb-connect.example)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(LINK_TIMEOUT_MS),
    });
  try {
    let res: Response;
    try {
      res = await tryOnce('HEAD');
    } catch (error) {
      // HEAD itself failed (some servers reject it outright): one GET attempt before giving up.
      if (/ENOTFOUND|EAI_AGAIN/.test(errorKind(error))) {
        return { status: 'dead', httpStatus: null, note: `Host no longer resolves (${errorKind(error)}).` };
      }
      res = await tryOnce('GET');
    }
    if (res.status === 405 || res.status === 501) {
      res = await tryOnce('GET');
    }
    if (res.status >= 200 && res.status < 400) {
      return { status: 'live', httpStatus: res.status, note: null };
    }
    return { status: 'dead', httpStatus: res.status, note: `Returned HTTP ${res.status}.` };
  } catch (error) {
    const kind = errorKind(error);
    if (/ENOTFOUND|EAI_AGAIN/.test(kind)) {
      return { status: 'dead', httpStatus: null, note: `Host no longer resolves (${kind}).` };
    }
    return { status: 'unknown', httpStatus: null, note: `Check failed (${kind}).` };
  }
}

async function limited<T>(tasks: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]!();
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, worker));
  return out;
}

/**
 * Scan every seed page and store one row per outbound link. Idempotent: the store upserts by
 * (page, link). A page that fails to load still stores its previously known rows untouched
 * and records the page error in the summary — never reported as having no links.
 */
export async function scanSeedPages(deps: {
  fetchFn?: typeof fetch;
  now?: Date;
  store: GovLinkStore;
}): Promise<ScanSummary> {
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? new Date();
  const checkedAt = now.toISOString();
  let linksChecked = 0;
  let deadFound = 0;
  let unknownCount = 0;
  const pageErrors: { pageId: string; error: string }[] = [];

  for (const page of SEED_PAGES) {
    let html: string;
    try {
      const res = await fetchFn(page.url, {
        headers: { accept: 'text/html', 'user-agent': 'FieldPro GovOpportunities/1.0' },
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`seed page returned HTTP ${res.status}`);
      html = await res.text();
    } catch (error) {
      pageErrors.push({ pageId: page.id, error: errorKind(error) });
      continue;
    }
    const links = extractOutboundLinks(html, page.url);
    const checks = await limited(
      links.map((link) => async () => ({ link, result: await checkLink(fetchFn, link.url) })),
      CHECK_CONCURRENCY,
    );
    for (const { link, result } of checks) {
      linksChecked++;
      if (result.status === 'dead') deadFound++;
      if (result.status === 'unknown') unknownCount++;
      await deps.store.upsert({
        pageId: page.id,
        pageName: page.name,
        pageCity: page.city,
        pageUrl: page.url,
        linkUrl: link.url,
        linkText: link.text,
        status: result.status,
        httpStatus: result.httpStatus,
        checkedAt,
        note: result.note,
      });
    }
  }
  return {
    pagesChecked: SEED_PAGES.length - pageErrors.length,
    linksChecked,
    deadFound,
    unknownCount,
    pageErrors,
    checkedAt,
  };
}
