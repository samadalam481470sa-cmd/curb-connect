// Run: node --test infra/home-ai/proxy.test.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { createProxy, keyMatches } from './proxy.mjs';

const KEY = 'k'.repeat(32);

function listen(server) {
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server.address().port)),
  );
}

test('keyMatches accepts only the exact bearer key', () => {
  assert.equal(keyMatches(`Bearer ${KEY}`, KEY), true);
  assert.equal(keyMatches(`Bearer ${KEY}x`, KEY), false);
  assert.equal(keyMatches(KEY, KEY), false);
  assert.equal(keyMatches(undefined, KEY), false);
  assert.equal(keyMatches('Bearer ', ''), false);
});

test('proxy checks the key, limits routes and forwards chat', async () => {
  const seen = [];
  const upstream = createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"choices":[{"message":{"content":"ready"}}]}');
  });
  const upPort = await listen(upstream);
  const proxy = createProxy({ key: KEY, upstreamHost: '127.0.0.1', upstreamPort: upPort });
  const port = await listen(proxy);
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/v1/models`)).status, 401);
    assert.equal(
      (await fetch(`${base}/v1/models`, { headers: { authorization: 'Bearer wrong' } })).status,
      401,
    );
    const auth = { authorization: `Bearer ${KEY}` };
    assert.equal((await fetch(`${base}/api/pull`, { method: 'POST', headers: auth })).status, 404);
    const ok = await fetch(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /ready/);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, '/v1/chat/completions');
    assert.ok(!seen[0].auth, 'the key is not passed on to the model server');
  } finally {
    proxy.close();
    upstream.close();
  }
});

test('proxy answers 502 when the model server is down', async () => {
  const proxy = createProxy({ key: KEY, upstreamHost: '127.0.0.1', upstreamPort: 1 });
  const port = await listen(proxy);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      headers: { authorization: `Bearer ${KEY}` },
    });
    assert.equal(res.status, 502);
  } finally {
    proxy.close();
  }
});
