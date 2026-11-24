// Delete your own account: the route needs a session, and sign-up needs the 18-or-older
// confirmation. Both are checked here without a database (auth runs before the handler, and
// body validation runs before auth). The happy path needs a real database and lives in
// test/platform/account-deletion.int.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unitTestConfig } from '../../../test/support/config';
import { type App, buildApp } from '../../app';

describe('POST /v1/auth/account/delete (no database)', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp({ config: unitTestConfig(), logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses without a session', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/account/delete',
      payload: { confirm: 'DELETE' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('refuses without the typed DELETE confirmation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/account/delete',
      payload: { confirm: 'delete' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json().errors)).toContain('Type DELETE');
  });
});

describe('POST /v1/auth/password/sign-up age confirmation (no database)', () => {
  let app: App;

  beforeAll(async () => {
    app = await buildApp({ config: unitTestConfig(), logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses a sign-up without the 18-or-older confirmation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/password/sign-up',
      payload: {
        displayName: 'Sam Alam',
        username: 'age-test-user',
        email: 'age-test@example.test',
        password: 'curbs-and-roofs-2026',
        ageConfirmed: false,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json().errors)).toContain('18 or older');
  });
});
