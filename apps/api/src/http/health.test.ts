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

describe('GET /v1/health/ready alert status (item 31)', () => {
  it('reports alerts not_configured by default and ok when a webhook is set', async () => {
    const plain = await buildApp({ config: unitTestConfig(), logger: false });
    const plainRes = await plain.inject({ method: 'GET', url: '/v1/health/ready' });
    expect(plainRes.json().checks.alerts).toBe('not_configured');
    await plain.close();

    const wired = await buildApp({
      config: unitTestConfig({ ALERT_WEBHOOK_URL: 'https://alerts.example/hook' }),
      logger: false,
    });
    const wiredRes = await wired.inject({ method: 'GET', url: '/v1/health/ready' });
    expect(wiredRes.json().checks.alerts).toBe('ok');
    // Alert config is informational: readiness still hinges on the database alone.
    expect(wiredRes.statusCode).toBe(503);
    await wired.close();
  });
});
