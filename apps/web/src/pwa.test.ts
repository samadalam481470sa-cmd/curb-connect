// @vitest-environment node
// Loads public/sw.js into a fake service-worker global and checks what it intercepts. The rule
// under test (PLT-018 / brief): only the app shell and static assets are cached; /v1 API
// responses (tenant data) and navigations are never stored.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import manifest from './app/manifest';
import { BRAND } from '@fieldline/contracts';

type Listener = (event: Record<string, unknown>) => void;

function loadWorker() {
  const listeners = new Map<string, Listener>();
  const put = vi.fn(async () => undefined);
  const cache = { put, match: vi.fn(async () => undefined), addAll: vi.fn(async () => undefined) };
  const self = {
    location: { origin: 'https://app.example.test' },
    registration: { active: null },
    clients: { claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(),
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
  };
  const caches = {
    open: vi.fn(async () => cache),
    match: vi.fn(async () => undefined),
    keys: vi.fn(async () => ['fieldline-shell-old', 'other-app']),
    delete: vi.fn(async () => true),
  };
  const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
  const source = readFileSync(fileURLToPath(new URL('../public/sw.js', import.meta.url)), 'utf8');
  // Relative URLs only resolve inside a worker; a minimal Request stand-in keeps the URL as given.
  class WorkerRequest {
    constructor(
      readonly url: string,
      readonly init?: RequestInit,
    ) {}
  }
  new Function('self', 'caches', 'fetch', 'Request', 'Response', source)(
    self,
    caches,
    fetchMock,
    WorkerRequest,
    Response,
  );
  const fetchEvent = (url: string, init: { method?: string; mode?: string } = {}) => {
    const respondWith = vi.fn();
    listeners.get('fetch')!({
      request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' },
      respondWith,
    });
    return respondWith;
  };
  return { listeners, self, caches, cache, fetchEvent };
}

describe('service worker caching policy (PLT-018)', () => {
  it('PLT-018-QA: never intercepts or caches /v1 API requests', () => {
    const { fetchEvent } = loadWorker();
    expect(fetchEvent('https://app.example.test/v1/me')).not.toHaveBeenCalled();
    expect(fetchEvent('https://app.example.test/v1/team/members?limit=100')).not.toHaveBeenCalled();
  });

  it('PLT-018-QA: ignores non-GET and cross-origin requests', () => {
    const { fetchEvent } = loadWorker();
    expect(
      fetchEvent('https://app.example.test/_next/static/a.js', { method: 'POST' }),
    ).not.toHaveBeenCalled();
    expect(fetchEvent('https://cdn.other.test/_next/static/a.js')).not.toHaveBeenCalled();
  });

  it('PLT-018-QA: serves hashed static assets cache-first and navigations network-first with an offline fallback', () => {
    const { fetchEvent } = loadWorker();
    expect(fetchEvent('https://app.example.test/_next/static/chunks/app.js')).toHaveBeenCalledTimes(
      1,
    );
    expect(fetchEvent('https://app.example.test/icons/icon-192.png')).toHaveBeenCalledTimes(1);
    expect(fetchEvent('https://app.example.test/team', { mode: 'navigate' })).toHaveBeenCalledTimes(
      1,
    );
  });

  it('PLT-018-QA: precaches only shell files and waits for SKIP_WAITING on updates', async () => {
    const { listeners, self, cache } = loadWorker();
    const waits: Promise<unknown>[] = [];
    listeners.get('install')!({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    const urls = (cache.addAll.mock.calls[0] as unknown as [{ url: string }[]])[0].map(
      (r) => r.url,
    );
    expect(urls).toContain('/offline');
    expect(urls.every((u) => !u.startsWith('/v1'))).toBe(true);
    // First install activates immediately; with an active worker it would wait.
    expect(self.skipWaiting).toHaveBeenCalledTimes(1);
    listeners.get('message')!({ data: { type: 'SKIP_WAITING' } });
    expect(self.skipWaiting).toHaveBeenCalledTimes(2);
  });

  it('clears only Field Pro caches on CLEAR_CACHES', async () => {
    const { listeners, caches } = loadWorker();
    const waits: Promise<unknown>[] = [];
    listeners.get('message')!({
      data: { type: 'CLEAR_CACHES' },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    await Promise.all(waits);
    expect(caches.delete).toHaveBeenCalledWith('fieldline-shell-old');
    expect(caches.delete).not.toHaveBeenCalledWith('other-app');
  });
});

describe('web app manifest (PLT-011 installable PWA)', () => {
  it('uses the brand constant, standalone display and maskable icons, with both products as equal shortcuts', () => {
    const m = manifest();
    expect(m.name).toBe(BRAND.name);
    expect(m.display).toBe('standalone');
    expect(m.icons?.some((i) => i.purpose === 'maskable')).toBe(true);
    expect(m.shortcuts?.map((s) => s.name)).toEqual([BRAND.products.roof, BRAND.products.curb]);
  });
});
