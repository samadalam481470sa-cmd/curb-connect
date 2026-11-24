// Gov Opportunities scanner tests. All HTTP is mocked — no real .gov page is fetched here.
import { describe, expect, it } from 'vitest';
import {
  checkLink,
  extractOutboundLinks,
  scanSeedPages,
  type GovLinkRow,
  type GovLinkStore,
} from './scanner';
import { SEED_PAGES } from './seeds';

type MockResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

function mockResponse(status: number, body = ''): MockResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

function memoryStore(): { store: GovLinkStore; rows: GovLinkRow[] } {
  const rows: GovLinkRow[] = [];
  return {
    rows,
    store: {
      upsert: async (row) => {
        const i = rows.findIndex((r) => r.pageUrl === row.pageUrl && r.linkUrl === row.linkUrl);
        if (i >= 0) rows[i] = row;
        else rows.push(row);
      },
      all: async () => [...rows],
    },
  };
}

describe('extractOutboundLinks', () => {
  it('keeps external links, drops internal, anchor, mailto and duplicate links', () => {
    const html = `
      <a href="/about">About us</a>
      <a href="https://www.sanantonio.gov/edd/small-business">Same site</a>
      <a href="https://example.com/roofing-guide">Roofing guide</a>
      <a href="https://example.com/roofing-guide">Roofing guide again</a>
      <a href="/resources/guide.pdf">Relative PDF</a>
      <a href="mailto:info@example.com">Email</a>
      <a href="#top">Top</a>
      <a href="https://dead.example.org/old.pdf">Old PDF</a>`;
    const links = extractOutboundLinks(html, 'https://www.sanantonio.gov/edd/small-business');
    expect(links.map((l) => l.url)).toEqual([
      'https://example.com/roofing-guide',
      'https://dead.example.org/old.pdf',
    ]);
    expect(links[0]?.text).toBe('Roofing guide');
  });

  it('resolves relative links against the page URL', () => {
    const html = '<a href="//cdn.example.com/file.pdf">File</a>';
    const links = extractOutboundLinks(html, 'https://www.fortworthtexas.gov/departments/econdev');
    expect(links).toEqual([{ url: 'https://cdn.example.com/file.pdf', text: 'File' }]);
  });
});

describe('checkLink', () => {
  it('reports live for a 200 HEAD', async () => {
    const fetchFn = (async () => mockResponse(200)) as unknown as typeof fetch;
    await expect(checkLink(fetchFn, 'https://example.com/ok')).resolves.toEqual({
      status: 'live',
      httpStatus: 200,
      note: null,
    });
  });

  it('reports dead for a 404', async () => {
    const fetchFn = (async () => mockResponse(404)) as unknown as typeof fetch;
    const result = await checkLink(fetchFn, 'https://example.com/gone');
    expect(result.status).toBe('dead');
    expect(result.httpStatus).toBe(404);
  });

  it('falls back to GET when HEAD is refused with 405', async () => {
    const fetchFn = (async (_url: string, init?: { method?: string }) =>
      init?.method === 'HEAD' ? mockResponse(405) : mockResponse(200)) as unknown as typeof fetch;
    const result = await checkLink(fetchFn, 'https://example.com/no-head');
    expect(result.status).toBe('live');
    expect(result.httpStatus).toBe(200);
  });

  it('reports dead when the host no longer resolves', async () => {
    const error = new Error('getaddrinfo ENOTFOUND dead.example.org') as Error & { cause: { code: string } };
    error.cause = { code: 'ENOTFOUND' };
    const fetchFn = (async () => {
      throw error;
    }) as unknown as typeof fetch;
    const result = await checkLink(fetchFn, 'https://dead.example.org/old');
    expect(result.status).toBe('dead');
    expect(result.httpStatus).toBeNull();
  });

  it('reports unknown when the check times out', async () => {
    const error = new Error('The operation timed out');
    error.name = 'TimeoutError';
    const fetchFn = (async () => {
      throw error;
    }) as unknown as typeof fetch;
    const result = await checkLink(fetchFn, 'https://slow.example.com/page');
    expect(result.status).toBe('unknown');
    expect(result.httpStatus).toBeNull();
  });
});

describe('scanSeedPages', () => {
  it('scans every seed page and stores one row per outbound link', async () => {
    const { store, rows } = memoryStore();
    const pageHtml = `
      <a href="https://example.com/live-guide">Live guide</a>
      <a href="https://dead.example.org/old-guide">Old guide</a>`;
    const fetchFn = (async (url: string, init?: { method?: string }) => {
      if (SEED_PAGES.some((p) => p.url === url)) return mockResponse(200, pageHtml);
      if (url.includes('dead.example.org')) return mockResponse(404);
      if (init?.method === 'HEAD') return mockResponse(200);
      return mockResponse(200);
    }) as unknown as typeof fetch;
    const summary = await scanSeedPages({ fetchFn, now: new Date('2026-11-24T12:00:00Z'), store });
    expect(summary.pagesChecked).toBe(SEED_PAGES.length);
    expect(summary.linksChecked).toBe(SEED_PAGES.length * 2);
    expect(summary.deadFound).toBe(SEED_PAGES.length);
    expect(summary.unknownCount).toBe(0);
    expect(rows.filter((r) => r.status === 'dead')).toHaveLength(SEED_PAGES.length);
    expect(rows.every((r) => r.checkedAt === '2026-11-24T12:00:00.000Z')).toBe(true);
  });

  it('records a page error and keeps going when one seed page fails', async () => {
    const { store, rows } = memoryStore();
    const fetchFn = (async (url: string) => {
      if (url === SEED_PAGES[0]!.url) throw new Error('connection reset');
      if (SEED_PAGES.some((p) => p.url === url)) return mockResponse(200, '<a href="https://example.com/x">X</a>');
      return mockResponse(200);
    }) as unknown as typeof fetch;
    const summary = await scanSeedPages({ fetchFn, now: new Date('2026-11-24T12:00:00Z'), store });
    expect(summary.pagesChecked).toBe(SEED_PAGES.length - 1);
    expect(summary.pageErrors).toHaveLength(1);
    expect(summary.pageErrors[0]?.pageId).toBe(SEED_PAGES[0]!.id);
    expect(rows.every((r) => r.pageId !== SEED_PAGES[0]!.id)).toBe(true);
  });

  it('a re-run overwrites the same rows instead of duplicating them', async () => {
    const { store, rows } = memoryStore();
    const fetchFn = (async (url: string, init?: { method?: string }) => {
      if (SEED_PAGES.some((p) => p.url === url)) {
        return mockResponse(200, '<a href="https://example.com/x">X</a>');
      }
      if (init?.method === 'HEAD') return mockResponse(200);
      return mockResponse(200);
    }) as unknown as typeof fetch;
    await scanSeedPages({ fetchFn, now: new Date('2026-11-24T12:00:00Z'), store });
    await scanSeedPages({ fetchFn, now: new Date('2026-11-25T12:00:00Z'), store });
    expect(rows).toHaveLength(SEED_PAGES.length);
    expect(rows.every((r) => r.checkedAt === '2026-11-25T12:00:00.000Z')).toBe(true);
  });
});

describe('seed pages', () => {
  it('every seed URL is a well-formed https URL on a .gov or city domain', () => {
    for (const page of SEED_PAGES) {
      const url = new URL(page.url);
      expect(url.protocol).toBe('https:');
      expect(page.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(SEED_PAGES.length).toBeGreaterThanOrEqual(4);
    expect(new Set(SEED_PAGES.map((p) => p.id)).size).toBe(SEED_PAGES.length);
  });
});
