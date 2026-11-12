// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { register } from './instrumentation';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubServer(env: Record<string, string>) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    void url;
    void init;
    return Promise.resolve(new Response('{}', { status: 200 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return fetchMock;
}

describe('instrumentation register()', () => {
  it('pings the API health endpoint once when the production server starts', () => {
    const fetchMock = stubServer({
      NEXT_RUNTIME: 'nodejs',
      NODE_ENV: 'production',
      API_PROXY_TARGET: 'https://api.example.test/',
    });
    register();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.example.test/v1/health');
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns without waiting, and a failed ping does not throw', async () => {
    const fetchMock = stubServer({
      NEXT_RUNTIME: 'nodejs',
      NODE_ENV: 'production',
      API_PROXY_TARGET: 'https://api.example.test',
    });
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('connection refused')));
    expect(register()).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('connection refused'));
  });

  it('does nothing in development, on the edge runtime, or without a target', () => {
    const cases: Record<string, string>[] = [
      { NEXT_RUNTIME: 'nodejs', NODE_ENV: 'development', API_PROXY_TARGET: 'https://a.test' },
      { NEXT_RUNTIME: 'edge', NODE_ENV: 'production', API_PROXY_TARGET: 'https://a.test' },
      { NEXT_RUNTIME: 'nodejs', NODE_ENV: 'production', API_PROXY_TARGET: '' },
    ];
    for (const env of cases) {
      const fetchMock = stubServer(env);
      register();
      expect(fetchMock).not.toHaveBeenCalled();
      vi.unstubAllEnvs();
    }
  });
});
