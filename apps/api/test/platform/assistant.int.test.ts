// Ask Field Pro through the real app: sign-in is required, the always-on home server answers
// first, the backup model answers when the home server is down, and the API says so plainly when
// no AI is reachable. The model servers here are small local fakes.
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type TestContext, call, createCompany, createTestContext } from '../helpers';

function fakeModel(
  label: string,
  status = 200,
): Promise<{ server: Server; url: string; hits: string[] }> {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(
      status === 200
        ? JSON.stringify(
            req.url?.endsWith('/models')
              ? { data: [] }
              : { choices: [{ message: { content: `${label} says hello` } }] },
          )
        : '{"error":"down"}',
    );
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        server,
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
        hits,
      }),
    ),
  );
}

const servers: Server[] = [];
let ctx: TestContext | undefined;
afterEach(async () => {
  await ctx?.cleanup();
});
afterAll(async () => {
  await ctx?.close();
  servers.forEach((s) => s.close());
});

async function withEnv(env: Record<string, string>) {
  await ctx?.close();
  ctx = await createTestContext({ env });
  return ctx;
}

describe('Ask Field Pro', () => {
  beforeAll(() => {
    process.env.TZ = process.env.TZ ?? 'UTC';
  });

  it('requires sign-in', async () => {
    const c = await withEnv({ HOME_AI_BASE_URL: '', OPEN_MODEL_BASE_URL: '' });
    const ask = await call(c, 'POST', '/v1/assistant/ask', { body: { question: 'Hello there' } });
    expect(ask.statusCode).toBe(401);
    const status = await call(c, 'GET', '/v1/assistant/status');
    expect(status.statusCode).toBe(401);
  });

  it('answers from the home server when it is up', async () => {
    const home = await fakeModel('home');
    servers.push(home.server);
    const c = await withEnv({ HOME_AI_BASE_URL: home.url, HOME_AI_API_KEY: 'k' });
    const company = await createCompany(c);
    const res = await call(c, 'POST', '/v1/assistant/ask', {
      as: company.owner,
      body: { question: 'How long does framing take?', mode: 'home_build' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      answer: 'home says hello',
      source: 'home_server',
      mode: 'home_build',
    });
    expect(res.json().disclaimer).toMatch(/licensed professional/);
    const status = await call(c, 'GET', '/v1/assistant/status', { as: company.owner });
    expect(status.json()).toMatchObject({ homeServer: 'online', available: true });
  });

  it('falls back to the backup model when the home server is down', async () => {
    const home = await fakeModel('home', 502);
    const backup = await fakeModel('backup');
    servers.push(home.server, backup.server);
    const c = await withEnv({
      HOME_AI_BASE_URL: home.url,
      OPEN_MODEL_BASE_URL: backup.url,
      OPEN_MODEL_NAME: 'backup-model',
    });
    const company = await createCompany(c);
    const res = await call(c, 'POST', '/v1/assistant/ask', {
      as: company.owner,
      body: { question: 'Where do I find my invoices?', mode: 'search_help' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ answer: 'backup says hello', source: 'backup_model' });
    const status = await call(c, 'GET', '/v1/assistant/status', { as: company.owner });
    expect(status.json()).toMatchObject({
      homeServer: 'offline',
      backupModel: 'configured',
      available: true,
    });
  });

  it('says so plainly when no AI is reachable', async () => {
    const c = await withEnv({ HOME_AI_BASE_URL: '', OPEN_MODEL_BASE_URL: '' });
    const company = await createCompany(c);
    const res = await call(c, 'POST', '/v1/assistant/ask', {
      as: company.owner,
      body: { question: 'Anything at all' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatch(/not reachable/);
    const status = await call(c, 'GET', '/v1/assistant/status', { as: company.owner });
    expect(status.json()).toMatchObject({ homeServer: 'not_configured', available: false });
  });

  it('rejects empty or oversized questions', async () => {
    const c = await withEnv({ HOME_AI_BASE_URL: '', OPEN_MODEL_BASE_URL: '' });
    const company = await createCompany(c);
    for (const question of ['', 'x'.repeat(2001)]) {
      const res = await call(c, 'POST', '/v1/assistant/ask', {
        as: company.owner,
        body: { question },
      });
      expect(res.statusCode).toBe(400);
    }
  });
});
