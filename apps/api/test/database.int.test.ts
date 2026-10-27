import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type App, buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createDatabase, type DatabaseHandle } from '../src/db/client';

describe('database integration (fieldline_test)', () => {
  let database: DatabaseHandle;
  let app: App;

  beforeAll(async () => {
    const config = loadConfig();
    // BINDING DB ROLE RULE: the app under test uses the restricted runtime role.
    database = createDatabase(process.env.TEST_APP_DATABASE_URL as string, { max: 2, applicationName: 'api-test' });
    app = await buildApp({ config, database, logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  it('is connected to a *_test database', async () => {
    const [row] = await database.client<{ name: string }[]>`select current_database() as name`;
    expect(row?.name).toMatch(/_test$/);
  });

  it('has PostGIS available', async () => {
    const [row] = await database.client<{ version: string }[]>`select postgis_version() as version`;
    expect(row?.version).toMatch(/^3\./);
  });

  it('has the baseline migration recorded', async () => {
    const rows = await database.client<{ count: string }[]>`
      select count(*)::text as count from drizzle.__drizzle_migrations
    `.catch(async () => {
      // fieldline_app may not read the drizzle schema; ask through the owner instead.
      const owner = createDatabase(process.env.TEST_DATABASE_URL as string, { max: 1 });
      try {
        return await owner.client<{ count: string }[]>`select count(*)::text as count from drizzle.__drizzle_migrations`;
      } finally {
        await owner.close();
      }
    });
    expect(Number(rows[0]?.count)).toBeGreaterThanOrEqual(1);
  });

  it('GET /v1/health/ready reports ready when the database answers', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready', checks: { database: 'ok' } });
  });
});
