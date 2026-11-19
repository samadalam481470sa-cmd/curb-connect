// Wake-up hop for a sleeping API (Render free plan puts it behind a browser check).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unitTestConfig } from '../../test/support/config';
import { type App, buildApp } from '../app';

const WEB = 'https://web.example';

describe('GET /v1/health/wake', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp({ config: unitTestConfig({ APP_ORIGIN: WEB }), logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sends the browser back to the web page it came from', async () => {
    const to = `${WEB}/sign-in?returnTo=%2Fjobs`;
    const res = await app.inject({
      method: 'GET',
      url: `/v1/health/wake?to=${encodeURIComponent(to)}`,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${WEB}/sign-in?returnTo=%2Fjobs`);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it.each(['https://evil.example/phish', '//evil.example', 'javascript:alert(1)'])(
    'never redirects off the web app (%s)',
    async (to) => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/health/wake?to=${encodeURIComponent(to)}`,
      });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe(`${WEB}/`);
    },
  );

  it('falls back to the web app home without a target', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health/wake' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(`${WEB}/`);
  });
});
